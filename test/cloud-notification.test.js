import assert from 'node:assert/strict';
import test from 'node:test';
import { runCloudMonitor } from '../src/cloud-monitor.js';

const enabledAt = '2026-08-28T00:00:00.000Z';
const now = new Date('2026-08-28T01:00:00.000Z');

function signal(overrides = {}) {
  return {
    key: 'upcoming:new', phase: 'upcoming', at: '2026-08-28T00:30:00.000Z',
    confidence: 0.92, rationale: 'semantic tease', text: 'maybe tomorrow',
    source: 'fixture', url: 'https://x.com/thsottiaux/status/1', ...overrides
  };
}

function memoryStore(existing = []) {
  const records = new Map(existing.map((record) => [record.signalKey, { ...record }]));
  const transitions = [];
  return {
    records, transitions,
    async ensureLabels() {},
    async findOrCreate(item) {
      if (records.has(item.key)) return { ...records.get(item.key), created: false };
      const record = { signalKey: item.key, number: records.size + 1, url: 'https://example/issue', labels: [], createdAt: now.toISOString() };
      records.set(item.key, record);
      return { ...record, created: true };
    },
    async setAppStatus(record, status) {
      const updated = { ...records.get(record.signalKey), appStatus: status, labels: [`tibo-app-${status}`] };
      records.set(record.signalKey, updated);
      transitions.push([record.signalKey, status]);
      return updated;
    }
  };
}

test('new fresh upcoming signal moves pending to sent once', async () => {
  const store = memoryStore();
  const sent = [];
  const options = {
    now: () => now,
    env: { SERVERCHAN_ENABLED_AT: enabledAt, SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret' },
    readSignals: async () => ({ signals: [signal()], warnings: [] }),
    issueStore: store,
    send: async (message) => sent.push(message)
  };
  await runCloudMonitor(options);
  await runCloudMonitor(options);
  assert.equal(sent.length, 1);
  assert.deepEqual(store.transitions, [['upcoming:new', 'pending'], ['upcoming:new', 'sent']]);
});

test('completed, stale, and historical signals expire without sending', async () => {
  const historical = signal({ key: 'upcoming:historical' });
  const store = memoryStore([{ signalKey: historical.key, number: 9, labels: [], createdAt: '2026-08-27T23:00:00Z' }]);
  const sent = [];
  await runCloudMonitor({
    now: () => now,
    env: { SERVERCHAN_ENABLED_AT: enabledAt, SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret' },
    readSignals: async () => ({ signals: [
      historical,
      signal({ key: 'completed:1', phase: 'completed' }),
      signal({ key: 'upcoming:old', at: '2026-08-27T20:00:00Z' })
    ], warnings: [] }),
    issueStore: store,
    send: async (message) => sent.push(message)
  });
  assert.deepEqual(sent, []);
  assert.deepEqual([...store.records.values()].map((record) => record.appStatus), ['expired', 'expired', 'expired']);
});

test('failed cloud delivery stays pending and retries on the next poll', async () => {
  const store = memoryStore();
  let calls = 0;
  const options = {
    now: () => now,
    env: { SERVERCHAN_ENABLED_AT: enabledAt, SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret' },
    readSignals: async () => ({ signals: [signal()], warnings: [] }),
    issueStore: store,
    send: async () => { calls += 1; if (calls === 1) throw new Error('temporary'); }
  };
  await assert.rejects(runCloudMonitor(options), /temporary/);
  assert.equal(store.records.get('upcoming:new').appStatus, 'pending');
  await runCloudMonitor(options);
  assert.equal(store.records.get('upcoming:new').appStatus, 'sent');
  assert.equal(calls, 2);
});

test('an unlabeled issue created after enablement resumes as pending after a crash', async () => {
  const item = signal({ key: 'upcoming:after-enable' });
  const store = memoryStore([{ signalKey: item.key, number: 10, labels: [], createdAt: '2026-08-28T00:20:00Z' }]);
  const sent = [];
  await runCloudMonitor({
    now: () => now,
    env: { SERVERCHAN_ENABLED_AT: enabledAt, SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret' },
    readSignals: async () => ({ signals: [item], warnings: [] }), issueStore: store,
    send: async (message) => sent.push(message)
  });
  assert.equal(sent.length, 1);
  assert.equal(store.records.get(item.key).appStatus, 'sent');
});

test('smoke-test mode sends only the cloud test and does not poll or migrate', async () => {
  const sent = [];
  const store = memoryStore();
  await runCloudMonitor({
    mode: 'serverchan-smoke-test',
    env: { SERVERCHAN_SENDKEY: 'sctp123456tFAKE_secret' },
    readSignals: async () => { throw new Error('must not poll'); },
    issueStore: store,
    send: async (message) => sent.push(message)
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /^\[云端测试\]/);
  assert.equal(store.records.size, 0);
});
