import { access, mkdir } from 'node:fs/promises';
import { readAccountRateLimits } from './quota/app-server.js';
import { normalizeQuotaSample } from './quota/normalize.js';
import { readLiveSignals } from './tibo/live-signals.js';
import { dataDirectory } from './paths.js';

async function check(name, action) {
  try {
    const detail = await action();
    console.log(`✓ ${name}${detail ? `：${detail}` : ''}`);
    return true;
  } catch (error) {
    console.error(`✗ ${name}：${error.message}`);
    return false;
  }
}

const results = await Promise.all([
  check('Node.js', async () => process.version),
  check('本地数据目录', async () => { await mkdir(dataDirectory, { recursive: true }); await access(dataDirectory); return dataDirectory; }),
  check('Codex 配额接口', async () => `${normalizeQuotaSample(await readAccountRateLimits()).remainingPercent}% 剩余`),
  check('云端 Tibo 数据源', async () => `${(await readLiveSignals()).signals.length} 个近期信号`)
]);

if (results.some((result) => !result)) process.exitCode = 1;
