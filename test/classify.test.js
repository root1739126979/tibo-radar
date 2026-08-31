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
    kind: 'reset_completed', announcedAt: '2026-08-27T16:35:05Z', confidence: 0.95,
    source: { handle: 'thsottiaux', postId: 'done-1', url: 'https://x.com/thsottiaux/status/done-1' },
    text: 'Reset complete', rationale: 'Explicit announcement.'
  }] }, { now });
  const merged = mergeSignals(runway, [{ ...runway[0], confidence: 0.5 }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].confidence, 0.95);
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
