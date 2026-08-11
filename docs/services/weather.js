export function createWeatherService(api) {
  return params => api.getWeather(params);
}
