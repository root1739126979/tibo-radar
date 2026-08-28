const MINUTE_MS = 60_000;

function timestamp(value) {
  const result = Date.parse(value ?? '');
  return Number.isFinite(result) ? result : null;
}

export function detectQuotaReset(previous, current) {
  if (!previous || !current) return null;

  const usedDrop = previous.usedPercent - current.usedPercent;
  const previousResetAt = timestamp(previous.resetsAt);
  const currentResetAt = timestamp(current.resetsAt);
  const resetTimeShiftMinutes = previousResetAt === null || currentResetAt === null
    ? 0
    : (currentResetAt - previousResetAt) / MINUTE_MS;

  const largeUsageDrop = usedDrop >= 10 && current.usedPercent <= 5;
  const shiftedWindow = resetTimeShiftMinutes >= 30 && current.usedPercent <= 5 && usedDrop >= 0;
  if (!largeUsageDrop && !shiftedWindow) return null;

  return {
    key: `quota-reset:${current.sampledAt}`,
    detectedAt: current.sampledAt,
    previousSampledAt: previous.sampledAt,
    unusedPercentBeforeReset: previous.remainingPercent,
    usedPercentBeforeReset: previous.usedPercent,
    usedPercentAfterReset: current.usedPercent,
    currentRemainingPercent: current.remainingPercent,
    previousResetsAt: previous.resetsAt,
    currentResetsAt: current.resetsAt,
    evidence: largeUsageDrop ? 'usage_drop' : 'reset_time_shift'
  };
}

export function formatQuotaResetNotification(event) {
  const sampleAgeMs = Date.parse(event.detectedAt) - Date.parse(event.previousSampledAt);
  const fresh = Number.isFinite(sampleAgeMs) && sampleAgeMs >= 0 && sampleAgeMs <= 20 * MINUTE_MS;
  const balance = fresh
    ? `重置前约剩余 ${event.unusedPercentBeforeReset}%（样本时间：${event.previousSampledAt}）`
    : `最近已知剩余 ${event.unusedPercentBeforeReset}%（样本时间：${event.previousSampledAt}），无法精确确认重置瞬间余额`;
  return {
    title: '你的周配额已经重置',
    body: [
      `本机确认时间：${event.detectedAt}`,
      balance,
      `新周期当前剩余：${event.currentRemainingPercent}%`
    ].join('\n')
  };
}
