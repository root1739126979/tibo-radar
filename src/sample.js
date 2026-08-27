import { readAccountRateLimits } from './quota/app-server.js';
import { normalizeQuotaSample } from './quota/normalize.js';
import { detectQuotaReset } from './quota/detect-reset.js';
import { appendError, appendJsonLine, readJson, withFileLock, writeJsonAtomic } from './storage.js';
import { dataDirectory, errorsPath, eventsPath, historyPath, lockPath, statePath } from './paths.js';
import { notifyWindows } from './notify-windows.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function sampleQuota() {
  return withFileLock(lockPath, async () => {
    const state = await readJson(statePath, { version: 1, lastSample: null, lastResetEvent: null });
    const raw = await readAccountRateLimits();
    const sample = normalizeQuotaSample(raw);
    const event = detectQuotaReset(state.lastSample, sample);

    await appendJsonLine(historyPath, sample);
    if (event) {
      await appendJsonLine(eventsPath, event);
      state.lastResetEvent = event;
    }
    state.lastSample = sample;
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(statePath, state);

    if (event) {
      await notifyWindows('Tibo Radar：配额已经重置', `重置到来时还有 ${event.unusedPercentBeforeReset}% 周配额未使用。`);
    }
    return { sample, event, dataDirectory };
  });
}

async function main() {
  try {
    const result = await sampleQuota();
    if (result.skipped) {
      console.log(`采样已跳过：${result.reason}`);
      return;
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await appendError(errorsPath, error?.stack ?? error);
    console.error(`配额采样失败：${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
