import assert from 'node:assert/strict';
import test from 'node:test';
import { readLocalServerChanKey } from '../src/local-serverchan.js';

test('reads the DPAPI key with a fixed executable and argument array in a hidden window', async () => {
  const fakeKey = 'sctp123456tFAKE_secret';
  const calls = [];
  const result = await readLocalServerChanKey({
    secretPath: 'C:\\fixed\\serverchan-sendkey.dpapi',
    execute: async (...args) => { calls.push(args); return { stdout: `${fakeKey}\n` }; }
  });
  assert.equal(result, fakeKey);
  assert.equal(calls[0][0], 'powershell.exe');
  assert.ok(Array.isArray(calls[0][1]));
  assert.equal(calls[0][1].includes('-Command'), false);
  assert.equal(calls[0][2].windowsHide, true);
});

test('redacts a key if the secret reader reports it in an error', async () => {
  const fakeKey = 'sctp123456tFAKE_secret';
  await assert.rejects(readLocalServerChanKey({
    execute: async () => { throw new Error(`failed ${fakeKey}`); }
  }), (error) => !error.message.includes(fakeKey));
});
