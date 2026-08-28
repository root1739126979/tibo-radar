import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuotaSample } from '../src/quota/normalize.js';
import { detectQuotaReset, formatQuotaResetNotification } from '../src/quota/detect-reset.js';

test('normalizes the account-wide Codex weekly window', () => {
  const sample = normalizeQuotaSample({
    rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1 } },
    rateLimitsByLimitId: {
      codex_bengalfox: { limitId: 'codex_bengalfox', secondary: { usedPercent: 4, windowDurationMins: 10_080, resetsAt: 20 } },
      codex: { limitId: 'codex', planType: 'pro', primary: { usedPercent: 31, windowDurationMins: 10_080, resetsAt: 1_800_000_000 } }
    }
  }, new Date('2026-08-28T00:00:00Z'));

  assert.equal(sample.usedPercent, 31);
  assert.equal(sample.remainingPercent, 69);
  assert.equal(sample.planType, 'pro');
  assert.equal(sample.resetsAt, '2027-01-15T08:00:00.000Z');
});

test('detects a large used-percent drop and records the pre-reset remainder', () => {
  const event = detectQuotaReset(
    { sampledAt: '2026-01-01T00:00:00Z', usedPercent: 72, remainingPercent: 28, resetsAt: '2026-01-02T00:00:00Z' },
    { sampledAt: '2026-01-01T00:10:00Z', usedPercent: 1, remainingPercent: 99, resetsAt: '2026-01-08T00:10:00Z' }
  );
  assert.equal(event.unusedPercentBeforeReset, 28);
  assert.equal(event.evidence, 'usage_drop');
});

test('detects a reset-time jump even when an almost-unused account stays near full', () => {
  const event = detectQuotaReset(
    { sampledAt: '2026-01-01T00:00:00Z', usedPercent: 1, remainingPercent: 99, resetsAt: '2026-01-04T00:00:00Z' },
    { sampledAt: '2026-01-01T00:10:00Z', usedPercent: 0, remainingPercent: 100, resetsAt: '2026-01-08T00:10:00Z' }
  );
  assert.equal(event.unusedPercentBeforeReset, 99);
  assert.equal(event.evidence, 'reset_time_shift');
});

test('does not misclassify a ten-minute sliding reset timestamp', () => {
  assert.equal(detectQuotaReset(
    { sampledAt: '2026-01-01T00:00:00Z', usedPercent: 0, remainingPercent: 100, resetsAt: '2026-01-08T00:00:00Z' },
    { sampledAt: '2026-01-01T00:10:00Z', usedPercent: 0, remainingPercent: 100, resetsAt: '2026-01-08T00:10:00Z' }
  ), null);
});

test('describes a fresh pre-reset sample as approximate and an old one as last known', () => {
  const event = { detectedAt: '2026-01-01T03:00:00Z', previousSampledAt: '2026-01-01T02:50:00Z', unusedPercentBeforeReset: 28, currentRemainingPercent: 99 };
  assert.match(formatQuotaResetNotification(event).body, /重置前约剩余 28%/);
  assert.match(formatQuotaResetNotification({ ...event, previousSampledAt: '2026-01-01T00:00:00Z' }).body, /最近已知剩余 28%.*无法精确确认重置瞬间余额/s);
});
