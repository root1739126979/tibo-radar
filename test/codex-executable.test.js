import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveCodexExecutable } from '../src/quota/app-server.js';

test('uses an explicit Codex executable when the scheduler supplies one', () => {
  assert.equal(resolveCodexExecutable({
    env: { CODEX_BIN: 'C:\\tools\\codex.exe' },
    platform: 'win32',
    pathExists: () => false
  }), 'C:\\tools\\codex.exe');
});

test('finds the native npm Codex executable without relying on PATH', () => {
  const appData = 'C:\\Users\\tester\\AppData\\Roaming';
  const expected = path.win32.join(
    appData,
    'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai',
    'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'
  );

  assert.equal(resolveCodexExecutable({
    env: { APPDATA: appData },
    platform: 'win32',
    arch: 'x64',
    pathExists: (candidate) => candidate === expected
  }), expected);
});

test('falls back to PATH lookup when no fixed Windows candidate exists', () => {
  assert.equal(resolveCodexExecutable({
    env: {},
    platform: 'win32',
    arch: 'x64',
    pathExists: () => false
  }), 'codex.exe');
});
