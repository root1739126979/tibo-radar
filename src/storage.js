import { appendFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

export async function withFileLock(filePath, callback) {
  await ensureDirectory(path.dirname(filePath));
  let handle;
  try {
    handle = await open(filePath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') return { skipped: true, reason: 'another sampler is running' };
    throw error;
  }

  try {
    return await callback();
  } finally {
    await handle.close();
    await rm(filePath, { force: true });
  }
}
