// 高德 / 天气查询路由：供网页端复用云开发公用域名。
// - 高德 Web 服务 Key 从环境变量 AMAP_WEB_SERVICE_KEY 读取（云端控制台配置，不落代码）
// - 天气优先和风（需 QWEATHER_API_KEY，可选），否则回退 Open-Meteo（免 Key）
// - 无新增 npm 依赖：请求用 node:https 实现；缓存为实例内内存 Map（云函数无持久磁盘）
// 统一返回 { statusCode, data }，与 trips.js 一致。
'use strict';

const https = require('node:https');

const PROVINCES = ['新疆', '西藏', '内蒙古', '宁夏', '广西', '北京', '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '台湾', '香港', '澳门'];

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      let raw = '';
      res.setTimeout(15000, () => req.destroy(new Error('上游服务超时')));
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          resolve(data);
        } catch (error) {
          reject(new Error(`上游返回无效 JSON（HTTP ${res.statusCode}）`));
        }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('上游服务超时')));
    req.on('error', error => reject(new Error(`上游服务请求失败：${error.message}`)));
  });
}

// 拼接完整地址：省市区县 + 地址 + 名称
const poiFullAddress = poi => {
  const base = `${poi.pname || ''}${poi.cityname || ''}${poi.adname || ''}${poi.address || ''}`.trim();
  const name = String(poi.name || '').trim();
  return name && !base.includes(name) ? `${base}${base ? '·' : ''}${name}` : (base || name);
};

// 同一 POI 名称/地址的候选打分（与网页端本地服务逻辑一致）
function scoreCandidate(poi, name, province, contextTokens) {
  const text = `${poi.name || ''}${poi.pname || ''}${poi.cityname || ''}${poi.adname || ''}${poi.address || ''}`;
  const publicPlaceIntent = /游客|景区|机场|车站|服务区|停车场|售票处|入口|出口/.test(name);
  const businessMismatch = publicPlaceIntent && /住宿服务|餐饮服务|购物服务/.test(poi.type || '') ? -40 : 0;
  const subtypeMismatch = !/停车场/.test(name) && /停车场/.test(`${poi.name || ''}${poi.type || ''}`) ? -18 : 0;
  const intentBonus = /游客/.test(name) && /游客中心|游客服务/.test(poi.name || '') && !/酒店|民宿|餐厅|商店/.test(poi.name || '') ? 24 : 0;
  const nameChars = new Set(String(name).replace(/[\s·()（）]/g, ''));
  const candidateChars = new Set(String(poi.name || '').replace(/[\s·()（）]/g, ''));
  const overlap = [...nameChars].filter(char => candidateChars.has(char)).length;
  const similarity = nameChars.size ? overlap / nameChars.size * 20 : 0;
  return contextTokens.reduce((total, token) => total + (text.includes(token) ? 8 : 0), 0)
    + (poi.name === name ? 20 : 0) + (poi.name && poi.name.includes(name) ? 8 : 0)
    + similarity + intentBonus + businessMismatch + subtypeMismatch;
}

function createAmapRoutes({ amapKey, qweatherKey }) {
  // 实例内内存缓存：同一点位只保留最新响应
  const cache = new Map();
  const MAX_CACHE = 800;
  const cachePointKey = (endpoint, params) => {
    if (endpoint.includes('/direction/')) return `route:${endpoint}:${params.origin || ''}|${params.destination || ''}|${params.waypoints || ''}`;
    if (endpoint === '/v3/place/text' || endpoint === '/v3/geocode/geo') return `geo:${endpoint}:${params.keywords || params.address || ''}|${params.city || ''}`;
    if (endpoint === '/v5/place/text') return `place:${params.keywords || ''}|${params.region || ''}`;
    return null;
  };

  async function amap(endpoint, params, { withMeta = false } = {}) {
    if (!amapKey) throw new Error('未配置 AMAP_WEB_SERVICE_KEY。请在云开发控制台为云函数 api 配置环境变量后重新部署。');
    const sortedParams = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
    const cacheKey = `${endpoint}?${new URLSearchParams(sortedParams)}`;
    if (cache.has(cacheKey)) return withMeta ? { data: cache.get(cacheKey), cached: true } : cache.get(cacheKey);
    const query = new URLSearchParams({ key: amapKey, ...sortedParams });
    const data = await httpsGetJson(`https://restapi.amap.com${endpoint}?${query}`);
    if (data.status !== '1') throw new Error(data.info || '高德服务请求失败');
    const pointKey = cachePointKey(endpoint, params);
    if (pointKey) {
      for (const existing of [...cache.keys()]) {
        if (existing === cacheKey) continue;
        const [existingEndpoint, queryString] = existing.split('?');
        const existingParams = Object.fromEntries(new URLSearchParams(queryString || ''));
        if (cachePointKey(existingEndpoint, existingParams) === pointKey) cache.delete(existing);
      }
    }
    cache.set(cacheKey, data);
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return withMeta ? { data, cached: false } : data;
  }

  // GET /api/geocode?address=&keyword=&city=
  async function geocode({ address, keyword, city } = {}) {
    address = String(address || '');
    keyword = keyword || address;
    const addressText = address;
    const province = PROVINCES.find(alias => addressText.includes(alias)) || '';
    const regions = [...addressText.matchAll(/([\u4e00-\u9fa5]{2,}?(?:自治区|自治州|地区|市|县|区))/g)].map(match => match[1]);
    if (province && !regions.some(region => region.includes(province))) regions.unshift(province);
    city = city || regions[regions.length - 1] || province || '';
    const contextTokens = [province, ...regions, ...addressText.split(/[\s,，省市县区州]+/).filter(token => token.length >= 3)].filter(Boolean);
    const poi = await amap('/v3/place/text', { keywords: addressText, city, citylimit: city ? 'true' : 'false', offset: '10', page: '1', extensions: 'base' });
    if (poi.pois && poi.pois.some(item => item.location)) {
      const candidates = poi.pois.filter(item => item.location).filter(item => {
        if (!province) return true;
        const text = `${item.pname || ''}${item.cityname || ''}${item.adname || ''}${item.address || ''}`;
        return text.includes(province) || (province === '新疆' && text.includes('新疆维吾尔自治区'));
      });
      const ordered = (candidates.length ? candidates : poi.pois.filter(item => item.location)).sort((a, b) => {
        const score = item => scoreCandidate(item, keyword, province, contextTokens);
        return score(b) - score(a);
      });
      if (!province || candidates.length) {
        return {
          statusCode: 200,
          data: {
            status: '1', info: 'OK', infocode: '10000', count: String(ordered.length),
            geocodes: ordered.map(item => ({ formatted_address: poiFullAddress(item), location: item.location, level: '兴趣点', name: item.name, type: item.type })),
          },
        };
      }
    }
    return { statusCode: 200, data: await amap('/v3/geocode/geo', { address, city: city || '' }) };
  }

  // GET /api/place-photos?name=&address=
  async function placePhotos({ name, address } = {}) {
    name = String(name || '').trim();
    address = String(address || '').trim();
    if (!name || !address) throw new Error('请提供地点名称和完整地址');
    const province = PROVINCES.find(alias => address.includes(alias)) || '';
    const city = [...address.matchAll(/([\u4e00-\u9fa5]{2,}?(?:自治区|自治州|地区|市|县|区))/g)].map(match => match[1]).slice(-1)[0] || province;
    const result = await amap('/v5/place/text', { keywords: address, region: city, city_limit: city ? 'true' : 'false', page_size: '10', page_num: '1', show_fields: 'business,photos' }, { withMeta: true });
    const { data } = result;
    const poiPhotos = poi => Array.isArray(poi.photos) ? poi.photos : (poi.photos && poi.photos.url ? [poi.photos] : []);
    const candidates = (data.pois || []).filter(poi => poiPhotos(poi).length).map(poi => {
      const text = `${poi.name || ''}${poi.pname || ''}${poi.cityname || ''}${poi.adname || ''}${poi.address || ''}`;
      const nameScore = [...new Set(name.replace(/[\s·()（）]/g, ''))].filter(char => (poi.name || '').includes(char)).length;
      return { poi, score: (poi.name === name ? 100 : poi.name && poi.name.includes(name) ? 45 : 0) + nameScore + (province && text.includes(province) ? 25 : 0) };
    }).sort((a, b) => b.score - a.score).slice(0, 3);
    const photos = candidates.flatMap(({ poi }) => poiPhotos(poi).slice(0, 4).map(photo => ({ url: photo.url, title: photo.title || poi.name || name, poiName: poi.name || name, address: poiFullAddress(poi) }))).filter(photo => photo.url);
    return { statusCode: 200, data: { photos: photos.slice(0, 8), cached: result.cached } };
  }

  // GET /api/place-details?name=&address=
  async function placeDetails({ name, address } = {}) {
    name = String(name || '').trim();
    address = String(address || '').trim();
    if (!name || !address) throw new Error('请提供地点名称和完整地址');
    const province = PROVINCES.find(alias => address.includes(alias)) || '';
    const city = [...address.matchAll(/([\u4e00-\u9fa5]{2,}?(?:自治区|自治州|地区|市|县|区))/g)].map(match => match[1]).slice(-1)[0] || province;
    const result = await amap('/v5/place/text', { keywords: address, region: city, city_limit: city ? 'true' : 'false', page_size: '10', page_num: '1', show_fields: 'business,photos' }, { withMeta: true });
    const { data } = result;
    const pois = data.pois || [];
    const ranked = pois.map(poi => {
      const text = `${poi.name || ''}${poi.pname || ''}${poi.cityname || ''}${poi.adname || ''}${poi.address || ''}`;
      const nameScore = [...new Set(name.replace(/[\s·()（）]/g, ''))].filter(char => (poi.name || '').includes(char)).length;
      return { poi, score: (poi.name === name ? 100 : poi.name && poi.name.includes(name) ? 45 : 0) + nameScore + (province && text.includes(province) ? 25 : 0) };
    }).sort((a, b) => b.score - a.score);
    const poi = ranked[0] && ranked[0].poi;
    if (!poi) throw new Error('高德未找到对应地点');
    const ext = poi.business || poi.biz_ext || {};
    const text = value => Array.isArray(value) ? value.filter(Boolean).join('、') : String(value || '');
    return {
      statusCode: 200,
      data: {
        poi: {
          id: poi.id || '', name: poi.name || name, intro: text(poi.intro || poi.description),
          openTime: text(ext.opentime_week || ext.opentime_today || poi.opentime_week || poi.opentime || poi.opening_hours),
          rating: text(ext.rating || poi.rating), referenceCost: text(ext.cost || poi.cost),
          tags: text(ext.keytag || ext.rectag || poi.tag || poi.alias), ticketPrice: text(poi.price || ext.price),
          address: poiFullAddress(poi), location: poi.location || '',
        },
        cached: result.cached,
      },
    };
  }

  // POST /api/route { origin, destination, waypoints, strategy, mode, city, cityd }
  async function calculateRoute(params = {}) {
    const { origin, destination, waypoints = [], strategy = '32', mode = 'driving', city, cityd } = params;
    if (!origin || !destination) throw new Error('起点和终点不能为空');
    const normalizePath = path => ({
      ...path,
      duration: path.duration || (path.cost && path.cost.duration) || '0',
      tolls: (path.cost && path.cost.tolls) || '0',
      toll_distance: (path.cost && path.cost.toll_distance) || '0',
      traffic_lights: (path.cost && path.cost.traffic_lights) || '0',
      steps: (path.steps || []).map(step => ({ ...step, distance: step.step_distance || step.distance || '0', polyline: step.polyline || '' })),
    });
    if (mode === 'walking') {
      if (waypoints.length) throw new Error('高德步行路线暂不支持途经点，请拆分为多个路程事件');
      const data = await amap('/v3/direction/walking', { origin, destination });
      const paths = (data.route && data.route.paths || []).map(normalizePath);
      if (!paths.length) throw new Error('高德没有返回可用步行路线');
      return { statusCode: 200, data: { ...data, route: { ...data.route, paths } } };
    }
    if (mode === 'bicycling') {
      if (waypoints.length) throw new Error('高德骑行路线暂不支持途经点，请拆分为多个路程事件');
      const data = await amap('/v4/direction/bicycling', { origin, destination });
      const paths = ((data.data && data.data.paths) || []).map(normalizePath);
      if (!paths.length || Number(data.errcode || 0) !== 0) throw new Error(data.errdetail || data.errmsg || '高德没有返回可用骑行路线');
      return { statusCode: 200, data: { ...data, route: { origin, destination, paths } } };
    }
    if (mode === 'transit') {
      if (waypoints.length) throw new Error('高德公共交通路线暂不支持途经点，请拆分为多个路程事件');
      if (!city) throw new Error('公共交通需要填写公交起点城市');
      const data = await amap('/v3/direction/transit/integrated', { origin, destination, city, ...(cityd ? { cityd } : {}), strategy: '0', extensions: 'all' });
      const transit = data.route && data.route.transits && data.route.transits[0];
      if (!transit) throw new Error('高德没有返回可用公共交通方案');
      const steps = (transit.segments || []).flatMap(segment => [
        ...((segment.walking && segment.walking.steps) || []),
        ...((segment.bus && segment.bus.buslines) || []).map(line => ({ instruction: line.name || '公共交通', road: line.name || '', distance: line.distance || '0', duration: line.duration || '0', polyline: line.polyline || '' })),
        ...(segment.railway && segment.railway.trip ? [{ instruction: segment.railway.trip, road: segment.railway.name || '铁路', distance: segment.railway.distance || '0', duration: segment.railway.time || '0', polyline: segment.railway.polyline || '' }] : []),
      ]).filter(step => step.polyline || step.distance);
      const distance = Number(transit.distance || steps.reduce((sum, step) => sum + Number(step.distance || 0), 0));
      const paths = [{ distance, duration: transit.duration || '0', tolls: transit.cost || '0', toll_distance: '0', steps }];
      return { statusCode: 200, data: { ...data, route: { ...data.route, paths } } };
    }
    const amapParams = { origin, destination, strategy, show_fields: 'cost,polyline' };
    if (waypoints.length) amapParams.waypoints = waypoints.join(';');
    const data = await amap('/v5/direction/driving', amapParams);
    const paths = (data.route && data.route.paths || []).map(normalizePath);
    if (!paths.length) throw new Error('高德没有返回可用驾车路线');
    return { statusCode: 200, data: { ...data, route: { ...data.route, paths } } };
  }

  // GET /api/weather?latitude=&longitude=&date=&time=
  async function weather({ latitude, longitude, date, time = '12:00' } = {}) {
    latitude = Number(latitude);
    longitude = Number(longitude);
    date = String(date || '');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('请提供地点坐标和行程日期');
    }
    const cacheKey = `${qweatherKey ? 'qweather' : 'open-meteo'}:${latitude.toFixed(4)},${longitude.toFixed(4)}:${date}:${time.slice(0, 2)}`;
    if (cache.has(cacheKey)) return { statusCode: 200, data: { ...cache.get(cacheKey), cached: true } };
    if (qweatherKey) {
      try {
        const qweather = await httpsGetJson(`https://devapi.qweather.com/v7/grid-weather/1h?${new URLSearchParams({ location: `${longitude},${latitude}`, key: qweatherKey })}`);
        const targetHour = `${date}T${time.slice(0, 2).padStart(2, '0')}`;
        const hourly = qweather.hourly && qweather.hourly.find(item => String(item.fxTime || '').startsWith(targetHour));
        if (qweather.code === '200' && hourly) {
          const result = {
            source: 'QWeather', latitude, longitude, time: hourly.fxTime, conditionText: hourly.text,
            temperature: Number(hourly.temp), apparentTemperature: Number(hourly.feelsLike), precipitationProbability: Number(hourly.pop), precipitation: Number(hourly.precip),
            windSpeed: Number(hourly.windSpeed), windGusts: Number(hourly.windGust), queriedAt: new Date().toISOString(),
          };
          cache.set(cacheKey, result);
          return { statusCode: 200, data: { ...result, cached: false } };
        }
      } catch { /* 和风不可用时使用下方全球格点备选 */ }
    }
    const query = new URLSearchParams({
      latitude: String(latitude), longitude: String(longitude), timezone: 'Asia/Shanghai', start_date: date, end_date: date,
      hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    });
    const data = await httpsGetJson(`https://api.open-meteo.com/v1/forecast?${query}`);
    const hour = `${date}T${time.slice(0, 2).padStart(2, '0')}:00`;
    const index = data.hourly && data.hourly.time ? data.hourly.time.indexOf(hour) : -1;
    if (index < 0) throw new Error('该日期暂未提供逐小时天气预报；请临近出发时再查询');
    const result = {
      source: 'Open-Meteo', latitude: data.latitude, longitude: data.longitude, time: hour,
      temperature: data.hourly.temperature_2m && data.hourly.temperature_2m[index],
      apparentTemperature: data.hourly.apparent_temperature && data.hourly.apparent_temperature[index],
      precipitationProbability: data.hourly.precipitation_probability && data.hourly.precipitation_probability[index],
      precipitation: data.hourly.precipitation && data.hourly.precipitation[index],
      weatherCode: data.hourly.weather_code && data.hourly.weather_code[index],
      windSpeed: data.hourly.wind_speed_10m && data.hourly.wind_speed_10m[index],
      windGusts: data.hourly.wind_gusts_10m && data.hourly.wind_gusts_10m[index],
      queriedAt: new Date().toISOString(),
    };
    cache.set(cacheKey, result);
    return { statusCode: 200, data: { ...result, cached: false } };
  }

  // GET /api/preview-mode：云端无端口概念，按 UA 判断移动/桌面
  async function previewMode(headers = {}) {
    const ua = String(headers['user-agent'] || headers['User-Agent'] || '').toLowerCase();
    const isMobile = /mobile|android|iphone|ipad|phone|harmonyos/i.test(ua);
    return { statusCode: 200, data: { mode: isMobile ? 'mobile' : 'desktop' } };
  }

  return { geocode, placePhotos, placeDetails, calculateRoute, weather, previewMode };
}

module.exports = { createAmapRoutes };
