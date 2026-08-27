import { fetchJson } from '../fetch-json.js';
import { classifyFeed, classifyRunway, mergeSignals } from './classify.js';

export const FEED_URL = 'https://codex-reset.com/api/feed';
export const RUNWAY_URL = 'https://www.codexrunway.com/api/status.json';

export async function readLiveSignals(options = {}) {
  const results = await Promise.allSettled([fetchJson(FEED_URL), fetchJson(RUNWAY_URL)]);
  const errors = results.filter((item) => item.status === 'rejected').map((item) => item.reason?.message ?? String(item.reason));
  if (errors.length === results.length) throw new Error(`All Tibo signal sources failed: ${errors.join(' | ')}`);

  const feedSignals = results[0].status === 'fulfilled' ? classifyFeed(results[0].value, options) : [];
  const runwaySignals = results[1].status === 'fulfilled' ? classifyRunway(results[1].value, options) : [];
  return { signals: mergeSignals(feedSignals, runwaySignals), warnings: errors };
}
