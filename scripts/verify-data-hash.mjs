// 正式数据哈希校验：迁移任何 feature 后确认行程数据文件未被意外改动。
// 用法：
//   node scripts/verify-data-hash.mjs --record   # 记录当前哈希为基线
//   node scripts/verify-data-hash.mjs            # 与基线对比（无基线时仅输出）
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [, , arg] = process.argv;
const file = 'data/roadtrip-data.json';
const baselineFile = '.reasonix/data-hash.baseline';
const content = await readFile(file, 'utf8');
const hash = createHash('sha256').update(content).digest('hex');
console.log(`${file} sha256 ${hash}`);

if (arg === '--record') {
  await writeFile(baselineFile, `${hash}\n`, 'utf8');
  console.log(`已记录基线哈希到 ${baselineFile}`);
  process.exit(0);
}

let baseline = '';
try {
  baseline = (await readFile(baselineFile, 'utf8')).trim();
} catch { /* 无基线文件 */ }

if (baseline && hash !== baseline) {
  console.error(`数据哈希校验失败：基线 ${baseline}，实际 ${hash}。迁移可能误改数据文件。`);
  process.exitCode = 1;
} else if (baseline) {
  console.log('数据哈希校验通过：正式行程数据未被改动。');
} else {
  console.log('未找到基线哈希，跳过对比。');
}
