import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true });
}

export async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value) {
  await ensureDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function appendJsonLine(filePath, value) {
  await ensureDirectory(path.dirname(filePath));
  await appendFile(filePath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function appendError(filePath, message) {
  await ensureDirectory(path.dirname(filePath));
  const safeMessage = String(message)
    .replace(/https:\/\/[0-9]+\.push\.ft07\.com\/send\/sctp[^\s]+?\.send/gi, '[REDACTED_URL]')
    .replace(/sctp[0-9]+t[A-Za-z0-9_-]+/gi, '[REDACTED]')
    .replace(/[\r\n]+/g, ' ').slice(0, 2_000);
  let existing = '';
  try { existing = await readFile(filePath, 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = existing.split(/\r?\n/).filter((line) => {
    if (!line) return false;
    const time = Date.parse(line.slice(0, 24));
    return !Number.isFinite(time) || time >= threshold;
  });
  recent.push(`${new Date().toISOString()} ${safeMessage}`);
  let output = `${recent.join('\n')}\n`;
  if (Buffer.byteLength(output, 'utf8') > 1024 * 1024) {
    output = Buffer.from(output, 'utf8').subarray(-1024 * 1024).toString('utf8').replace(/^[^\n]*\n/, '');
  }
  await writeFile(filePath, output, { encoding: 'utf8', mode: 0o600 });
}

export async function pruneErrorLog(filePath, { now = new Date() } = {}) {
  let existing;
  try { existing = await readFile(filePath, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  const threshold = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  let output = existing.split(/\r?\n/).filter((line) => {
    if (!line) return false;
    const time = Date.parse(line.slice(0, 24));
    return !Number.isFinite(time) || time >= threshold;
  }).join('\n');
  if (output) output += '\n';
  if (Buffer.byteLength(output, 'utf8') > 1024 * 1024) {
    output = Buffer.from(output, 'utf8').subarray(-1024 * 1024).toString('utf8').replace(/^[^\n]*\n/, '');
  }
  await writeFile(filePath, output, { encoding: 'utf8', mode: 0o600 });
}

const DEFAULT_STALE_LOCK_MS = 3 * 60 * 1000;

async function lockIsStale(filePath, nowMs, staleMs) {
  try {
    const details = await stat(filePath);
    let newestKnownTime = details.mtimeMs;
    try {
      const metadata = JSON.parse(await readFile(filePath, 'utf8'));
      const createdAt = Date.parse(metadata?.createdAt ?? '');
      if (Number.isFinite(createdAt)) newestKnownTime = Math.max(newestKnownTime, createdAt);
    } catch { }
    return nowMs - newestKnownTime > staleMs;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function withFileLock(filePath, callback, {
  staleMs = DEFAULT_STALE_LOCK_MS,
  now = () => new Date()
} = {}) {
  await ensureDirectory(path.dirname(filePath));
  const token = randomUUID();
  let handle = null;
  for (let attempt = 0; attempt < 4 && !handle; attempt += 1) {
    try {
      handle = await open(filePath, 'wx', 0o600);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const currentNow = now();
      const nowMs = currentNow instanceof Date ? currentNow.getTime() : Number(currentNow);
      const stale = await lockIsStale(filePath, nowMs, staleMs);
      if (stale === null) continue;
      if (!stale) return { skipped: true, reason: 'another sampler is running' };

      const stalePath = `${filePath}.${token}.stale`;
      try {
        await rename(filePath, stalePath);
        await rm(stalePath, { force: true });
      } catch (reclaimError) {
        if (reclaimError?.code === 'ENOENT') continue;
        if (reclaimError?.code === 'EACCES' || reclaimError?.code === 'EPERM') {
          return { skipped: true, reason: 'another sampler is running' };
        }
        throw reclaimError;
      }
    }
  }
  if (!handle) return { skipped: true, reason: 'lock contention could not be resolved' };

  try {
    const acquiredAt = now();
    await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, createdAt: new Date(acquiredAt).toISOString() })}\n`, 'utf8');
    await handle.sync();
    return await callback();
  } finally {
    await handle.close();
    try {
      const current = JSON.parse(await readFile(filePath, 'utf8'));
      if (current?.token === token) await rm(filePath, { force: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
