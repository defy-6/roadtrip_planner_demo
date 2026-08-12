import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

dotenv.config();
const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(root, '.cache');
const cacheFile = path.join(cacheDir, 'amap-responses.json');
const weatherCacheFile = path.join(cacheDir, 'weather-responses.json');
const dataDir = path.join(root, 'data');
const plannerDataFile = path.join(dataDir, 'roadtrip-data.json');
let amapCache = {};
try { amapCache = JSON.parse(await readFile(cacheFile, 'utf8')); } catch { /* 首次启动尚无缓存 */ }
let weatherCache = {};
try { weatherCache = JSON.parse(await readFile(weatherCacheFile, 'utf8')); } catch { /* 首次启动尚无缓存 */ }
let cacheWrite = Promise.resolve();
const saveCache = () => {
  cacheWrite = cacheWrite.then(async () => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(amapCache), 'utf8');
  });
  return cacheWrite;
};
let weatherCacheWrite = Promise.resolve();
const saveWeatherCache = () => {
  weatherCacheWrite = weatherCacheWrite.then(async () => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(weatherCacheFile, JSON.stringify(weatherCache), 'utf8');
  });
  return weatherCacheWrite;
};
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(root, 'public')));

const key = process.env.AMAP_WEB_SERVICE_KEY;
const qweatherKey = process.env.QWEATHER_API_KEY;
const amap = async (endpoint, params) => {
  if (!key) throw new Error('未配置 AMAP_WEB_SERVICE_KEY。请复制 .env.example 为 .env 后填写。');
  const sortedParams = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
  const cacheKey = `${endpoint}?${new URLSearchParams(sortedParams)}`;
  if (amapCache[cacheKey]) return amapCache[cacheKey];
  const query = new URLSearchParams({ key, ...sortedParams });
  const res = await fetch(`https://restapi.amap.com${endpoint}?${query}`);
  if (!res.ok) throw new Error(`高德服务响应 ${res.status}`);
  const data = await res.json();
  if (data.status !== '1') throw new Error(data.info || '高德服务请求失败');
  amapCache[cacheKey] = data;
  await saveCache();
  return data;
};

app.get('/api/geocode', async (req, res) => {
  try {
    const address = req.query.address;
    const keyword = req.query.keyword || address;
    const addressText = String(address || '');
    const provinceAliases = ['新疆', '西藏', '内蒙古', '宁夏', '广西', '北京', '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '台湾', '香港', '澳门'];
    const province = provinceAliases.find(alias => addressText.includes(alias)) || '';
    const regions = [...addressText.matchAll(/([\u4e00-\u9fa5]{2,}?(?:自治区|自治州|地区|市|县|区))/g)].map(match => match[1]);
    if (province && !regions.some(region => region.includes(province))) regions.unshift(province);
    const city = req.query.city || regions.at(-1) || province || '';
    const contextTokens = [province, ...regions, ...addressText.split(/[\s,，省市县区州]+/).filter(token => token.length >= 3)].filter(Boolean);
    // 始终以用户填写的完整地址作为 POI 检索词；名称只用于候选排序，避免全国同名地点误匹配。
    const poi = await amap('/v3/place/text', { keywords: addressText, city, citylimit: city ? 'true' : 'false', offset: '10', page: '1', extensions: 'base' });
    if (poi.pois?.some(item => item.location)) {
      const candidates = poi.pois.filter(item => item.location).filter(item => {
        if (!province) return true;
        const text = `${item.pname || ''}${item.cityname || ''}${item.adname || ''}${item.address || ''}`;
        return text.includes(province) || (province === '新疆' && text.includes('新疆维吾尔自治区'));
      });
      const ordered = (candidates.length ? candidates : poi.pois.filter(item => item.location)).sort((a, b) => {
        const score = item => {
          const text = `${item.name || ''}${item.pname || ''}${item.cityname || ''}${item.adname || ''}${item.address || ''}`;
          const publicPlaceIntent = /游客|景区|机场|车站|服务区|停车场|售票处|入口|出口/.test(keyword);
          const businessMismatch = publicPlaceIntent && /住宿服务|餐饮服务|购物服务/.test(item.type || '') ? -40 : 0;
          const subtypeMismatch = !/停车场/.test(keyword) && /停车场/.test(`${item.name || ''}${item.type || ''}`) ? -18 : 0;
          const intentBonus = /游客/.test(keyword) && /游客中心|游客服务/.test(item.name || '') && !/酒店|民宿|餐厅|商店/.test(item.name || '') ? 24 : 0;
          const nameChars = new Set(String(keyword).replace(/[\s·()（）]/g, ''));
          const candidateChars = new Set(String(item.name || '').replace(/[\s·()（）]/g, ''));
          const overlap = [...nameChars].filter(char => candidateChars.has(char)).length;
          const similarity = nameChars.size ? overlap / nameChars.size * 20 : 0;
          return contextTokens.reduce((total, token) => total + (text.includes(token) ? 8 : 0), 0) + (item.name === keyword ? 20 : 0) + (item.name?.includes(keyword) ? 8 : 0) + similarity + intentBonus + businessMismatch + subtypeMismatch;
        };
        return score(b) - score(a);
      });
      if (!province || candidates.length) {
        res.json({ status: '1', info: 'OK', infocode: '10000', count: String(ordered.length), geocodes: ordered.map(item => ({ formatted_address: item.address ? `${item.pname || ''}${item.cityname || ''}${item.adname || ''}${item.address}` : item.name, location: item.location, level: '兴趣点', name: item.name, type: item.type })) });
        return;
      }
    }
    res.json(await amap('/v3/geocode/geo', { address, city: req.query.city || '' }));
  }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/place-photos', async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    const address = String(req.query.address || '').trim();
    if (!name || !address) throw new Error('请提供地点名称和完整地址');
    const province = ['新疆', '西藏', '内蒙古', '宁夏', '广西', '北京', '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '台湾', '香港', '澳门'].find(alias => address.includes(alias)) || '';
    const city = [...address.matchAll(/([\u4e00-\u9fa5]{2,}?(?:自治区|自治州|地区|市|县|区))/g)].map(match => match[1]).at(-1) || province;
    const data = await amap('/v5/place/text', { keywords: address, region: city, city_limit: city ? 'true' : 'false', page_size: '10', page_num: '1', show_fields: 'business,photos' });
    const poiPhotos = poi => Array.isArray(poi.photos) ? poi.photos : (poi.photos?.url ? [poi.photos] : []);
    const candidates = (data.pois || []).filter(poi => poiPhotos(poi).length).map(poi => {
      const text = `${poi.name || ''}${poi.pname || ''}${poi.cityname || ''}${poi.adname || ''}${poi.address || ''}`;
      const nameScore = [...new Set(name.replace(/[\s·()（）]/g, ''))].filter(char => (poi.name || '').includes(char)).length;
      return { poi, score: (poi.name === name ? 100 : poi.name?.includes(name) ? 45 : 0) + nameScore + (province && text.includes(province) ? 25 : 0) };
    }).sort((a, b) => b.score - a.score).slice(0, 3);
    const photos = candidates.flatMap(({ poi }) => poiPhotos(poi).slice(0, 4).map(photo => ({ url: photo.url, title: photo.title || poi.name || name, poiName: poi.name || name, address: `${poi.pname || ''}${poi.cityname || ''}${poi.adname || ''}${poi.address || ''}` }))).filter(photo => photo.url);
    res.json({ photos: photos.slice(0, 8) });
  } catch (error) { res.status(400).json({ error: error.message || '高德图片查询失败' }); }
});

app.get('/api/place-details', async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    const address = String(req.query.address || '').trim();
    if (!name || !address) throw new Error('请提供地点名称和完整地址');
    const province = ['新疆', '西藏', '内蒙古', '宁夏', '广西', '北京', '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '台湾', '香港', '澳门'].find(alias => address.includes(alias)) || '';
    const city = [...address.matchAll(/([\u4e00-\u9fa5]{2,}?(?:自治区|自治州|地区|市|县|区))/g)].map(match => match[1]).at(-1) || province;
    const data = await amap('/v5/place/text', { keywords: address, region: city, city_limit: city ? 'true' : 'false', page_size: '10', page_num: '1', show_fields: 'business,photos' });
    const pois = data.pois || [];
    const ranked = pois.map(poi => {
      const text = `${poi.name || ''}${poi.pname || ''}${poi.cityname || ''}${poi.adname || ''}${poi.address || ''}`;
      const nameScore = [...new Set(name.replace(/[\s·()（）]/g, ''))].filter(char => (poi.name || '').includes(char)).length;
      return { poi, score: (poi.name === name ? 100 : poi.name?.includes(name) ? 45 : 0) + nameScore + (province && text.includes(province) ? 25 : 0) };
    }).sort((a, b) => b.score - a.score);
    const poi = ranked[0]?.poi;
    if (!poi) throw new Error('高德未找到对应地点');
    const ext = poi.business || poi.biz_ext || {};
    const text = value => Array.isArray(value) ? value.filter(Boolean).join('、') : String(value || '');
    res.json({ poi: { id: poi.id || '', name: poi.name || name, intro: text(poi.intro || poi.description), openTime: text(ext.opentime_week || ext.opentime_today || poi.opentime_week || poi.opentime || poi.opening_hours), rating: text(ext.rating || poi.rating), referenceCost: text(ext.cost || poi.cost), tags: text(ext.keytag || ext.rectag || poi.tag || poi.alias), ticketPrice: text(poi.price || ext.price), address: `${poi.pname || ''}${poi.cityname || ''}${poi.adname || ''}${poi.address || ''}`, location: poi.location || '' } });
  } catch (error) { res.status(400).json({ error: error.message || '高德 POI 详情查询失败' }); }
});

app.post('/api/route', async (req, res) => {
  try {
    const { origin, destination, waypoints = [], strategy = '32', mode = 'driving', city, cityd } = req.body;
    if (!origin || !destination) throw new Error('起点和终点不能为空');
    const normalizePath = path => ({
      ...path,
      duration: path.duration || path.cost?.duration || '0',
      tolls: path.cost?.tolls || '0',
      toll_distance: path.cost?.toll_distance || '0',
      traffic_lights: path.cost?.traffic_lights || '0',
      steps: (path.steps || []).map(step => ({ ...step, distance: step.step_distance || step.distance || '0', polyline: step.polyline || '' }))
    });
    if (mode === 'walking') {
      if (waypoints.length) throw new Error('高德步行路线暂不支持途经点，请拆分为多个路程事件');
      const data = await amap('/v3/direction/walking', { origin, destination });
      const paths = (data.route?.paths || []).map(normalizePath);
      if (!paths.length) throw new Error('高德没有返回可用步行路线');
      res.json({ ...data, route: { ...data.route, paths } }); return;
    }
    if (mode === 'bicycling') {
      if (waypoints.length) throw new Error('高德骑行路线暂不支持途经点，请拆分为多个路程事件');
      const data = await amap('/v4/direction/bicycling', { origin, destination });
      const paths = (data.data?.paths || []).map(normalizePath);
      if (!paths.length || Number(data.errcode || 0) !== 0) throw new Error(data.errdetail || data.errmsg || '高德没有返回可用骑行路线');
      res.json({ ...data, route: { origin, destination, paths } }); return;
    }
    if (mode === 'transit') {
      if (waypoints.length) throw new Error('高德公共交通路线暂不支持途经点，请拆分为多个路程事件');
      if (!city) throw new Error('公共交通需要填写公交起点城市');
      const data = await amap('/v3/direction/transit/integrated', { origin, destination, city, ...(cityd ? { cityd } : {}), strategy: '0', extensions: 'all' });
      const transit = data.route?.transits?.[0];
      if (!transit) throw new Error('高德没有返回可用公共交通方案');
      const steps = (transit.segments || []).flatMap(segment => [
        ...(segment.walking?.steps || []),
        ...(segment.bus?.buslines || []).map(line => ({ instruction: line.name || '公共交通', road: line.name || '', distance: line.distance || '0', duration: line.duration || '0', polyline: line.polyline || '' })),
        ...(segment.railway?.trip ? [{ instruction: segment.railway.trip, road: segment.railway.name || '铁路', distance: segment.railway.distance || '0', duration: segment.railway.time || '0', polyline: segment.railway.polyline || '' }] : [])
      ]).filter(step => step.polyline || step.distance);
      const distance = Number(transit.distance || steps.reduce((sum, step) => sum + Number(step.distance || 0), 0));
      const paths = [{ distance, duration: transit.duration || '0', tolls: transit.cost || '0', toll_distance: '0', steps }];
      res.json({ ...data, route: { ...data.route, paths } }); return;
    }
    const params = { origin, destination, strategy, show_fields: 'cost,polyline' };
    if (waypoints.length) params.waypoints = waypoints.join(';');
    const data = await amap('/v5/direction/driving', params);
    const paths = (data.route?.paths || []).map(normalizePath);
    if (!paths.length) throw new Error('高德没有返回可用驾车路线');
    res.json({ ...data, route: { ...data.route, paths } });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/weather', async (req, res) => {
  try {
    const latitude = Number(req.query.latitude), longitude = Number(req.query.longitude);
    const date = String(req.query.date || ''), time = String(req.query.time || '12:00');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请提供地点坐标和行程日期');
    const cacheKey = `${qweatherKey ? 'qweather' : 'open-meteo'}:${latitude.toFixed(4)},${longitude.toFixed(4)}:${date}:${time.slice(0, 2)}`;
    if (weatherCache[cacheKey]) { res.json({ ...weatherCache[cacheKey], cached: true }); return; }
    // 和风格点逐小时数据优先；其预报窗口覆盖不到的日期自动回退至 Open-Meteo。
    if (qweatherKey) {
      try {
        const qweatherResponse = await fetch(`https://devapi.qweather.com/v7/grid-weather/1h?${new URLSearchParams({ location: `${longitude},${latitude}`, key: qweatherKey })}`);
        const qweather = await qweatherResponse.json();
        const targetHour = `${date}T${time.slice(0, 2).padStart(2, '0')}`;
        const hourly = qweather.hourly?.find(item => String(item.fxTime || '').startsWith(targetHour));
        if (qweather.code === '200' && hourly) {
          const result = {
            source: 'QWeather', latitude, longitude, time: hourly.fxTime, conditionText: hourly.text,
            temperature: Number(hourly.temp), apparentTemperature: Number(hourly.feelsLike), precipitationProbability: Number(hourly.pop), precipitation: Number(hourly.precip),
            windSpeed: Number(hourly.windSpeed), windGusts: Number(hourly.windGust), queriedAt: new Date().toISOString()
          };
          weatherCache[cacheKey] = result;
          await saveWeatherCache();
          res.json({ ...result, cached: false });
          return;
        }
      } catch { /* 和风短期预报不可用时使用下方全球格点备选。 */ }
    }
    const query = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), timezone: 'Asia/Shanghai', start_date: date, end_date: date, hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m' });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
    if (!response.ok) throw new Error(`天气服务响应 ${response.status}`);
    const data = await response.json();
    const hour = `${date}T${time.slice(0, 2).padStart(2, '0')}:00`;
    const index = data.hourly?.time?.indexOf(hour) ?? -1;
    if (index < 0) throw new Error('该日期暂未提供逐小时天气预报；请临近出发时再查询');
    const result = {
      source: 'Open-Meteo', latitude: data.latitude, longitude: data.longitude, time: hour,
      temperature: data.hourly.temperature_2m?.[index], apparentTemperature: data.hourly.apparent_temperature?.[index],
      precipitationProbability: data.hourly.precipitation_probability?.[index], precipitation: data.hourly.precipitation?.[index],
      weatherCode: data.hourly.weather_code?.[index], windSpeed: data.hourly.wind_speed_10m?.[index], windGusts: data.hourly.wind_gusts_10m?.[index], queriedAt: new Date().toISOString()
    };
    weatherCache[cacheKey] = result;
    await saveWeatherCache();
    res.json({ ...result, cached: false });
  } catch (error) { res.status(400).json({ error: error.message || '天气查询失败' }); }
});

let plannerDataWrite = Promise.resolve();
app.get('/api/planner-data', async (req, res) => {
  try { res.json({ data: JSON.parse(await readFile(plannerDataFile, 'utf8')) }); }
  catch (error) { if (error.code === 'ENOENT') res.json({ data: null }); else res.status(500).json({ error: '无法读取本地行程文件' }); }
});
app.put('/api/planner-data', async (req, res) => {
  try {
    const data = { ...req.body, savedAt: new Date().toISOString() };
    plannerDataWrite = plannerDataWrite.then(async () => {
      await mkdir(dataDir, { recursive: true });
      const temporaryFile = `${plannerDataFile}.tmp`;
      await writeFile(temporaryFile, JSON.stringify(data, null, 2), 'utf8');
      await rename(temporaryFile, plannerDataFile);
    });
    await plannerDataWrite;
    res.json({ ok: true, savedAt: data.savedAt });
  } catch { res.status(500).json({ error: '无法写入本地行程文件' }); }
});

app.listen(process.env.PORT || 3000, () => console.log(`Roadtrip planner: http://localhost:${process.env.PORT || 3000}`));
