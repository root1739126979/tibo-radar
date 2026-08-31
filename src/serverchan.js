const KEY_PATTERN = /^sctp([1-9][0-9]{0,19})t([A-Za-z0-9_-]{6,256})$/;
const REQUEST_URL_PATTERN = /https:\/\/[0-9]+\.push\.ft07\.com\/send\/sctp[^\s]+?\.send/gi;
const KEY_REDACTION_PATTERN = /sctp[0-9]+t[A-Za-z0-9_-]+/gi;

export function parseServerChanKey(value) {
  const key = String(value ?? '').trim();
  const match = KEY_PATTERN.exec(key);
  if (!match) throw new Error('A valid ServerChan App SendKey is required (sctp... format)');
  const userId = match[1];
  return {
    key,
    userId,
    endpoint: `https://${userId}.push.ft07.com/send/${key}.send`
  };
}

export function redactServerChanSecret(value) {
  return String(value ?? '')
    .replace(REQUEST_URL_PATTERN, '[REDACTED_URL]')
    .replace(KEY_REDACTION_PATTERN, '[REDACTED]');
}

function cleanTitle(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 64);
}

export async function sendServerChan({ sendKey, title, body, fetchImpl = fetch, timeoutMs = 15_000 }) {
  const { endpoint } = parseServerChanKey(sendKey);
  const form = new URLSearchParams({ title: cleanTitle(title), desp: String(body ?? '') });
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'user-agent': 'tibo-radar/1.0'
      },
      body: form.toString(),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`ServerChan returned HTTP ${response.status}`);
    const payload = await response.json();
    if (Number(payload?.code) !== 0) {
      throw new Error(`ServerChan rejected the notification: ${String(payload?.message ?? payload?.msg ?? 'unknown response')}`);
    }
    return { delivered: true, pushId: payload?.data?.pushid ?? payload?.data?.pushId ?? null };
  } catch (error) {
    throw new Error(redactServerChanSecret(error?.message ?? error));
  }
}
