import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import { errorsPath, lockPath, outboxPath } from './paths.js';
import { clearSentNotifications } from './notification-outbox.js';
import { withFileLock } from './storage.js';

const defaultPaths = { errorsPath, lockPath, outboxPath };

export async function clearDiagnostics({ paths = defaultPaths } = {}) {
  return withFileLock(paths.lockPath, async () => {
    await rm(paths.errorsPath, { force: true });
    const remainingNotifications = await clearSentNotifications(paths.outboxPath);
    return { cleared: true, remainingNotifications };
  });
}

async function main() {
  try {
    const result = await clearDiagnostics();
    if (result.skipped) {
      console.log('诊断清理已跳过：采样正在运行，请稍后重试。');
      return;
    }
    console.log('已清除本机错误日志和已发送通知记录；配额历史、重置事件、待发送通知和 App 密钥均已保留。');
  } catch (error) {
    console.error(`诊断清理失败：${error?.message ?? error}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
