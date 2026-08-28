import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { readAccountRateLimits } from './quota/app-server.js';
import { normalizeQuotaSample } from './quota/normalize.js';
import { readLiveSignals } from './tibo/live-signals.js';
import { readJson } from './storage.js';
import { errorsPath, outboxPath, serverChanSecretPath, statePath } from './paths.js';
import { isLocalServerChanConfigured } from './local-serverchan.js';
import { redactServerChanSecret } from './serverchan.js';
import { inspectCloudAppConfiguration, summarizeAppConfiguration } from './app-configuration-status.js';

const execFileAsync = promisify(execFile);

function localTime(isoDate) {
  if (!isoDate) return '未知';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(isoDate));
}

async function safe(action) {
  try { return { ok: true, value: await action() }; }
  catch (error) { return { ok: false, error: redactServerChanSecret(error?.message ?? error) }; }
}

async function scheduledTaskHealth() {
  if (process.platform !== 'win32') return '不适用';
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "(Get-ScheduledTask -TaskName 'TiboRadarQuotaMonitor' -ErrorAction Stop).State"
  ], { windowsHide: true, timeout: 10_000, encoding: 'utf8' });
  return stdout.trim() || '未知';
}

async function recentError() {
  try {
    const lines = (await readFile(errorsPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
    return lines.length ? redactServerChanSecret(lines.at(-1)) : '无';
  } catch (error) {
    if (error?.code === 'ENOENT') return '无';
    throw error;
  }
}

async function main() {
  const [quotaResult, signalsResult, stateResult, taskResult, localConfigResult, cloudConfigResult, outboxResult, errorResult] = await Promise.all([
    safe(async () => normalizeQuotaSample(await readAccountRateLimits())),
    safe(() => readLiveSignals({ maxAgeHours: 168 })),
    safe(() => readJson(statePath, { lastResetEvent: null })),
    safe(scheduledTaskHealth),
    safe(() => isLocalServerChanConfigured(serverChanSecretPath)),
    safe(() => inspectCloudAppConfiguration()),
    safe(() => readJson(outboxPath, { items: [] })),
    safe(recentError)
  ]);

  console.log('Tibo Radar 状态');
  if (quotaResult.ok) {
    const quota = quotaResult.value;
    console.log(`周配额剩余：${quota.remainingPercent}%（已用 ${quota.usedPercent}%）`);
    console.log(`自然重置时间：${localTime(quota.resetsAt)}`);
    console.log(`账号计划：${quota.planType ?? '未知'}`);
  } else console.log(`周配额：未知（${quotaResult.error}）`);

  const latestSignal = signalsResult.ok ? signalsResult.value.signals.at(-1) : null;
  if (latestSignal) {
    console.log(`最新 Tibo 信号：${latestSignal.phase === 'completed' ? '已经重置' : '即将重置'}，${localTime(latestSignal.at)}`);
    if (latestSignal.url) console.log(`来源：${latestSignal.url}`);
  } else console.log(`最新 Tibo 信号：${signalsResult.ok ? '最近 7 天无可用信号' : '未知'}`);

  const reset = stateResult.ok ? stateResult.value?.lastResetEvent : null;
  console.log(reset
    ? `最近真实重置：${localTime(reset.detectedAt)}，最近样本剩余 ${reset.unusedPercentBeforeReset}%`
    : `最近真实重置：${stateResult.ok ? '尚无本机事件记录' : '未知'}`);
  console.log(`计划任务：${taskResult.ok ? taskResult.value : '未知'}`);
  const appConfiguration = summarizeAppConfiguration(localConfigResult, cloudConfigResult);
  console.log(`App 通知：${appConfiguration.overall}`);
  console.log(`  本机密钥：${appConfiguration.local}`);
  console.log(`  云端链路：${appConfiguration.cloud}`);
  const pending = outboxResult.ok && Array.isArray(outboxResult.value?.items)
    ? outboxResult.value.items.filter((item) => item.status === 'pending').length : null;
  console.log(`待发送通知：${pending ?? '未知'}`);
  console.log(`最近错误：${errorResult.ok ? errorResult.value : '未知'}`);
  if (signalsResult.ok) for (const warning of signalsResult.value.warnings) console.warn(`数据源警告：${warning}`);
}

main().catch((error) => {
  console.error(`状态查询失败：${redactServerChanSecret(error.message)}`);
  process.exitCode = 1;
});
