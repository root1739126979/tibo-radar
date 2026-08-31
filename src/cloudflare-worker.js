import { cloudflareStateKeys, runCloudflareMonitor } from './cloudflare-monitor.js';
import { redactServerChanSecret, sendServerChan } from './serverchan.js';

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
      const result = await monitor({ env, now });
      console.log(JSON.stringify({ event: 'scheduled', ...result }));
      return result;
    },

    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      if (request.method === 'GET' && pathname === '/health') {
        const [enabledAt, lastRun] = await Promise.all([
          env.TIBO_STATE.get(cloudflareStateKeys.enabledAt),
          env.TIBO_STATE.get(cloudflareStateKeys.lastRun)
        ]);
        return json({
          ok: true,
          configured: Boolean(env.SERVERCHAN_SENDKEY && env.ADMIN_TOKEN && enabledAt),
          enabledAt,
          lastRun: lastRun ? JSON.parse(lastRun) : null
        });
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
