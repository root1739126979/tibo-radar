import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const INITIALIZE_ID = 1;
const RATE_LIMITS_ID = 2;

export function resolveCodexExecutable({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  pathExists = existsSync
} = {}) {
  if (env.CODEX_BIN) return env.CODEX_BIN;
  if (platform !== 'win32') return 'codex';

  const packageVariants = [
    { arch: 'x64', packageName: 'codex-win32-x64', target: 'x86_64-pc-windows-msvc' },
    { arch: 'arm64', packageName: 'codex-win32-arm64', target: 'aarch64-pc-windows-msvc' }
  ].sort((left, right) => Number(right.arch === arch) - Number(left.arch === arch));
  const npmRoots = [
    env.APPDATA ? path.win32.join(env.APPDATA, 'npm', 'node_modules') : null,
    env.NPM_CONFIG_PREFIX ? path.win32.join(env.NPM_CONFIG_PREFIX, 'node_modules') : null
  ].filter(Boolean);

  for (const npmRoot of npmRoots) {
    for (const variant of packageVariants) {
      const candidate = path.win32.join(
        npmRoot,
        '@openai', 'codex', 'node_modules', '@openai', variant.packageName,
        'vendor', variant.target, 'bin', 'codex.exe'
      );
      if (pathExists(candidate)) return candidate;
    }
  }
  return 'codex.exe';
}

export function readAccountRateLimits({ timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCodexExecutable(), ['app-server', '--stdio'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    const output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let stderr = '';
    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      output.close();
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolve(result);
    };

    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const timer = setTimeout(() => {
      finish(new Error(`Codex App Server timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.on('error', (error) => finish(new Error(`Unable to start Codex App Server: ${error.message}`)));
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`Codex App Server exited with code ${code}: ${stderr.trim()}`));
    });

    output.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.id === INITIALIZE_ID) {
        if (message.error) return finish(new Error(`Codex initialize failed: ${message.error.message}`));
        send({ method: 'initialized' });
        send({ method: 'account/rateLimits/read', id: RATE_LIMITS_ID });
        return;
      }

      if (message.id === RATE_LIMITS_ID) {
        if (message.error) return finish(new Error(`Codex rate-limit read failed: ${message.error.message}`));
        finish(null, message.result);
      }
    });

    send({
      method: 'initialize',
      id: INITIALIZE_ID,
      params: {
        clientInfo: { name: 'tibo-radar', title: 'Tibo Radar', version: '1.0.0' },
        capabilities: { experimentalApi: true }
      }
    });
  });
}
