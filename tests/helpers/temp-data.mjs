// 测试隔离：每个测试进程使用进程独占的临时数据目录。
// 原先四个后端测试共用仓库内固定路径 `work/cloud-*-test.json`，两个运行（并发会话、
// 被中断/强杀的进程）会互争同名文件锁并留下 0 字节残留锁，导致后续运行必然全部失败。
// 这里只为**合成数据**提供独占路径；正式行程、账号与照片从不写入临时目录。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function isolatedDataFile(name) {
  const directory = mkdtempSync(join(tmpdir(), `roadtrip-${name}-test-`));
  // 进程被强杀时目录会留在系统临时目录，由操作系统回收；这里只负责正常退出时清理。
  process.once('exit', () => {
    try { rmSync(directory, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响测试结果 */ }
  });
  return join(directory, 'cloud-dev.json');
}
