import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { projectDirectory } from './paths.js';

const execFileAsync = promisify(execFile);

export async function notifyWindows(title, message) {
  if (process.platform !== 'win32' || process.env.TIBO_RADAR_NO_NOTIFY === '1') return false;
  const script = path.join(projectDirectory, 'scripts', 'notify-windows.ps1');
  await execFileAsync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-Title', String(title).slice(0, 80), '-Message', String(message).slice(0, 240)
  ], { windowsHide: true, timeout: 15_000 });
  return true;
}
