import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { projectDirectory } from '../src/paths.js';

const execFileAsync = promisify(execFile);

test('the real PowerShell reader decrypts a DPAPI fixture in a fresh process', {
  skip: process.platform !== 'win32'
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tibo-secret-reader-'));
  const scriptsDirectory = path.join(directory, 'scripts');
  const dataDirectory = path.join(directory, 'data');
  const readerPath = path.join(scriptsDirectory, 'read-serverchan-secret.ps1');
  const secretPath = path.join(dataDirectory, 'serverchan-sendkey.dpapi');
  const fixtureValue = 'not-a-real-serverchan-key';

  try {
    await mkdir(scriptsDirectory);
    await mkdir(dataDirectory);
    await copyFile(path.join(projectDirectory, 'scripts', 'read-serverchan-secret.ps1'), readerPath);

    const createFixture = [
      "$ErrorActionPreference='Stop'",
      'Add-Type -AssemblyName System.Security',
      '$plain=[Text.Encoding]::UTF8.GetBytes($env:TIBO_TEST_VALUE)',
      "$entropy=[Text.Encoding]::UTF8.GetBytes('tibo-radar-serverchan-v1')",
      '$encrypted=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
      '[IO.File]::WriteAllBytes($env:TIBO_TEST_SECRET_PATH,$encrypted)',
      '[Array]::Clear($plain,0,$plain.Length)'
    ].join('; ');
    await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', createFixture
    ], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
      env: { ...process.env, TIBO_TEST_VALUE: fixtureValue, TIBO_TEST_SECRET_PATH: secretPath }
    });

    const result = await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', readerPath, '-SecretPath', secretPath
    ], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      encoding: 'utf8'
    });
    assert.equal(result.stdout, fixtureValue);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
