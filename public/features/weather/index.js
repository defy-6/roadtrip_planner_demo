export const weatherCodeLabel = code => ({ 0: '晴', 1: '大致晴', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇', 51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 75: '大雪', 80: '阵雨', 81: '阵雨', 82: '强阵雨', 95: '雷雨', 96: '冰雹雷雨', 99: '强冰雹雷雨' }[Number(code)] || '天气待定');

export function weatherSummary(weather) {
  if (!weather) return '';
  const condition = weather.conditionText || weatherCodeLabel(weather.weatherCode);
  const parts = [`${condition} ${Number(weather.temperature).toFixed(0)}°C`];
  if (Number.isFinite(Number(weather.precipitationProbability))) parts.push(`降水 ${Number(weather.precipitationProbability).toFixed(0)}%`);
  if (Number.isFinite(Number(weather.windSpeed))) parts.push(`风 ${Number(weather.windSpeed).toFixed(0)}km/h`);
  return parts.join(' · ');
}
