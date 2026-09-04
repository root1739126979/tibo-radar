import assert from 'node:assert/strict';
import test from 'node:test';
import { runCloudflareMonitor } from '../src/cloudflare-monitor.js';

class MemoryKv {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }
}

function upcoming(overrides = {}) {
  return {
    key: 'upcoming:signal-1', phase: 'upcoming', id: 'signal-1',
    at: '2026-08-31T02:55:00.000Z', confidence: 0.95,
    rationale: 'Upstream feed marks an active reset signal.', text: 'Yes',
    source: 'codex-reset-feed', url: 'https://x.com/thsottiaux/status/signal-1',
    ...overrides
  };
}

test('a fresh upstream signal is delivered once and deduplicated in KV', async () => {
  const kv = new MemoryKv({ 'monitor:enabled-at': '2026-08-31T02:00:00.000Z' });
  const sent = [];
  const options = {
    env: { TIBO_STATE: kv, SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret' },
    now: () => new Date('2026-08-31T03:00:00.000Z'),
    readSignals: async () => ({ signals: [upcoming()], warnings: [] }),
    send: async (message) => sent.push(message)
  };

  await runCloudflareMonitor(options);
  await runCloudflareMonitor(options);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Tibo 即将进行重置');
  assert.match(await kv.get('signal:upcoming:signal-1'), /"status":"sent"/);
});

test('a banked reset uses a distinct title and still sends only once', async () => {
  const kv = new MemoryKv({ 'monitor:enabled-at': '2026-08-31T02:00:00.000Z' });
  const sent = [];
  const options = {
    env: { TIBO_STATE: kv, SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret' },
    now: () => new Date('2026-08-31T03:00:00.000Z'),
    readSignals: async () => ({ signals: [upcoming({ resetType: 'banked' })], warnings: [] }),
    send: async (message) => sent.push(message)
  };

  await runCloudflareMonitor(options);
  await runCloudflareMonitor(options);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Tibo 即将发放 Banked Reset');
});

test('a scheduled reset remains actionable while its effective time is still ahead', async () => {
  const kv = new MemoryKv({ 'monitor:enabled-at': '2026-08-31T00:00:00.000Z' });
  const sent = [];
  await runCloudflareMonitor({
    env: { TIBO_STATE: kv, SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret' },
    now: () => new Date('2026-08-31T04:00:00.000Z'),
    readSignals: async () => ({ signals: [upcoming({
      at: '2026-08-31T01:00:00.000Z',
      effectiveAt: '2026-08-31T05:00:00.000Z',
      resetType: 'banked'
    })], warnings: [] }),
    send: async (message) => sent.push(message)
  });

  assert.equal(sent.length, 1);
});

test('an old schedule is not replayed after its effective time', async () => {
  const kv = new MemoryKv({ 'monitor:enabled-at': '2026-08-31T00:00:00.000Z' });
  const sent = [];
  await runCloudflareMonitor({
    env: { TIBO_STATE: kv, SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret' },
    now: () => new Date('2026-08-31T06:00:00.000Z'),
    readSignals: async () => ({ signals: [upcoming({
      at: '2026-08-31T01:00:00.000Z',
      effectiveAt: '2026-08-31T05:00:00.000Z'
    })], warnings: [] }),
    send: async (message) => sent.push(message)
  });

  assert.deepEqual(sent, []);
});

test('a scheduled run stays disabled until the authenticated smoke test enables it', async () => {
  const kv = new MemoryKv();
  const sent = [];
  let reads = 0;
  const result = await runCloudflareMonitor({
    env: { TIBO_STATE: kv, SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret' },
    now: () => new Date('2026-08-31T03:00:00.000Z'),
    readSignals: async () => {
      reads += 1;
      return { signals: [upcoming()], warnings: [] };
    },
    send: async (message) => sent.push(message)
  });

  assert.equal(result.enabled, false);
  assert.equal(reads, 0);
  assert.deepEqual(sent, []);
  assert.equal(await kv.get('monitor:enabled-at'), null);
});

test('a failed delivery is not marked sent and retries on the next cron run', async () => {
  const kv = new MemoryKv({ 'monitor:enabled-at': '2026-08-31T02:00:00.000Z' });
  let attempts = 0;
  const options = {
    env: { TIBO_STATE: kv, SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret' },
    now: () => new Date('2026-08-31T03:00:00.000Z'),
    readSignals: async () => ({ signals: [upcoming()], warnings: [] }),
    send: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary');
    }
  };

  await assert.rejects(runCloudflareMonitor(options), /temporary/);
  assert.equal(await kv.get('signal:upcoming:signal-1'), null);
  await runCloudflareMonitor(options);
  assert.equal(attempts, 2);
  assert.match(await kv.get('signal:upcoming:signal-1'), /"status":"sent"/);
});
