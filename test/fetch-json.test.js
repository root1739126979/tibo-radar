import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchJson } from '../src/fetch-json.js';

test('public-source fetching uses a fixed allowlist and refuses redirects', async () => {
  const calls = [];
  const payload = await fetchJson('https://codex-reset.com/api/feed', {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ ok: true });
    }
  });
  assert.deepEqual(payload, { ok: true });
  assert.equal(calls[0].options.redirect, 'manual');

  await assert.rejects(fetchJson('https://example.test/private', {
    fetchImpl: async () => { throw new Error('must not fetch'); }
  }), /allowlist/);

  await assert.rejects(fetchJson('https://codex-reset.com/api/feed', {
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/' }
    })
  }), /HTTP 302/);
});
