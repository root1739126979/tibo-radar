import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { withFileLock } from '../src/storage.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const guardScriptPath = path.resolve(testDirectory, '..', 'scripts', 'hold-file-lock-guard.ps1');

async function startGuard(mutexName) {
  const child = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', guardScriptPath, '-MutexName', mutexName,
    '-OwnerProcessId', String(process.pid)
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const line = await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      lines.off('line', onLine);
      child.off('exit', onExit);
    };
    const onLine = (value) => { cleanup(); resolve(value); };
    const onExit = (code) => { cleanup(); reject(new Error(`guard exited before output: ${code}`)); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('guard output timed out'));
    }, 5_000);
    lines.once('line', onLine);
    child.once('exit', onExit);
  });
  lines.close();
  return { child, line };
}

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

test('an abandoned mutex helper is recoverable instead of becoming a permanent guard', {
  skip: process.platform !== 'win32'
}, async () => {
  const mutexName = `Local\\TiboRadarFileLock-${'a'.repeat(32)}${process.pid.toString(16).padStart(32, '0')}`;
  const first = await startGuard(mutexName);
  let replacement;
  try {
    assert.match(first.line, /^ACQUIRED:[0-9]+$/);
    first.child.kill();
    await once(first.child, 'exit');
    replacement = await startGuard(mutexName);
    assert.match(replacement.line, /^ACQUIRED:[0-9]+$/);
  } finally {
    if (first.child.exitCode === null) first.child.kill();
    if (replacement?.child.exitCode === null) replacement.child.stdin.end('\n');
    if (replacement?.child.exitCode === null) await once(replacement.child, 'exit');
  }
});

test('a stale-looking lock with a live owner PID is not reclaimed if its mutex helper disappeared', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-lock-'));
  const lockPath = path.join(directory, 'sample.lock');
  const old = new Date(Date.now() - 10 * 60 * 1000);
  let entered = false;
  try {
    let ownerIdentity;
    await withFileLock(lockPath, async () => {
      ownerIdentity = JSON.parse(await readFile(lockPath, 'utf8')).ownerIdentity;
    });
    assert.match(ownerIdentity, /^[0-9]+$/);
    await writeFile(lockPath, JSON.stringify({ token: 'live-owner', pid: process.pid, ownerIdentity, createdAt: old.toISOString() }));
    await utimes(lockPath, old, old);
    const result = await withFileLock(lockPath, async () => { entered = true; });
    assert.equal(result.skipped, true);
    assert.equal(entered, false);
    assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).token, 'live-owner');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a reused live PID with a different process identity does not block stale recovery', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-lock-'));
  const lockPath = path.join(directory, 'sample.lock');
  const old = new Date(Date.now() - 10 * 60 * 1000);
  try {
    await writeFile(lockPath, JSON.stringify({ token: 'old-process', pid: process.pid, ownerIdentity: '1', createdAt: old.toISOString() }));
    await utimes(lockPath, old, old);
    assert.equal(await withFileLock(lockPath, async () => 'recovered'), 'recovered');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a stale lock whose owner process is gone is recovered', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-lock-'));
  const lockPath = path.join(directory, 'sample.lock');
  const old = new Date(Date.now() - 10 * 60 * 1000);
  try {
    await writeFile(lockPath, JSON.stringify({
      token: 'dead-owner', pid: 2_147_483_647, ownerIdentity: '1', createdAt: old.toISOString()
    }));
    await utimes(lockPath, old, old);
    assert.equal(await withFileLock(lockPath, async () => 'recovered'), 'recovered');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('identity query failure is conservative but has a bounded hard recovery time', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-lock-'));
  const lockPath = path.join(directory, 'sample.lock');
  const base = new Date('2026-01-01T00:00:00Z');
  const queryOwnerIdentity = async () => { throw new Error('query unavailable'); };
  try {
    await writeFile(lockPath, JSON.stringify({ token: 'unknown-owner', pid: 1234, ownerIdentity: '123', createdAt: base.toISOString() }));
    await utimes(lockPath, base, base);
    const conservative = await withFileLock(lockPath, async () => 'too-early', {
      now: () => new Date('2026-01-01T00:10:00Z'), queryOwnerIdentity
    });
    assert.equal(conservative.skipped, true);
    const recovered = await withFileLock(lockPath, async () => 'hard-recovered', {
      now: () => new Date('2026-01-01T00:31:00Z'), queryOwnerIdentity
    });
    assert.equal(recovered, 'hard-recovered');
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

test('two stale-lock recoverers run at most one callback under a controlled overlap', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-lock-'));
  const lockPath = path.join(directory, 'sample.lock');
  const old = new Date(Date.now() - 10 * 60 * 1000);
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  let entered = 0;
  try {
    await writeFile(lockPath, JSON.stringify({ token: 'crashed-owner', createdAt: old.toISOString() }));
    await utimes(lockPath, old, old);
    const first = withFileLock(lockPath, async () => { entered += 1; await blocker; return 'first'; });
    while (entered === 0) await new Promise((resolve) => setImmediate(resolve));
    const second = await withFileLock(lockPath, async () => { entered += 1; return 'second'; });
    assert.equal(entered, 1);
    assert.equal(second.skipped, true);
    release();
    assert.equal(await first, 'first');
  } finally {
    release?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test('release preserves a successor that replaces the lock after the owner read', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-lock-'));
  const lockPath = path.join(directory, 'sample.lock');
  let interleaved = false;
  try {
    await withFileLock(lockPath, async () => 'done', {
      beforeReleaseRename: async () => {
        interleaved = true;
        await rename(lockPath, `${lockPath}.old-owner`);
        await writeFile(lockPath, JSON.stringify({ token: 'successor-after-read', createdAt: new Date().toISOString() }));
      }
    });
    assert.equal(interleaved, true);
    assert.equal(JSON.parse(await readFile(lockPath, 'utf8')).token, 'successor-after-read');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
