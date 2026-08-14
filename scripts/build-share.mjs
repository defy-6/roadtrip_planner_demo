import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const publicDir = resolve(root, 'public');
const outputDir = resolve(root, 'docs');
const dataPath = resolve(root, 'data/roadtrip-data.json');

await rm(outputDir, { recursive: true, force: true });
await cp(publicDir, outputDir, { recursive: true });

let plannerData;
try {
  plannerData = JSON.parse(await readFile(dataPath, 'utf8'));
} catch (error) {
  throw new Error('未找到 data/roadtrip-data.json。请先在本机打开行程并等待“已写入本地文件”提示后再构建共享页。', { cause: error });
}

// 共享页只发布当前唯一的新疆自驾游计划；兼容本地旧版 A/B 数据。
if (!Array.isArray(plannerData.plans) || !plannerData.plans.length) {
  const legacy = plannerData.versions?.b || plannerData.versions?.a || Object.values(plannerData.versions || {}).find(Boolean);
  if (legacy) {
    const id = 'xinjiang-roadtrip';
    plannerData = {
      ...plannerData,
      activeVersion: id,
      plans: [{ id, name: '新疆自驾游' }],
      versions: { [id]: { ...legacy, name: '新疆自驾游', planKey: id } },
      sharedSchedule: {}
    };
  }
}

const updatedAt = plannerData.updatedAt || new Date().toISOString();
const shareConfig = [
  'window.__ROADTRIP_SHARE_MODE__ = true;',
  `window.__ROADTRIP_SHARE_UPDATED_AT__ = ${JSON.stringify(updatedAt)};`,
  `window.__ROADTRIP_SHARE_DATA__ = ${JSON.stringify(plannerData)};`,
  ''
].join('\n');

await writeFile(resolve(outputDir, 'share-config.js'), shareConfig, 'utf8');
await writeFile(resolve(outputDir, '.nojekyll'), '', 'utf8');

const indexPath = resolve(outputDir, 'index.html');
let index = await readFile(indexPath, 'utf8');
index = index
  .replaceAll('href="/', 'href="./')
  .replaceAll('src="/', 'src="./');

const appScriptPattern = /<script type="module" src="\.\/app\.js([^\"]*)"><\/script>/;
if (!appScriptPattern.test(index)) throw new Error('未找到 app.js 入口，无法注入共享模式数据。');
index = index.replace(appScriptPattern, '<script src="./share-config.js"></script><script type="module" src="./app.js$1"></script>');
await writeFile(indexPath, index, 'utf8');

console.log(`已构建只读共享页：docs（数据更新时间：${updatedAt}）`);
