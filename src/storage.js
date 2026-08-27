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
  const safeMessage = String(message).replace(/[\r\n]+/g, ' ').slice(0, 2_000);
  await appendFile(filePath, `${new Date().toISOString()} ${safeMessage}\n`, { encoding: 'utf8', mode: 0o600 });
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
