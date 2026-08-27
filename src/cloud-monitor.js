import { readLiveSignals } from './tibo/live-signals.js';
import { createIssueOnce, ensureNotificationLabel } from './github-issues.js';

export async function runCloudMonitor({ dryRun = false } = {}) {
  const { signals, warnings } = await readLiveSignals({ maxAgeHours: 48 });
  if (dryRun) return { dryRun: true, signals, warnings };

  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  await ensureNotificationLabel({ repository, token });
  const notifications = [];
  for (const signal of signals) {
    notifications.push({ signal: signal.key, ...(await createIssueOnce({
      repository,
      token,
      signal,
      assignee: process.env.TIBO_RADAR_ASSIGNEE
    })) });
  }
  return { signals: signals.length, warnings, notifications };
}

async function main() {
  try {
    const dryRun = process.argv.includes('--dry-run');
    console.log(JSON.stringify(await runCloudMonitor({ dryRun }), null, 2));
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}

main();
