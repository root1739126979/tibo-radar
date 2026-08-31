import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudflareWorker } from '../src/cloudflare-worker.js';

class MemoryKv {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }
  async get(key) { return this.values.get(key) ?? null; }
  async put(key, value) { this.values.set(key, String(value)); }
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
