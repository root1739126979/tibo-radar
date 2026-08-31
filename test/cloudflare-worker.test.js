import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudflareWorker } from '../src/cloudflare-worker.js';

class MemoryKv {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }
  async get(key) { return this.values.get(key) ?? null; }
  async put(key, value) { this.values.set(key, String(value)); }
  async delete(key) { this.values.delete(key); }
}

test('the protected cloud smoke endpoint sends once and enables monitoring', async () => {
  const kv = new MemoryKv();
  const sent = [];
  const worker = createCloudflareWorker({
    sendSmoke: async (message) => sent.push(message),
    now: () => new Date('2026-08-31T04:00:00.000Z')
  });
  const env = {
    TIBO_STATE: kv,
    SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret',
    ADMIN_TOKEN: 'a-secure-random-test-token'
  };

  const unauthorized = await worker.fetch(new Request('https://example.test/__smoke', { method: 'POST' }), env);
  assert.equal(unauthorized.status, 401);
  const response = await worker.fetch(new Request('https://example.test/__smoke', {
    method: 'POST', headers: { authorization: 'Bearer a-secure-random-test-token' }
  }), env);

  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /^\[云端测试\]/);
  assert.equal(await kv.get('monitor:enabled-at'), '2026-08-31T04:00:00.000Z');
});

test('health is unhealthy when cron has never run or its last run is stale', async () => {
  const worker = createCloudflareWorker({
    now: () => new Date('2026-08-31T04:30:00.000Z')
  });
  const baseEnv = {
    SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret',
    ADMIN_TOKEN: 'a-secure-random-test-token'
  };

  const neverRun = await worker.fetch(new Request('https://example.test/health'), {
    ...baseEnv,
    TIBO_STATE: new MemoryKv({ 'monitor:enabled-at': '2026-08-31T04:00:00.000Z' })
  });
  assert.equal(neverRun.status, 503);
  assert.equal((await neverRun.json()).ok, false);

  const stale = await worker.fetch(new Request('https://example.test/health'), {
    ...baseEnv,
    TIBO_STATE: new MemoryKv({
      'monitor:enabled-at': '2026-08-31T04:00:00.000Z',
      'monitor:last-run': JSON.stringify({ checkedAt: '2026-08-31T04:10:00.000Z' })
    })
  });
  assert.equal(stale.status, 503);
  assert.equal((await stale.json()).cronFresh, false);
});

test('health is healthy only after a recent successful cron run', async () => {
  const worker = createCloudflareWorker({
    now: () => new Date('2026-08-31T04:30:00.000Z')
  });
  const response = await worker.fetch(new Request('https://example.test/health'), {
    SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret',
    ADMIN_TOKEN: 'a-secure-random-test-token',
    TIBO_STATE: new MemoryKv({
      'monitor:enabled-at': '2026-08-31T04:00:00.000Z',
      'monitor:last-run': JSON.stringify({ checkedAt: '2026-08-31T04:25:00.000Z' })
    })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    configured: true,
    cronFresh: true,
    enabledAt: '2026-08-31T04:00:00.000Z',
    lastRun: { checkedAt: '2026-08-31T04:25:00.000Z' },
    lastFailure: null
  });
});

test('scheduled failures are recorded without exposing ServerChan secrets', async () => {
  const kv = new MemoryKv();
  const worker = createCloudflareWorker({
    monitor: async () => {
      throw new Error('send failed for sctp1234567890tFAKESECRET');
    },
    now: () => new Date('2026-08-31T04:30:00.000Z')
  });

  await assert.rejects(worker.scheduled({}, { TIBO_STATE: kv }), /send failed/);
  const failure = JSON.parse(await kv.get('monitor:last-failure'));
  assert.equal(failure.checkedAt, '2026-08-31T04:30:00.000Z');
  assert.doesNotMatch(failure.message, /sctp1234567890tFAKESECRET/);
  assert.match(failure.message, /\[REDACTED\]/);
});
