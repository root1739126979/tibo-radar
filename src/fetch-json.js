const ALLOWED_URLS = new Set([
  'https://codex-reset.com/api/feed',
  'https://www.codexrunway.com/api/status.json'
]);

export async function fetchJson(url, {
  timeoutMs = 12_000,
  maxBytes = 2_000_000,
  fetchImpl = fetch
} = {}) {
  if (!ALLOWED_URLS.has(url)) throw new Error(`URL is not on the Tibo Radar allowlist: ${url}`);
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json', 'user-agent': 'tibo-radar/1.0' },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error(`${url} response is too large`);
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error(`${url} response exceeded ${maxBytes} bytes`);
  return JSON.parse(text);
}
