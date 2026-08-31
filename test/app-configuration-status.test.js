import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectCloudAppConfiguration, summarizeAppConfiguration } from '../src/app-configuration-status.js';

test('cloud configuration reads only the fixed Cloudflare health endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return Response.json({
      ok: true,
      configured: true,
      cronFresh: true,
      enabledAt: '2026-08-31T04:00:00.000Z'
    });
  };
  const result = await inspectCloudAppConfiguration({ fetchImpl });
  assert.deepEqual(result, {
    workerReachable: true,
    configured: true,
    cronHealthy: true,
    enableWatermarkExists: true,
    enableWatermarkValid: true
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://tibo-radar.sdcz900828.workers.dev/health');
  assert.equal(calls[0].options.redirect, 'error');
});

test('full configuration requires local DPAPI, a healthy cloud cron, and a valid watermark', () => {
  assert.deepEqual(summarizeAppConfiguration(
    { ok: true, value: true },
    { ok: true, value: { workerReachable: true, configured: true, cronHealthy: true, enableWatermarkExists: true, enableWatermarkValid: true } }
  ), { overall: '已配置', local: '已配置', cloud: '已配置' });

  assert.deepEqual(summarizeAppConfiguration(
    { ok: true, value: true },
    { ok: true, value: { workerReachable: true, configured: false, cronHealthy: false, enableWatermarkExists: false, enableWatermarkValid: false } }
  ), { overall: '未完成', local: '已配置', cloud: '未完成（Worker 未配置、缺少启用水位）' });

  assert.deepEqual(summarizeAppConfiguration(
    { ok: true, value: true },
    { ok: true, value: { workerReachable: true, configured: true, cronHealthy: false, enableWatermarkExists: true, enableWatermarkValid: true } }
  ), { overall: '未完成', local: '已配置', cloud: '未完成（定时监控不健康）' });
});

test('an unhealthy response still reports configuration and cron state', async () => {
  const result = await inspectCloudAppConfiguration({
    fetchImpl: async () => Response.json({
      ok: false,
      configured: true,
      cronFresh: false,
      enabledAt: '2026-08-31T04:00:00.000Z'
    }, { status: 503 })
  });

  assert.equal(result.configured, true);
  assert.equal(result.cronHealthy, false);
});

test('a failed cloud health query reports unknown without hiding known local state', () => {
  assert.deepEqual(summarizeAppConfiguration(
    { ok: true, value: true },
    { ok: false, error: 'gh unavailable' }
  ), { overall: '未知', local: '已配置', cloud: '未知' });
});

test('cloud query failures do not include captured response content in the public error', async () => {
  await assert.rejects(inspectCloudAppConfiguration({
    fetchImpl: async () => { throw new Error('response contained sensitive-looking output'); }
  }), /^Error: Unable to read Cloudflare App configuration$/);
});
