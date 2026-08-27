import { readAccountRateLimits } from './quota/app-server.js';
import { normalizeQuotaSample } from './quota/normalize.js';
import { detectQuotaReset } from './quota/detect-reset.js';
import { appendError, appendJsonLine, readJson, withFileLock, writeJsonAtomic } from './storage.js';
import { dataDirectory, errorsPath, eventsPath, historyPath, lockPath, statePath } from './paths.js';
import { notifyWindows } from './notify-windows.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultPaths = { dataDirectory, errorsPath, eventsPath, historyPath, lockPath, statePath };

export async function sampleQuota({
  paths = defaultPaths,
  readRateLimits = readAccountRateLimits,
  notify = notifyWindows,
  now = () => new Date()
} = {}) {
  return withFileLock(paths.lockPath, async () => {
    const state = await readJson(paths.statePath, { version: 1, lastSample: null, lastResetEvent: null });
    const raw = await readRateLimits();
    const sample = normalizeQuotaSample(raw, now());
    const event = detectQuotaReset(state.lastSample, sample);

    await appendJsonLine(paths.historyPath, sample);
    if (event) {
      await appendJsonLine(paths.eventsPath, event);
      state.lastResetEvent = event;
    }
    state.lastSample = sample;
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(paths.statePath, state);

    if (event) {
      try {
        await notify('Tibo Radar：配额已经重置', `重置到来时还有 ${event.unusedPercentBeforeReset}% 周配额未使用。`);
      } catch (error) {
        await appendError(paths.errorsPath, `Desktop notification failed after reset event was recorded: ${error.message}`);
      }
    }
    return { sample, event, dataDirectory: paths.dataDirectory };
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
