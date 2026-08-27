import { readAccountRateLimits } from './quota/app-server.js';
import { normalizeQuotaSample } from './quota/normalize.js';
import { readLiveSignals } from './tibo/live-signals.js';
import { readJson } from './storage.js';
import { statePath } from './paths.js';

function localTime(isoDate) {
  if (!isoDate) return '未知';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(isoDate));
}

async function main() {
  const [rawQuota, liveSignals, state] = await Promise.all([
    readAccountRateLimits(),
    readLiveSignals({ maxAgeHours: 168 }).catch((error) => ({ signals: [], warnings: [error.message] })),
    readJson(statePath, { lastResetEvent: null })
  ]);
  const quota = normalizeQuotaSample(rawQuota);
  const latestSignal = liveSignals.signals.at(-1);

  console.log('Tibo Radar 状态');
  console.log(`周配额剩余：${quota.remainingPercent}%（已用 ${quota.usedPercent}%）`);
  console.log(`自然重置时间：${localTime(quota.resetsAt)}`);
  console.log(`账号计划：${quota.planType ?? '未知'}`);
  if (latestSignal) {
    console.log(`最新 Tibo 信号：${latestSignal.phase === 'completed' ? '已经重置' : '即将重置'}，${localTime(latestSignal.at)}`);
    if (latestSignal.url) console.log(`来源：${latestSignal.url}`);
  } else {
    console.log('最新 Tibo 信号：最近 7 天无可用信号');
  }
  if (state.lastResetEvent) {
    console.log(`最近真实重置：${localTime(state.lastResetEvent.detectedAt)}，当时剩余 ${state.lastResetEvent.unusedPercentBeforeReset}%`);
  } else {
    console.log('最近真实重置：尚无本机事件记录');
  }
  for (const warning of liveSignals.warnings) console.warn(`数据源警告：${warning}`);
}

main().catch((error) => {
  console.error(`状态查询失败：${error.message}`);
  process.exitCode = 1;
});
