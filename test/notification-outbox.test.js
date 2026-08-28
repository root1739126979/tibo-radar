import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enqueueNotification, processOneNotification, readNotificationOutbox } from '../src/notification-outbox.js';

test('outbox sends at most one pending event and does not duplicate event keys', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-outbox-'));
  const outboxPath = path.join(directory, 'outbox.json');
  const sent = [];
  try {
    await enqueueNotification(outboxPath, { eventKey: 'reset:1', title: 'one', body: '1' });
    await enqueueNotification(outboxPath, { eventKey: 'reset:1', title: 'duplicate', body: '2' });
    await enqueueNotification(outboxPath, { eventKey: 'reset:2', title: 'two', body: '2' });
    await processOneNotification(outboxPath, async (item) => sent.push(item.eventKey));
    assert.deepEqual(sent, ['reset:1']);
    const outbox = await readNotificationOutbox(outboxPath);
    assert.deepEqual(outbox.items.map(({ eventKey, status }) => [eventKey, status]), [
      ['reset:1', 'sent'], ['reset:2', 'pending']
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('outbox preserves failed notifications with a redacted error for retry', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-outbox-'));
  const outboxPath = path.join(directory, 'outbox.json');
  const fakeKey = 'sctp123456tFAKE_secret';
  try {
    await enqueueNotification(outboxPath, { eventKey: 'reset:1', title: 'one', body: '1' });
    await assert.rejects(processOneNotification(outboxPath, async () => {
      throw new Error(`bad ${fakeKey}`);
    }), /notification delivery failed/i);
    let outbox = await readNotificationOutbox(outboxPath);
    assert.equal(outbox.items[0].status, 'pending');
    assert.equal(outbox.items[0].attempts, 1);
    assert.equal(outbox.items[0].lastError.includes(fakeKey), false);

    await processOneNotification(outboxPath, async () => {});
    outbox = await readNotificationOutbox(outboxPath);
    assert.equal(outbox.items[0].status, 'sent');
    assert.equal(outbox.items[0].attempts, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
