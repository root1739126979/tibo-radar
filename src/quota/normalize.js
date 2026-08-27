function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function chooseCodexLimit(payload) {
  const byId = payload?.rateLimitsByLimitId;
  if (byId && typeof byId === 'object' && !Array.isArray(byId)) {
    if (byId.codex && typeof byId.codex === 'object') return byId.codex;
    const exact = Object.values(byId).find((item) => item?.limitId === 'codex');
    if (exact) return exact;
  }
  return payload?.rateLimits ?? null;
}

function chooseWeeklyWindow(limit) {
  const windows = [limit?.primary, limit?.secondary].filter(Boolean);
  return windows.find((window) => finiteNumber(window.windowDurationMins) >= 10_080) ?? null;
}

export function normalizeQuotaSample(payload, sampledAt = new Date()) {
  const limit = chooseCodexLimit(payload);
  const weekly = chooseWeeklyWindow(limit);
  if (!limit || !weekly) throw new Error('Codex weekly rate-limit window was not present in the App Server response');

  const usedPercent = finiteNumber(weekly.usedPercent);
  const resetsAtSeconds = finiteNumber(weekly.resetsAt);
  const duration = finiteNumber(weekly.windowDurationMins);
  if (usedPercent === null || duration === null) throw new Error('Codex weekly rate-limit window contains invalid numbers');

  return {
    sampledAt: sampledAt.toISOString(),
    limitId: String(limit.limitId ?? 'codex'),
    planType: limit.planType ? String(limit.planType) : null,
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    remainingPercent: Math.min(100, Math.max(0, 100 - usedPercent)),
    windowDurationMins: duration,
    resetsAt: resetsAtSeconds === null ? null : new Date(resetsAtSeconds * 1000).toISOString(),
    rateLimitReachedType: limit.rateLimitReachedType ? String(limit.rateLimitReachedType) : null
  };
}
