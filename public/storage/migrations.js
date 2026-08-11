export function migratePlannerData(rawData, migrations = []) {
  return migrations.reduce((data, migrate) => migrate(data), structuredClone(rawData || {}));
}
