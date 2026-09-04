import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFeed, classifyRunway, mergeSignals } from '../src/tibo/classify.js';

const now = new Date('2026-08-28T00:00:00Z');

test('accepts the upstream active signal without reinterpreting its text', () => {
  const signals = classifyFeed({
    stale: false,
    signal: {
      tweet_id: '2094143054039183573',
      at: '2026-08-30T19:19:46Z',
      url: 'https://x.com/thsottiaux/status/2094143054039183573',
      summary: 'Yes',
      kind: 'signal',
      active: true
    },
    tweets: [{
      id: '2094143054039183573',
      at: '2026-08-30T19:19:46Z',
      url: 'https://x.com/thsottiaux/status/2094143054039183573',
      text: 'Yes',
      kind: 'signal',
      tibo_lane: 'reset_related',
      explicit_reset_claim: false
    }]
  }, { now: new Date('2026-08-30T19:25:00Z') });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].phase, 'upcoming');
  assert.equal(signals[0].key, 'upcoming:2094143054039183573');
  assert.equal(signals[0].rationale, 'Upstream feed marks an active reset signal.');
});

test('accepts the upstream active signal even when the tweet list is unavailable', () => {
  const signals = classifyFeed({
    stale: false,
    signal: {
      tweet_id: 'signal-without-tweets',
      at: '2026-08-30T19:19:46Z',
      summary: 'Yes',
      active: true
    }
  }, { now: new Date('2026-08-30T19:25:00Z') });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].key, 'upcoming:signal-without-tweets');
});

test('does not emit an inactive or stale upstream signal', () => {
  const base = {
    stale: false,
    signal: {
      tweet_id: 'signal-1', at: '2026-08-30T19:19:46Z',
      summary: 'Yes', kind: 'signal', active: false
    },
    tweets: []
  };
  assert.deepEqual(classifyFeed(base, { now: new Date('2026-08-30T19:25:00Z') }), []);
  assert.deepEqual(classifyFeed({
    ...base,
    signal: { ...base.signal, active: true }
  }, { now: new Date('2026-08-31T00:00:00Z'), maxAgeHours: 2 }), []);
});

test('classifies a structured Feed banked-reset announcement without reading its wording', () => {
  const signals = classifyFeed({
    stale: false,
    signal: { active: false },
    tweets: [],
    events: [{
      id: 'banked-1',
      announced_at: '2026-09-03T23:12:09Z',
      effective_at: '2026-09-04T02:12:09Z',
      type: 'credits', group: 'credits', reset_kind: 'banked',
      banked_state: 'announced', confidence: 'medium',
      summary: 'Unrelated wording that contains no reset keyword.',
      url: 'https://x.com/thsottiaux/status/banked-1'
    }]
  }, { now: new Date('2026-09-04T00:52:00Z') });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].key, 'upcoming:banked-1');
  assert.equal(signals[0].resetType, 'banked');
});

test('classifies a semantic tease as an upcoming reset', () => {
  const signals = classifyFeed({ stale: false, tweets: [{
    id: 'hint-1', at: '2026-08-27T06:31:31Z', url: 'https://x.com/thsottiaux/status/hint-1',
    text: "I feel that it’s been 20 years since I’ve pressed the reset button. Intrigued to see if I can find it tomorrow and dust it up",
    tease_classification: { teasing: true }, explicit_reset_claim: false
  }] }, { now });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].phase, 'upcoming');
});

test('classifies an explicit completed reset', () => {
  const signals = classifyFeed({ stale: false, tweets: [{
    id: 'done-1', at: '2026-08-27T16:35:05Z', url: 'https://x.com/thsottiaux/status/done-1',
    text: 'Brand new me and brand new usage for all ChatGPT Work and Codex users.',
    explicit_reset_claim: true
  }] }, { now });
  assert.equal(signals[0].phase, 'completed');
  assert.equal(signals[0].key, 'completed:done-1');
});

test('does not treat a joking reset question as a completed reset', () => {
  const signals = classifyFeed({ stale: false, tweets: [{
    id: 'reply-1', at: '2026-08-27T05:53:43Z', url: 'https://x.com/thsottiaux/status/reply-1',
    text: 'Reseted you mean?', explicit_reset_claim: false
  }] }, { now });
  assert.deepEqual(signals, []);
});

test('does not treat an unrelated product launch as a reset hint', () => {
  const signals = classifyFeed({ stale: false, tweets: [{
    id: 'launch-1', at: '2026-08-27T05:53:43Z', url: 'https://x.com/thsottiaux/status/launch-1',
    text: 'The new feature should land tomorrow.', explicit_reset_claim: false, tibo_lane: 'other'
  }] }, { now });
  assert.deepEqual(signals, []);
});

test('accepts an independently reported completed event and deduplicates by key', () => {
  const runway = classifyRunway({ monitor: { status: 'ok' }, events: [{
    kind: 'reset_completed', announcedAt: '2026-08-27T16:00:00Z',
    effectiveAt: '2026-08-27T16:35:05Z', confidence: 0.95,
    source: { handle: 'thsottiaux', postId: 'done-1', url: 'https://x.com/thsottiaux/status/done-1' },
    text: 'Reset complete', rationale: 'Explicit announcement.'
  }] }, { now });
  const merged = mergeSignals(runway, [{ ...runway[0], confidence: 0.5 }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].confidence, 0.95);
  assert.equal(merged[0].announcedAt, '2026-08-27T16:00:00.000Z');
  assert.equal(merged[0].effectiveAt, '2026-08-27T16:35:05.000Z');
});

test('classifies a structured tweet banked state without matching its wording', () => {
  const signals = classifyFeed({ stale: false, tweets: [{
    id: 'banked-tweet', at: '2026-08-27T23:00:00Z',
    text: 'An intentionally opaque announcement.',
    banked_state: 'arriving', explicit_reset_claim: false
  }] }, { now });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].phase, 'upcoming');
  assert.equal(signals[0].resetType, 'banked');
});

test('classifies a structured Runway schedule as one upcoming banked reset', () => {
  const signals = classifyRunway({ monitor: { status: 'ok' }, events: [{
    kind: 'reset_scheduled', resetType: 'banked',
    announcedAt: '2026-09-03T23:12:09Z', effectiveAt: '2026-09-04T02:12:09Z',
    confidence: 0.93,
    source: {
      handle: 'thsottiaux', postId: '2095651088502591861',
      url: 'https://x.com/thsottiaux/status/2095651088502591861'
    },
    text: 'First banked reset will land in about three hours.',
    rationale: 'Explicit Codex reset-bank credit schedule.'
  }] }, { now: new Date('2026-09-04T00:52:00Z') });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].key, 'upcoming:2095651088502591861');
  assert.equal(signals[0].resetType, 'banked');
  assert.equal(signals[0].announcedAt, '2026-09-03T23:12:09.000Z');
  assert.equal(signals[0].effectiveAt, '2026-09-04T02:12:09.000Z');
});

test('merges the same scheduled post from both upstreams into one signal', () => {
  const id = 'same-post';
  const at = '2026-09-03T23:12:09Z';
  const feed = classifyFeed({ stale: false, tweets: [], events: [{
    id, announced_at: at, type: 'credits', reset_kind: 'banked',
    banked_state: 'announced', confidence: 'medium'
  }] }, { now: new Date('2026-09-04T00:52:00Z') });
  const runway = classifyRunway({ monitor: { status: 'ok' }, events: [{
    kind: 'reset_scheduled', resetType: 'banked', announcedAt: at,
    confidence: 0.93, source: { handle: 'thsottiaux', postId: id }
  }] }, { now: new Date('2026-09-04T00:52:00Z') });

  const merged = mergeSignals(feed, runway);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].key, 'upcoming:same-post');
  assert.equal(merged[0].source, 'codex-runway');
});

test('cross-source merge keeps structured details from the lower-confidence report', () => {
  const id = 'active-and-banked';
  const at = '2026-09-03T23:12:09Z';
  const feed = classifyFeed({ stale: false, signal: {
    active: true, tweet_id: id, at, summary: 'Yes'
  }, tweets: [] }, { now: new Date('2026-09-04T00:52:00Z') });
  const runway = classifyRunway({ monitor: { status: 'ok' }, events: [{
    kind: 'reset_scheduled', resetType: 'banked', announcedAt: at,
    effectiveAt: '2026-09-04T02:12:09Z', confidence: 0.93,
    source: { handle: 'thsottiaux', postId: id }
  }] }, { now: new Date('2026-09-04T00:52:00Z') });

  const merged = mergeSignals(feed, runway);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].confidence, 0.95);
  assert.equal(merged[0].resetType, 'banked');
  assert.equal(merged[0].effectiveAt, '2026-09-04T02:12:09.000Z');
});

test('accepts Runway nextSchedule when the event list has not caught up yet', () => {
  const signals = classifyRunway({
    monitor: { status: 'ok' },
    events: [],
    resetTimeline: { nextSchedule: {
      kind: 'reset_scheduled', resetType: 'global',
      announcedAt: '2026-09-03T23:12:09Z', effectiveAt: '2026-09-04T02:12:09Z',
      confidence: 0.91,
      source: { handle: 'thsottiaux', postId: 'next-only' }
    } }
  }, { now: new Date('2026-09-04T00:52:00Z') });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].key, 'upcoming:next-only');
});

test('ignores operator-only runway events because the requested source is Tibo', () => {
  const signals = classifyRunway({ monitor: { status: 'ok' }, events: [{
    kind: 'reset_completed', announcedAt: '2026-08-27T16:35:05Z',
    source: { origin: 'operator', postId: 'operator-1' }, text: 'Quiet reset'
  }] }, { now });
  assert.deepEqual(signals, []);
});

test('ignores stale feeds and old events', () => {
  assert.deepEqual(classifyFeed({ stale: true, tweets: [] }, { now }), []);
  assert.deepEqual(classifyRunway({ monitor: { status: 'ok' }, events: [{
    kind: 'reset_completed', announcedAt: '2026-01-01T00:00:00Z', source: { postId: 'old' }
  }] }, { now }), []);
});
