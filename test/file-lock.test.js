import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withFileLock } from '../src/storage.js';

test('an active lock is never stolen', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-lock-'));
  const lockPath = path.join(directory, 'sample.lock');
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  let entered = false;
  try {
    const active = withFileLock(lockPath, async () => { entered = true; await blocker; return 'active'; });
    while (!entered) await new Promise((resolve) => setImmediate(resolve));
    const contender = await withFileLock(lockPath, async () => 'stolen', { staleMs: 180_000 });
    assert.deepEqual(contender, { skipped: true, reason: 'another sampler is running' });
    release();
    assert.equal(await active, 'active');
  } finally {
    release?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a lock older than the execution limit plus safety margin is recovered', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-lock-'));
  const lockPath = path.join(directory, 'sample.lock');
  const old = new Date('2026-01-01T00:00:00Z');
  try {
    await writeFile(lockPath, JSON.stringify({ token: 'crashed-owner', createdAt: old.toISOString() }));
    await utimes(lockPath, old, old);
    const result = await withFileLock(lockPath, async () => 'recovered', {
      staleMs: 180_000,
      now: () => new Date('2026-01-01T00:03:01Z')
    });
    assert.equal(result, 'recovered');
    await assert.rejects(readFile(lockPath), (error) => error.code === 'ENOENT');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an old owner cannot remove a successor lock after atomic reclamation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-lock-'));
  const lockPath = path.join(directory, 'sample.lock');
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  let entered = false;
  try {
    const original = withFileLock(lockPath, async () => { entered = true; await blocker; });
    while (!entered) await new Promise((resolve) => setImmediate(resolve));
    await rename(lockPath, `${lockPath}.reclaimed`);
    await writeFile(lockPath, JSON.stringify({ token: 'successor', createdAt: new Date().toISOString() }));
    release();
    await original;
    assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).token, 'successor');
  } finally {
    release?.();
    await rm(directory, { recursive: true, force: true });
  }
});
