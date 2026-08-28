import assert from 'node:assert/strict';
import test from 'node:test';
import { parseServerChanKey, redactServerChanSecret, sendServerChan } from '../src/serverchan.js';

const fakeKey = 'sctp123456tFAKE_test-secret';

test('parses only ServerChan App keys and builds the fixed user host', () => {
  assert.deepEqual(parseServerChanKey(fakeKey), {
    key: fakeKey,
    userId: '123456',
    endpoint: `https://123456.push.ft07.com/send/${fakeKey}.send`
  });
  for (const invalid of ['', 'SCT123', 'sctpxtsecret', 'sctp123t', 'sctp123tbad key', 'https://evil.test/']) {
    assert.throws(() => parseServerChanKey(invalid), /Server.*App SendKey/i);
  }
});

test('sends form data with no redirects and sanitizes the title', async () => {
  const calls = [];
  const result = await sendServerChan({
    sendKey: fakeKey,
    title: 'hello\r\nworld'.padEnd(80, '!'),
    body: 'quota=28%&safe=yes',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { pushid: 'p1' } }) };
    }
  });
  assert.equal(result.pushId, 'p1');
  assert.equal(calls[0].url, `https://123456.push.ft07.com/send/${fakeKey}.send`);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.signal.constructor.name, 'AbortSignal');
  const form = new URLSearchParams(calls[0].options.body);
  assert.equal(form.get('title').includes('\n'), false);
  assert.equal(form.get('title').length, 64);
  assert.equal(form.get('desp'), 'quota=28%&safe=yes');
});

test('redacts secrets and full request URLs from transport and business errors', async () => {
  const fullUrl = `https://123456.push.ft07.com/send/${fakeKey}.send`;
  assert.equal(redactServerChanSecret(`failed ${fakeKey} at ${fullUrl}`), 'failed [REDACTED] at [REDACTED_URL]');

  for (const fetchImpl of [
    async () => ({ ok: false, status: 500, text: async () => fakeKey }),
    async () => ({ ok: true, status: 200, json: async () => ({ code: 400, message: `bad ${fakeKey}` }) }),
    async () => { throw new Error(`connect ${fullUrl}`); }
  ]) {
    await assert.rejects(
      sendServerChan({ sendKey: fakeKey, title: 'x', body: 'y', fetchImpl }),
      (error) => !error.message.includes(fakeKey) && !error.message.includes('push.ft07.com/send/')
    );
  }
});
