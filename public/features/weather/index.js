export const weatherCodeLabel = code => ({ 0: '晴', 1: '大致晴', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇', 51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪', 80: '阵雨', 81: '阵雨', 82: '强阵雨', 95: '雷雨', 96: '冰雹雷雨', 99: '强冰雹雷雨' }[Number(code)] || '天气待定');

export function weatherCategory(weather) {
  const code = String(weather?.conditionCode ?? weather?.icon ?? '');
  if (weather?.provider === 'qweather' || weather?.source === 'QWeather' || Number(code) >= 100) {
    if (['304'].includes(code)) return 'hail';
    if (['302', '303'].includes(code)) return 'thunder';
    if (['404', '405', '406', '456', '457'].includes(code)) return 'sleet';
    if (code === '313') return 'freezing-rain';
    if (code === '309') return 'drizzle';
    if (['300', '301'].includes(code)) return 'shower';
    if (['307', '308', '310', '311', '312', '316', '317', '318'].includes(code)) return 'heavy-rain';
    if (/^3\d\d$/.test(code)) return 'rain';
    if (['400', '407', '408'].includes(code)) return 'light-snow';
    if (['402', '403', '409', '410'].includes(code)) return 'heavy-snow';
    if (/^4\d\d$/.test(code)) return 'snow';
    if (['502', '511', '512', '513'].includes(code)) return 'haze';
    if (['507', '508'].includes(code)) return 'sandstorm';
    if (['503', '504'].includes(code)) return 'dust';
    if (/^5\d\d$/.test(code)) return 'fog';
    if (['100', '150'].includes(code)) return 'clear';
    if (['102', '152'].includes(code)) return 'mostly-clear';
    if (['103', '153'].includes(code)) return 'partly-cloudy';
    if (['101', '151'].includes(code)) return 'cloudy';
    if (code === '104') return 'overcast';
  } else if (code) {
    const number = Number(code);
    if ([96, 99].includes(number)) return 'hail';
    if (number === 95) return 'thunder';
    if ([66, 67].includes(number)) return 'freezing-rain';
    if ([51, 53, 55, 56, 57].includes(number)) return 'drizzle';
    if ([80, 81].includes(number)) return 'shower';
    if ([65, 82].includes(number)) return 'heavy-rain';
    if ([61, 63].includes(number)) return 'rain';
    if ([71, 77, 85].includes(number)) return 'light-snow';
    if ([75, 86].includes(number)) return 'heavy-snow';
    if (number === 73) return 'snow';
    if ([45, 48].includes(number)) return 'fog';
    if (number === 0) return 'clear';
    if (number === 1) return 'mostly-clear';
    if (number === 2) return 'partly-cloudy';
    if (number === 3) return 'overcast';
  }
  const condition = weather?.conditionText || weatherCodeLabel(weather?.weatherCode);
  if (/沙尘暴/.test(condition)) return 'sandstorm';
  if (/扬沙|浮尘|尘卷风/.test(condition)) return 'dust';
  if (/霾/.test(condition)) return 'haze';
  if (/冰雹/.test(condition)) return 'hail';
  if (/冻雨/.test(condition)) return 'freezing-rain';
  if (/雨夹雪|雨雪/.test(condition)) return 'sleet';
  if (/雷/.test(condition)) return 'thunder';
  if (/暴雪|大雪/.test(condition)) return 'heavy-snow';
  if (/小雪|阵雪/.test(condition)) return 'light-snow';
  if (/雪|雾凇/.test(condition)) return 'snow';
  if (/雾/.test(condition)) return 'fog';
  if (/暴雨|大暴雨|特大暴雨|大雨|强阵雨/.test(condition)) return 'heavy-rain';
  if (/阵雨/.test(condition)) return 'shower';
  if (/毛毛雨|细雨/.test(condition)) return 'drizzle';
  if (/雨/.test(condition)) return 'rain';
  if (/晴/.test(condition)) return 'clear';
  if (/晴间多云/.test(condition)) return 'partly-cloudy';
  if (/少云/.test(condition)) return 'mostly-clear';
  if (/多云/.test(condition)) return 'cloudy';
  if (/阴/.test(condition)) return 'overcast';
  return 'unknown';
}

export function weatherVisualKey(weather) {
  return ({ clear: 'sunny', 'mostly-clear': 'mostly-sunny', 'partly-cloudy': 'mostly-sunny', cloudy: 'cloudy', overcast: 'overcast', drizzle: 'drizzle', shower: 'rain', rain: 'rain', 'heavy-rain': 'storm', thunder: 'storm', hail: 'storm', 'light-snow': 'snow', snow: 'snow', 'heavy-snow': 'snow', sleet: 'snow', 'freezing-rain': 'drizzle', fog: 'fog', haze: 'fog', dust: 'sand', sandstorm: 'sand' })[weatherCategory(weather)] || 'unknown';
}

export function weatherBackgroundKey(weather) {
  const category = weatherCategory(weather);
  if (category === 'unknown') return '';
  const assetCategory = ({
    shower: 'rain',
    hail: 'thunder',
    'light-snow': 'snow',
    'heavy-snow': 'snow',
    'freezing-rain': 'sleet',
    haze: 'fog',
    sandstorm: 'dust'
  })[category] || category;
  return `${assetCategory}-${weather?.isNight === true ? 'night' : 'day'}`;
}

export function weatherSummary(weather) {
  if (!weather) return '';
  const condition = weather.conditionText || weatherCodeLabel(weather.weatherCode);
  const parts = [`${condition} ${Number(weather.temperature).toFixed(0)}°C`];
  if (Number.isFinite(Number(weather.precipitationProbability))) parts.push(`降水 ${Number(weather.precipitationProbability).toFixed(0)}%`);
  if (Number.isFinite(Number(weather.windSpeed))) parts.push(`风 ${Number(weather.windSpeed).toFixed(0)}km/h`);
  return parts.join(' · ');
}
