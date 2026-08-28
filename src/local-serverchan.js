import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { projectDirectory, serverChanSecretPath } from './paths.js';
import { redactServerChanSecret, sendServerChan } from './serverchan.js';

const execFileAsync = promisify(execFile);

export async function isLocalServerChanConfigured(secretPath = serverChanSecretPath) {
  try {
    await access(secretPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function readLocalServerChanKey({
  secretPath = serverChanSecretPath,
  execute = execFileAsync
} = {}) {
  const script = path.join(projectDirectory, 'scripts', 'read-serverchan-secret.ps1');
  try {
    const { stdout } = await execute('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-SecretPath', secretPath
    ], { windowsHide: true, timeout: 10_000, maxBuffer: 4_096, encoding: 'utf8' });
    return stdout.trim();
  } catch (error) {
    throw new Error(redactServerChanSecret(`Unable to read local App notification key: ${error?.message ?? error}`));
  }
}

export async function sendLocalServerChan({ title, body, secretPath = serverChanSecretPath } = {}) {
  const sendKey = await readLocalServerChanKey({ secretPath });
  return sendServerChan({ sendKey, title, body });
}

async function main() {
  try {
    await sendLocalServerChan({
      title: '[本机测试] Tibo Radar App 通知',
      body: '本机 DPAPI 与 Server酱³ App 通知链路配置成功。'
    });
    console.log('本机 App 通知测试发送成功。');
  } catch (error) {
    console.error(redactServerChanSecret(error?.message ?? error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--smoke-test')) main();
