import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sampleQuota } from '../src/sample.js';

function payload(usedPercent, resetsAt) {
  return {
    rateLimitsByLimitId: {
      codex: {
        limitId: 'codex',
        planType: 'pro',
        primary: { usedPercent, windowDurationMins: 10_080, resetsAt }
      }
    }
  };
}

test('persists the pre-reset remainder and sends it to the notifier', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-radar-test-'));
  const paths = {
    dataDirectory: directory,
    statePath: path.join(directory, 'state.json'),
    historyPath: path.join(directory, 'history.jsonl'),
    eventsPath: path.join(directory, 'events.jsonl'),
    errorsPath: path.join(directory, 'errors.log'),
    outboxPath: path.join(directory, 'outbox.json'),
    serverChanSecretPath: path.join(directory, 'serverchan.dpapi'),
    lockPath: path.join(directory, 'sample.lock')
  };
  const responses = [payload(72, 1_800_000_000), payload(1, 1_800_604_800)];
  const times = [new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:10:00Z')];
  const notifications = [];

  try {
    await sampleQuota({ paths, readRateLimits: async () => responses.shift(), now: () => times.shift(), notify: async (...args) => notifications.push(args) });
    const second = await sampleQuota({ paths, readRateLimits: async () => responses.shift(), now: () => times.shift(), notify: async (...args) => notifications.push(args) });

    assert.equal(second.event.unusedPercentBeforeReset, 28);
    assert.match(notifications[0][1], /28%/);
    const eventLines = (await readFile(paths.eventsPath, 'utf8')).trim().split('\n').map(JSON.parse);
    const historyLines = (await readFile(paths.historyPath, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(eventLines.length, 1);
    assert.equal(eventLines[0].unusedPercentBeforeReset, 28);
    assert.equal(historyLines.length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('records reset before App delivery, preserves failures, and retries one pending item', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-radar-test-'));
  const paths = {
    dataDirectory: directory, statePath: path.join(directory, 'state.json'),
    historyPath: path.join(directory, 'history.jsonl'), eventsPath: path.join(directory, 'events.jsonl'),
    errorsPath: path.join(directory, 'errors.log'), lockPath: path.join(directory, 'sample.lock'),
    outboxPath: path.join(directory, 'outbox.json'), serverChanSecretPath: path.join(directory, 'serverchan.dpapi')
  };
  const responses = [payload(72, 1_800_000_000), payload(1, 1_800_604_800), payload(2, 1_800_604_800)];
  const times = [new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:10:00Z'), new Date('2026-01-01T00:20:00Z')];
  let deliveries = 0;
  try {
    await sampleQuota({ paths, readRateLimits: async () => responses.shift(), now: () => times.shift(), notify: async () => {}, appConfigured: async () => true, deliverApp: async () => {} });
    await assert.rejects(sampleQuota({
      paths, readRateLimits: async () => responses.shift(), now: () => times.shift(), notify: async () => {},
      appConfigured: async () => true,
      deliverApp: async () => { deliveries += 1; throw new Error('temporary'); }
    }), /remains pending/i);
    const eventLines = (await readFile(paths.eventsPath, 'utf8')).trim().split('\n');
    assert.equal(eventLines.length, 1);

    await sampleQuota({
      paths, readRateLimits: async () => responses.shift(), now: () => times.shift(), notify: async () => {},
      appConfigured: async () => true, deliverApp: async () => { deliveries += 1; }
    });
    const outbox = JSON.parse(await readFile(paths.outboxPath, 'utf8'));
    assert.equal(outbox.items[0].status, 'sent');
    assert.equal(outbox.items[0].attempts, 2);
    assert.equal(deliveries, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('desktop reset notification does not claim an old sample was the instant balance', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-radar-test-'));
  const paths = {
    dataDirectory: directory, statePath: path.join(directory, 'state.json'),
    historyPath: path.join(directory, 'history.jsonl'), eventsPath: path.join(directory, 'events.jsonl'),
    errorsPath: path.join(directory, 'errors.log'), lockPath: path.join(directory, 'sample.lock'),
    outboxPath: path.join(directory, 'outbox.json'), serverChanSecretPath: path.join(directory, 'serverchan.dpapi')
  };
  const responses = [payload(72, 1_800_000_000), payload(1, 1_800_604_800)];
  const times = [new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T03:00:00Z')];
  const notifications = [];
  try {
    await sampleQuota({ paths, readRateLimits: async () => responses.shift(), now: () => times.shift(), notify: async (...args) => notifications.push(args), appConfigured: async () => false });
    await sampleQuota({ paths, readRateLimits: async () => responses.shift(), now: () => times.shift(), notify: async (...args) => notifications.push(args), appConfigured: async () => false });
    assert.match(notifications[0][1], /最近已知剩余 28%/);
    assert.match(notifications[0][1], /无法精确确认重置瞬间余额/);
    assert.doesNotMatch(notifications[0][1], /重置到来时还有/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
