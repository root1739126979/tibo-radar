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

function confidenceNumber(value, fallback) {
  if (Number.isFinite(value)) return value;
  return { high: 0.95, medium: 0.85, low: 0.7 }[value] ?? fallback;
}

function makeSignal({ phase, id, at, announcedAt = null, effectiveAt = null, resetType = null, text, url, confidence, rationale, source }) {
  return {
    key: `${phase}:${id}`,
    phase,
    id: String(id),
    at,
    announcedAt: announcedAt ?? at,
    effectiveAt,
    resetType,
    text: String(text ?? '').slice(0, 4_000),
    url: typeof url === 'string' && url.startsWith('https://') ? url : null,
    confidence,
    rationale,
    source
  };
}

export function classifyFeed(feed, { now = new Date(), maxAgeHours = 72 } = {}) {
  if (!feed || typeof feed !== 'object') return [];
  if (feed.stale === true) return [];
  const signals = [];
  const tweets = Array.isArray(feed.tweets) ? feed.tweets : [];

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

  const events = Array.isArray(feed.events) ? feed.events : [];
  for (const event of events.slice(0, 80)) {
    const isUpcomingBankedReset = event?.type === 'credits'
      && event?.reset_kind === 'banked'
      && (event?.banked_state === 'announced' || event?.banked_state === 'arriving');
    if (!isUpcomingBankedReset) continue;
    const id = event.id;
    const at = safeDate(event.announced_at);
    if (!id || !withinAge(at, now, maxAgeHours)) continue;
    signals.push(makeSignal({
      phase: 'upcoming', id, at, effectiveAt: safeDate(event.effective_at),
      resetType: 'banked', text: event.summary, url: event.url,
      confidence: confidenceNumber(event.confidence, 0.85),
      rationale: `Feed marks a banked reset as ${event.banked_state}.`,
      source: 'codex-reset-feed'
    }));
  }

  for (const tweet of tweets.slice(0, 40)) {
    const id = tweet?.id;
    const at = safeDate(tweet?.at ?? tweet?.declared_at);
    const text = String(tweet?.text ?? '');
    if (!id || !withinAge(at, now, maxAgeHours)) continue;

    const laneIsRelevant = tweet.tibo_lane === 'reset_announcement' || tweet.tibo_lane === 'reset_related';
    const textHasResetContext = /\b(?:codex|chatgpt work|usage|quota|rate limits?|reset button|everyone|all paid|brand new usage)\b/i.test(text);
    const explicit = tweet.explicit_reset_claim === true
      || (!/\?\s*$/.test(text) && (laneIsRelevant || textHasResetContext) && COMPLETED_PATTERNS.some((pattern) => pattern.test(text)));
    const bankedUpcoming = tweet.banked_state === 'announced' || tweet.banked_state === 'arriving';
    const teasing = tweet?.tease_classification?.teasing === true
      || ((laneIsRelevant || textHasResetContext) && UPCOMING_PATTERNS.some((pattern) => pattern.test(text)));

    if (explicit) {
      signals.push(makeSignal({
        phase: 'completed', id, at, text, url: tweet.url, confidence: 0.98,
        rationale: tweet.explicit_reset_claim === true ? 'Tibo feed marks an explicit reset claim.' : 'Deterministic completed-reset wording.',
        source: 'codex-reset-feed'
      }));
    } else if (bankedUpcoming || teasing) {
      signals.push(makeSignal({
        phase: 'upcoming', id, at, resetType: bankedUpcoming ? 'banked' : null,
        text, url: tweet.url,
        confidence: bankedUpcoming ? 0.9 : (tweet?.tease_classification?.teasing === true ? 0.92 : 0.8),
        rationale: bankedUpcoming
          ? `Feed marks a tweet's banked reset as ${tweet.banked_state}.`
          : (tweet?.tease_classification?.teasing === true
              ? 'Feed semantic classifier marks this as a reset tease.'
              : 'Deterministic future-reset wording.'),
        source: 'codex-reset-feed'
      }));
    }
  }
  return signals;
}

export function classifyRunway(status, { now = new Date(), maxAgeHours = 72 } = {}) {
  if (!status || status?.monitor?.status !== 'ok') return [];
  const signals = [];
  const events = Array.isArray(status.events) ? status.events.slice(0, 20) : [];
  const nextSchedule = status?.resetTimeline?.nextSchedule;
  if (nextSchedule && typeof nextSchedule === 'object') events.push(nextSchedule);
  for (const event of events) {
    if (event?.kind !== 'reset_scheduled' && event?.kind !== 'reset_completed') continue;
    const isTiboSource = event?.source?.handle === 'thsottiaux'
      || String(event?.source?.url ?? '').startsWith('https://x.com/thsottiaux/');
    if (!isTiboSource) continue;
    const id = event?.source?.postId ?? event?.source?.origin;
    const phase = event.kind === 'reset_scheduled' ? 'upcoming' : 'completed';
    const announcedAt = safeDate(event?.announcedAt);
    const effectiveAt = safeDate(event?.effectiveAt);
    const at = phase === 'upcoming' ? announcedAt : (effectiveAt ?? announcedAt);
    if (!id || !withinAge(at, now, maxAgeHours)) continue;
    signals.push(makeSignal({
      phase, id, at, announcedAt, effectiveAt, resetType: event.resetType ?? null,
      text: event.text, url: event?.source?.url,
      confidence: Number.isFinite(event.confidence) ? event.confidence : 0.9,
      rationale: String(event.rationale ?? (phase === 'upcoming'
        ? 'Independent reset schedule.'
        : 'Independent reset-completed event.')),
      source: 'codex-runway'
    }));
  }
  return mergeSignals(signals);
}

export function mergeSignals(...collections) {
  const merged = new Map();
  for (const signal of collections.flat()) {
    const existing = merged.get(signal.key);
    if (!existing) {
      merged.set(signal.key, signal);
      continue;
    }
    const preferred = signal.confidence > existing.confidence ? signal : existing;
    const supplement = preferred === signal ? existing : signal;
    merged.set(signal.key, {
      ...supplement,
      ...preferred,
      resetType: preferred.resetType ?? supplement.resetType ?? null,
      announcedAt: preferred.announcedAt ?? supplement.announcedAt ?? preferred.at,
      effectiveAt: preferred.effectiveAt ?? supplement.effectiveAt ?? null,
      url: preferred.url ?? supplement.url ?? null,
      text: preferred.text || supplement.text || ''
    });
  }
  return [...merged.values()].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}
