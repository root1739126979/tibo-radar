import { sendServerChan } from './serverchan.js';
import { readLiveSignals } from './tibo/live-signals.js';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ENABLED_AT_KEY = 'monitor:enabled-at';
const LAST_RUN_KEY = 'monitor:last-run';

function signalKey(signal) {
  return `signal:${signal.key}`;
}

function tiboMessage(signal) {
  return {
    title: signal.resetType === 'banked'
      ? 'Tibo 即将发放 Banked Reset'
      : 'Tibo 即将进行重置',
    body: [
      `信号时间：${signal.at}`,
      signal.effectiveAt ? `预计生效：${signal.effectiveAt}` : null,
      `置信度：${Math.round(signal.confidence * 100)}%`,
      `判断依据：${signal.rationale}`,
      '',
      signal.text,
      signal.url ? `\n原始链接：${signal.url}` : null
    ].filter((line) => line !== null).join('\n')
  };
}

function isFreshUpcoming(signal, now, enabledAt) {
  if (signal?.phase !== 'upcoming') return false;
  const signalTime = Date.parse(signal.at ?? '');
  if (!Number.isFinite(signalTime)) return false;
  const age = now.getTime() - signalTime;
  const effectiveTime = Date.parse(signal.effectiveAt ?? '');
  const hasPendingSchedule = Number.isFinite(effectiveTime)
    && effectiveTime > now.getTime()
    && effectiveTime - now.getTime() <= ONE_DAY_MS;
  return signalTime >= enabledAt
    && age >= -5 * 60_000
    && (age <= TWO_HOURS_MS || hasPendingSchedule);
}

export async function runCloudflareMonitor({
  env,
  now = () => new Date(),
  readSignals = readLiveSignals,
  send = ({ title, body }) => sendServerChan({
    sendKey: env.SERVERCHAN_SENDKEY,
    title,
    body
  })
} = {}) {
  if (!env?.TIBO_STATE) throw new Error('TIBO_STATE KV binding is required');
  const checkedAt = now();
  const enabledValue = await env.TIBO_STATE.get(ENABLED_AT_KEY);
  const enabledAt = Date.parse(enabledValue ?? '');

  if (!Number.isFinite(enabledAt)) {
    await env.TIBO_STATE.put(LAST_RUN_KEY, JSON.stringify({
      checkedAt: checkedAt.toISOString(), enabled: false, delivered: 0, warnings: []
    }));
    return { enabled: false, delivered: 0, warnings: [] };
  }

  const { signals, warnings } = await readSignals({ maxAgeHours: 48 });

  let delivered = 0;
  for (const signal of signals) {
    if (!isFreshUpcoming(signal, checkedAt, enabledAt)) continue;
    if (await env.TIBO_STATE.get(signalKey(signal))) continue;
    await send(tiboMessage(signal));
    await env.TIBO_STATE.put(signalKey(signal), JSON.stringify({
      status: 'sent', sentAt: checkedAt.toISOString(), signalAt: signal.at
    }));
    delivered += 1;
  }

  await env.TIBO_STATE.put(LAST_RUN_KEY, JSON.stringify({
    checkedAt: checkedAt.toISOString(), delivered, warnings
  }));
  return { enabled: true, delivered, warnings };
}

export const cloudflareStateKeys = {
  enabledAt: ENABLED_AT_KEY,
  lastRun: LAST_RUN_KEY,
  lastFailure: 'monitor:last-failure'
};
