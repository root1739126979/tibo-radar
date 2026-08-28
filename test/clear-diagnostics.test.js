import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { clearDiagnostics } from '../src/clear-diagnostics.js';
import { enqueueNotification, readNotificationOutbox } from '../src/notification-outbox.js';
import { withFileLock } from '../src/storage.js';
import { projectDirectory } from '../src/paths.js';

test('diagnostic cleanup removes sent records but preserves pending records while holding the sampler lock', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-clear-'));
  const paths = { lockPath: path.join(directory, 'sample.lock'), errorsPath: path.join(directory, 'errors.log'), outboxPath: path.join(directory, 'outbox.json') };
  try {
    await writeFile(paths.errorsPath, 'old error\n');
    await enqueueNotification(paths.outboxPath, { eventKey: 'pending', title: 'p', body: 'p' });
    const outbox = await readNotificationOutbox(paths.outboxPath);
    outbox.items.push({ eventKey: 'sent', title: 's', body: 's', status: 'sent', attempts: 1, sentAt: new Date().toISOString() });
    await writeFile(paths.outboxPath, JSON.stringify(outbox));

    const result = await clearDiagnostics({ paths });
    assert.equal(result.skipped, undefined);
    assert.deepEqual((await readNotificationOutbox(paths.outboxPath)).items.map((item) => item.eventKey), ['pending']);
    await assert.rejects(readFile(paths.errorsPath), (error) => error.code === 'ENOENT');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cleanup racing with a sampler skips safely and cannot overwrite a newly queued pending event', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-clear-'));
  const paths = { lockPath: path.join(directory, 'sample.lock'), errorsPath: path.join(directory, 'errors.log'), outboxPath: path.join(directory, 'outbox.json') };
  let release;
  let queued;
  const blocker = new Promise((resolve) => { release = resolve; });
  try {
    const sample = withFileLock(paths.lockPath, async () => {
      await enqueueNotification(paths.outboxPath, { eventKey: 'new-pending', title: 'p', body: 'p' });
      queued = true;
      await blocker;
    });
    while (!queued) await new Promise((resolve) => setImmediate(resolve));
    const cleanup = await clearDiagnostics({ paths });
    assert.equal(cleanup.skipped, true);
    release();
    await sample;
    assert.equal((await readNotificationOutbox(paths.outboxPath)).items[0].eventKey, 'new-pending');
  } finally {
    release?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the PowerShell entry delegates cleanup instead of editing the outbox itself', async () => {
  const source = await readFile(path.join(projectDirectory, 'scripts', 'clear-diagnostics.ps1'), 'utf8');
  assert.match(source, /src\\clear-diagnostics\.js/i);
  assert.doesNotMatch(source, /notification-outbox|ConvertFrom-Json|Move-Item/i);
});
