import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { projectDirectory } from '../src/paths.js';

const execFileAsync = promisify(execFile);

test('the App configuration launcher is cmd-safe and does not split UTF-8 text into commands', {
  skip: process.platform !== 'win32'
}, async () => {
  const launcherPath = path.join(projectDirectory, '配置App通知.cmd');
  const launcher = await readFile(launcherPath);
  assert.equal(launcher.every((byte) => byte <= 0x7f), true, 'launcher must remain ASCII for cmd.exe');
  const configScript = await readFile(path.join(projectDirectory, 'scripts', 'configure-serverchan.ps1'));
  assert.deepEqual([...configScript.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'Windows PowerShell requires a UTF-8 BOM');

  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-launcher-'));
  try {
    const scriptsDirectory = path.join(directory, 'scripts');
    const isolatedLauncher = path.join(directory, 'launcher.cmd');
    await mkdir(scriptsDirectory);
    await writeFile(isolatedLauncher, launcher);
    await writeFile(path.join(scriptsDirectory, 'configure-serverchan.ps1'), "Write-Output 'LAUNCHER_OK'\n", 'ascii');
    const result = await execFileAsync('cmd.exe', ['/d', '/c', `echo.|call ${isolatedLauncher}`], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      encoding: 'utf8'
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /LAUNCHER_OK/);
    assert.doesNotMatch(output, /not recognized as an internal or external command/i);
    assert.doesNotMatch(output, /ParserError|Unexpected token|string is missing the terminator/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
