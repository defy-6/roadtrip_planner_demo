import { runtime } from './shared/runtime.js';
import { createApi } from './services/api.js';
import { createPersistence } from './storage/persistence.js';
import { createPlannerMigrations, migratePlannerData } from './storage/migrations.js';
import { startRuntime } from './features/runtime.js';

const api = createApi();
const persistence = createPersistence({ runtime, api, onSaveStatus: text => { const node = document.querySelector('#fileSaveStatus'); if (node) node.textContent = text; } });

startRuntime({
  runtime,
  api,
  persistence,
  migrate: (data, typeForTitle) => migratePlannerData(data, createPlannerMigrations({ typeForTitle, createId: () => crypto.randomUUID(), readFlag: persistence.readFlag, writeFlag: persistence.writeFlag, pendingAddressMigrationKey: 'roadtrip-pending-addresses-v1' }))
});
