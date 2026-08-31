const UPCOMING_PATTERNS = [
  /\b(?:will|going to|gonna)\s+(?:fully\s+)?reset\b/i,
  /\breset\s+(?:is\s+)?incoming\b/i,
  /\breset(?:ting)?\s+(?:them\s+)?(?:later|tomorrow|soon|in a bit)\b/i,
  /\b(?:later|tomorrow|soon|in a bit).{0,60}\breset\b/i,
  /\bfind\s+(?:the\s+)?reset\s+button\s+tomorrow\b/i
];

const COMPLETED_PATTERNS = [
  /\b(?:i|we)(?:'ve| have)?\s+reset\b/i,
  /\b(?:has|have|were|was|is|are)\s+(?:now\s+|been\s+)?reset\b/i,
  /\breset\s+(?:button\s+)?pressed\b/i,
  /\bbrand new usage\b/i,
  /\bback to 100%\b/i
];

function safeDate(value) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function withinAge(isoDate, now, maxAgeHours) {
  if (!isoDate) return false;
  const age = now.getTime() - Date.parse(isoDate);
  return age >= -5 * 60_000 && age <= maxAgeHours * 3_600_000;
}

function makeSignal({ phase, id, at, text, url, confidence, rationale, source }) {
  return {
    key: `${phase}:${id}`,
    phase,
    id: String(id),
    at,
    text: String(text ?? '').slice(0, 4_000),
    url: typeof url === 'string' && url.startsWith('https://') ? url : null,
    confidence,
    rationale,
    source
  };
}

export function classifyFeed(feed, { now = new Date(), maxAgeHours = 72 } = {}) {
  if (!feed || !Array.isArray(feed.tweets)) return [];
  if (feed.stale === true) return [];
  const signals = [];

  const upstreamSignal = feed.signal;
  const upstreamSignalId = upstreamSignal?.active === true ? upstreamSignal?.tweet_id : null;
  const upstreamSignalAt = safeDate(upstreamSignal?.at);
  if (upstreamSignalId && withinAge(upstreamSignalAt, now, maxAgeHours)) {
    signals.push(makeSignal({
      phase: 'upcoming', id: upstreamSignalId, at: upstreamSignalAt,
      text: upstreamSignal.summary, url: upstreamSignal.url, confidence: 0.95,
      rationale: 'Upstream feed marks an active reset signal.',
      source: 'codex-reset-feed'
    }));
  }

  for (const tweet of feed.tweets.slice(0, 40)) {
    const id = tweet?.id;
    const at = safeDate(tweet?.at ?? tweet?.declared_at);
    const text = String(tweet?.text ?? '');
    if (!id || !withinAge(at, now, maxAgeHours)) continue;

    const laneIsRelevant = tweet.tibo_lane === 'reset_announcement' || tweet.tibo_lane === 'reset_related';
    const textHasResetContext = /\b(?:codex|chatgpt work|usage|quota|rate limits?|reset button|everyone|all paid|brand new usage)\b/i.test(text);
    const explicit = tweet.explicit_reset_claim === true
      || (!/\?\s*$/.test(text) && (laneIsRelevant || textHasResetContext) && COMPLETED_PATTERNS.some((pattern) => pattern.test(text)));
    const teasing = tweet?.tease_classification?.teasing === true
      || ((laneIsRelevant || textHasResetContext) && UPCOMING_PATTERNS.some((pattern) => pattern.test(text)));

    if (explicit) {
      signals.push(makeSignal({
        phase: 'completed', id, at, text, url: tweet.url, confidence: 0.98,
        rationale: tweet.explicit_reset_claim === true ? 'Tibo feed marks an explicit reset claim.' : 'Deterministic completed-reset wording.',
        source: 'codex-reset-feed'
      }));
    } else if (teasing) {
      signals.push(makeSignal({
        phase: 'upcoming', id, at, text, url: tweet.url, confidence: tweet?.tease_classification?.teasing === true ? 0.92 : 0.8,
        rationale: tweet?.tease_classification?.teasing === true ? 'Feed semantic classifier marks this as a reset tease.' : 'Deterministic future-reset wording.',
        source: 'codex-reset-feed'
      }));
    }
  }
  return signals;
}

export function classifyRunway(status, { now = new Date(), maxAgeHours = 72 } = {}) {
  if (!status || !Array.isArray(status.events) || status?.monitor?.status !== 'ok') return [];
  const signals = [];
  for (const event of status.events.slice(0, 20)) {
    if (event?.kind !== 'reset_completed') continue;
    const isTiboSource = event?.source?.handle === 'thsottiaux'
      || String(event?.source?.url ?? '').startsWith('https://x.com/thsottiaux/');
    if (!isTiboSource) continue;
    const id = event?.source?.postId ?? event?.source?.origin;
    const at = safeDate(event?.effectiveAt ?? event?.announcedAt);
    if (!id || !withinAge(at, now, maxAgeHours)) continue;
    signals.push(makeSignal({
      phase: 'completed', id, at, text: event.text, url: event?.source?.url,
      confidence: Number.isFinite(event.confidence) ? event.confidence : 0.9,
      rationale: String(event.rationale ?? 'Independent reset-completed event.'),
      source: 'codex-runway'
    }));
  }
  return signals;
}

export function mergeSignals(...collections) {
  const merged = new Map();
  for (const signal of collections.flat()) {
    const existing = merged.get(signal.key);
    if (!existing || signal.confidence > existing.confidence) merged.set(signal.key, signal);
  }
  return [...merged.values()].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}
