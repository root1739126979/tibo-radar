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
    detectedAt: current.sampledAt,
    previousSampledAt: previous.sampledAt,
    unusedPercentBeforeReset: previous.remainingPercent,
    usedPercentBeforeReset: previous.usedPercent,
    usedPercentAfterReset: current.usedPercent,
    previousResetsAt: previous.resetsAt,
    currentResetsAt: current.resetsAt,
    evidence: largeUsageDrop ? 'usage_drop' : 'reset_time_shift'
  };
}
