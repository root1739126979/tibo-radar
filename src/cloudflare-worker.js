import { cloudflareStateKeys, runCloudflareMonitor } from './cloudflare-monitor.js';
import { redactServerChanSecret, sendServerChan } from './serverchan.js';

const CRON_HEALTH_WINDOW_MS = 15 * 60_000;

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'cache-control': 'no-store' }
  });
}

function authorized(request, token) {
  return typeof token === 'string'
    && token.length >= 20
    && request.headers.get('authorization') === `Bearer ${token}`;
}

function parseState(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function stateTime(value) {
  const timestamp = Date.parse(value?.checkedAt ?? '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function createCloudflareWorker({
  monitor = runCloudflareMonitor,
  now = () => new Date(),
  sendSmoke = (message, env) => sendServerChan({
    sendKey: env.SERVERCHAN_SENDKEY,
    ...message
  })
} = {}) {
  return {
    async scheduled(_controller, env) {
      try {
        const result = await monitor({ env, now });
        await env.TIBO_STATE.delete(cloudflareStateKeys.lastFailure);
        console.log(JSON.stringify({ event: 'scheduled', ...result }));
        return result;
      } catch (error) {
        const failure = {
          checkedAt: now().toISOString(),
          message: redactServerChanSecret(error?.message ?? error).slice(0, 500)
        };
        await env.TIBO_STATE.put(cloudflareStateKeys.lastFailure, JSON.stringify(failure));
        console.error(JSON.stringify({ event: 'scheduled-failure', ...failure }));
        throw error;
      }
    },

    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      if (request.method === 'GET' && pathname === '/health') {
        const [enabledAt, lastRunValue, lastFailureValue] = await Promise.all([
          env.TIBO_STATE.get(cloudflareStateKeys.enabledAt),
          env.TIBO_STATE.get(cloudflareStateKeys.lastRun),
          env.TIBO_STATE.get(cloudflareStateKeys.lastFailure)
        ]);
        const lastRun = parseState(lastRunValue);
        const lastFailure = parseState(lastFailureValue);
        const lastRunAt = stateTime(lastRun);
        const lastFailureAt = stateTime(lastFailure);
        const age = lastRunAt === null ? Number.POSITIVE_INFINITY : now().getTime() - lastRunAt;
        const cronFresh = age >= -5 * 60_000
          && age <= CRON_HEALTH_WINDOW_MS
          && (lastFailureAt === null || lastFailureAt < lastRunAt);
        const configured = Boolean(env.SERVERCHAN_SENDKEY && env.ADMIN_TOKEN && enabledAt);
        const ok = configured && cronFresh;
        return json({
          ok,
          configured,
          cronFresh,
          enabledAt,
          lastRun,
          lastFailure: lastFailure ? { checkedAt: lastFailure.checkedAt ?? null } : null
        }, ok ? 200 : 503);
      }

      if (request.method === 'POST' && pathname === '/__smoke') {
        if (!authorized(request, env.ADMIN_TOKEN)) return json({ ok: false }, 401);
        try {
          await sendSmoke({
            title: '[云端测试] Tibo Radar App 通知',
            body: 'Cloudflare Worker 与 Server酱³ App 通知链路配置成功。'
          }, env);
          const enabledAt = await env.TIBO_STATE.get(cloudflareStateKeys.enabledAt);
          if (!enabledAt) {
            await env.TIBO_STATE.put(cloudflareStateKeys.enabledAt, now().toISOString());
          }
          return json({ ok: true });
        } catch (error) {
          console.error(`[cloud-smoke] ${redactServerChanSecret(error?.message ?? error)}`);
          return json({ ok: false }, 502);
        }
      }

      return json({ ok: false }, 404);
    }
  };
}

export default createCloudflareWorker();
