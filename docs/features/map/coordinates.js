// 坐标转换：纯算法，不访问 DOM 与 Leaflet。
// 高德接口与高德底图均使用 GCJ-02；地图绘制不再转换为 WGS-84，避免点线与道路产生偏移。
export const useAmapBaseMap = true;

export function outOfChina(lng, lat) { return lng < 72.004 || lng > 137.8347 || lat < .8293 || lat > 55.8271; }

export function gcjToWgs(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  const transformLat = (x, y) => -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x)) + (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3 + (20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3 + (160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3;
  const transformLng = (x, y) => 300 + x + 2*y + .1*x*x + .1*x*y + .1*Math.sqrt(Math.abs(x)) + (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3 + (20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3 + (150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3;
  const a = 6378245, ee = .00669342162296594323, dLat = transformLat(lng - 105, lat - 35), dLng = transformLng(lng - 105, lat - 35), rad = lat / 180 * Math.PI, magic = 1 - ee * Math.sin(rad) ** 2, sqrtMagic = Math.sqrt(magic);
  const mgLat = lat + dLat * 180 / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI), mgLng = lng + dLng * 180 / (a / sqrtMagic * Math.cos(rad) * Math.PI);
  return [lng * 2 - mgLng, lat * 2 - mgLat];
}

export function mapCoords(lng, lat) { return useAmapBaseMap ? [lng, lat] : gcjToWgs(lng, lat); }
