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
  .replaceAll('src="/', 'src="./')
  .replace('<script src="./plans.js"></script>', '<script src="./share-config.js"></script><script src="./plans.js"></script>');
await writeFile(indexPath, index, 'utf8');

console.log(`已构建只读共享页：docs（数据更新时间：${updatedAt}）`);
