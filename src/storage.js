import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

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
const OWNER_IDENTITY_FAILURE_RECOVERY_MS = 30 * 60 * 1000;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const guardScriptPath = path.resolve(moduleDirectory, '..', 'scripts', 'hold-file-lock-guard.ps1');
const processIdentityScriptPath = path.resolve(moduleDirectory, '..', 'scripts', 'read-process-identity.ps1');
const execFileAsync = promisify(execFile);
const inProcessGuards = new Set();
const fallbackProcessIdentity = String(Math.round(Date.now() - process.uptime() * 1_000));

function mutexName(filePath) {
  const identity = path.resolve(filePath).toLowerCase();
  return `Local\\TiboRadarFileLock-${createHash('sha256').update(identity).digest('hex')}`;
}

function acquireWindowsGuard(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', guardScriptPath, '-MutexName', mutexName(filePath),
      '-OwnerProcessId', String(process.pid)
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let settled = false;
    let stderr = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('File-lock guard timed out during acquisition'));
    }, 10_000);
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-1_000); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Unable to start file-lock guard: ${error.message}`));
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 75) resolve(null);
      else reject(new Error(`File-lock guard exited before acquisition (${code}): ${stderr.trim()}`));
    });
    output.on('line', (line) => {
      if (settled) return;
      const acquired = /^ACQUIRED:([0-9]+)$/.exec(line);
      if (!acquired && line !== 'BUSY') return;
      settled = true;
      clearTimeout(timer);
      output.close();
      if (line === 'BUSY') {
        resolve(null);
        return;
      }
      resolve({
        ownerIdentity: acquired[1],
        async release() {
          if (child.exitCode !== null) return;
          await new Promise((releaseResolve) => {
            let released = false;
            const finish = () => {
              if (released) return;
              released = true;
              clearTimeout(releaseTimer);
              child.stdin.off('error', finish);
              releaseResolve();
            };
            const releaseTimer = setTimeout(() => { child.kill(); finish(); }, 5_000);
            child.once('exit', finish);
            child.stdin.once('error', finish);
            child.stdin.end('\n');
            if (child.exitCode !== null) finish();
          });
        }
      });
    });
  });
}

async function acquireFileLockGuard(filePath) {
  if (process.platform === 'win32') return acquireWindowsGuard(filePath);
  const identity = path.resolve(filePath);
  if (inProcessGuards.has(identity)) return null;
  inProcessGuards.add(identity);
  return {
    ownerIdentity: fallbackProcessIdentity,
    release: async () => { inProcessGuards.delete(identity); }
  };
}

async function inspectLock(filePath, nowMs, staleMs) {
  try {
    const details = await stat(filePath);
    let newestKnownTime = details.mtimeMs;
    let metadata = null;
    try {
      metadata = JSON.parse(await readFile(filePath, 'utf8'));
      const createdAt = Date.parse(metadata?.createdAt ?? '');
      if (Number.isFinite(createdAt)) newestKnownTime = Math.max(newestKnownTime, createdAt);
    } catch { }
    const ageMs = nowMs - newestKnownTime;
    return { stale: ageMs > staleMs, ageMs, metadata };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function queryWindowsOwnerIdentity(ownerPid) {
  if (!Number.isSafeInteger(ownerPid) || ownerPid < 1 || ownerPid > 2_147_483_647) return null;
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', processIdentityScriptPath, '-OwnerProcessId', String(ownerPid)
  ], {
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 4_096,
    encoding: 'utf8',
    shell: false
  });
  const identity = stdout.trim();
  if (identity === 'MISSING') return null;
  if (!/^[0-9]+$/.test(identity)) throw new Error('Process identity query returned an invalid response');
  return identity;
}

async function queryFallbackOwnerIdentity(ownerPid) {
  if (!Number.isSafeInteger(ownerPid) || ownerPid < 1) return null;
  if (ownerPid === process.pid) return fallbackProcessIdentity;
  try { process.kill(ownerPid, 0); } catch (error) {
    if (error?.code === 'ESRCH') return null;
    throw error;
  }
  throw new Error('Process identity cannot be verified on this platform');
}

const defaultQueryOwnerIdentity = process.platform === 'win32'
  ? queryWindowsOwnerIdentity
  : queryFallbackOwnerIdentity;

export async function withFileLock(filePath, callback, {
  staleMs = DEFAULT_STALE_LOCK_MS,
  now = () => new Date(),
  beforeReleaseRename,
  queryOwnerIdentity = defaultQueryOwnerIdentity
} = {}) {
  await ensureDirectory(path.dirname(filePath));
  const guard = await acquireFileLockGuard(filePath);
  if (!guard) return { skipped: true, reason: 'another sampler is running' };
  const token = randomUUID();
  let handle = null;
  try {
    try {
      handle = await open(filePath, 'wx', 0o600);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const currentNow = now();
      const nowMs = currentNow instanceof Date ? currentNow.getTime() : Number(currentNow);
      const lock = await inspectLock(filePath, nowMs, staleMs);
      if (lock === null) {
        handle = await open(filePath, 'wx', 0o600);
      } else if (!lock.stale) {
        return { skipped: true, reason: 'another sampler is running' };
      } else {
        const ownerPid = lock.metadata?.pid;
        const ownerIdentity = lock.metadata?.ownerIdentity;
        if (Number.isSafeInteger(ownerPid) && ownerPid > 0 && typeof ownerIdentity === 'string' && ownerIdentity) {
          try {
            const currentIdentity = await queryOwnerIdentity(ownerPid);
            if (currentIdentity === ownerIdentity) {
              return { skipped: true, reason: 'another sampler is running' };
            }
          } catch {
            if (lock.ageMs <= OWNER_IDENTITY_FAILURE_RECOVERY_MS) {
              return { skipped: true, reason: 'lock owner identity could not be verified' };
            }
          }
        }
        const stalePath = `${filePath}.${token}.stale`;
        await rename(filePath, stalePath);
        await rm(stalePath, { force: true });
        handle = await open(filePath, 'wx', 0o600);
      }
    }

    try {
      const acquiredAt = now();
      await handle.writeFile(`${JSON.stringify({
        token,
        pid: process.pid,
        ownerIdentity: guard.ownerIdentity,
        createdAt: new Date(acquiredAt).toISOString()
      })}\n`, 'utf8');
      await handle.sync();
      return await callback();
    } finally {
      if (handle) await handle.close();
      const releasePath = `${filePath}.${token}.release`;
      try {
        const observed = JSON.parse(await readFile(filePath, 'utf8'));
        if (observed?.token === token) {
          if (beforeReleaseRename) await beforeReleaseRename();
          await rename(filePath, releasePath);
          const moved = JSON.parse(await readFile(releasePath, 'utf8'));
          if (moved?.token === token) await rm(releasePath, { force: true });
          else await rename(releasePath, filePath);
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  } finally {
    await guard.release();
  }
}
