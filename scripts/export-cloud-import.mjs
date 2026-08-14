// 从本地文件容器生成微信云开发数据库导入文件（NDJSON，控制台「数据库 → 导入」可用）。
// 用法：先在小程序/云端注册账号（微信登录或账号密码），拿到该用户的 _id，
//       把 _id 作为命令行参数传入，如：
//       node scripts/export-cloud-import.mjs <owner_user_id>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const ownerId = process.argv[2];
if (!ownerId) {
  console.error('用法：node scripts/export-cloud-import.mjs <owner_user_id>');
  process.exit(1);
}

const data = JSON.parse(readFileSync(path.join(root, 'data', 'roadtrip-data.json'), 'utf8'));
const name = (data.plans && data.plans[0] && data.plans[0].name) || '新疆自驾游';
const now = new Date().toISOString();
const tripId = randomBytes(12).toString('hex');
const memberId = randomBytes(12).toString('hex');

const outDir = path.join(root, 'work', 'cloud-import');
mkdirSync(outDir, { recursive: true });

const trip = {
  _id: tripId,
  name,
  owner_id: ownerId,
  data,
  share_code: null,
  share_enabled: false,
  created_at: now,
  updated_at: now,
};
const member = {
  _id: memberId,
  trip_id: tripId,
  user_id: ownerId,
  role: 'owner',
  joined_at: now,
};

writeFileSync(path.join(outDir, 'trips.jsonl'), JSON.stringify(trip) + '\n');
writeFileSync(path.join(outDir, 'trip_members.jsonl'), JSON.stringify(member) + '\n');

console.log(`已生成导入文件（owner=${ownerId}）：
  行程: ${name}（trip_id=${tripId}，数据 ${Math.round(JSON.stringify(data).length / 1024)} KB）
  目录: work/cloud-import/
    trips.jsonl         → 导入到「trips」集合
    trip_members.jsonl  → 导入到「trip_members」集合`);
