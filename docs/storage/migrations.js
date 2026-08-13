// P1 migration boundary. Register versioned migrations here before load-time use.
export function migratePlannerData(rawData, migrations = []) {
  return migrations.reduce((data, migrate) => migrate(data), structuredClone(rawData || {}));
}
