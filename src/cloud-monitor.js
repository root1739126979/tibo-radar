import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLiveSignals } from './tibo/live-signals.js';
import { createGithubIssueStore } from './github-issues.js';
import { sendServerChan } from './serverchan.js';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function tiboMessage(signal) {
  return {
    title: 'Tibo 即将进行重置',
    body: [
      `信号时间：${signal.at}`, `置信度：${Math.round(signal.confidence * 100)}%`,
      `判断依据：${signal.rationale}`, '', signal.text,
      signal.url ? `\n原始链接：${signal.url}` : null
    ].filter((line) => line !== null).join('\n')
  };
}

export async function runCloudMonitor({
  dryRun = false, mode = 'monitor', env = process.env, now = () => new Date(),
  readSignals = readLiveSignals, issueStore,
  send = ({ title, body }) => sendServerChan({ sendKey: env.SERVERCHAN_SENDKEY, title, body })
} = {}) {
  if (mode === 'serverchan-smoke-test') {
    await send({ title: '[云端测试] Tibo Radar App 通知', body: '云端 Server酱³ App 通知链路配置成功。' });
    return { smokeTest: true };
  }
  const { signals, warnings } = await readSignals({ maxAgeHours: 48 });
  if (dryRun) return { dryRun: true, signals, warnings };
  const store = issueStore ?? createGithubIssueStore({
    repository: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN, assignee: env.TIBO_RADAR_ASSIGNEE
  });
  await store.ensureLabels();
  const enabledMs = Date.parse(env.SERVERCHAN_ENABLED_AT ?? '');
  const appEnabled = Number.isFinite(enabledMs);
  const hasSendKey = typeof env.SERVERCHAN_SENDKEY === 'string'
    && env.SERVERCHAN_SENDKEY.trim().length > 0;
  const notifications = [];
  for (const signal of signals) {
    let record = await store.findOrCreate(signal);
    const created = record.created;
    if (!appEnabled) {
      notifications.push({ signal: signal.key, created, appStatus: record.appStatus, configured: false });
      continue;
    }
    if (!record.appStatus) {
      const signalMs = Date.parse(signal.at);
      const stale = !Number.isFinite(signalMs) || now().getTime() - signalMs > TWO_HOURS_MS;
      const issueCreatedMs = Date.parse(record.createdAt ?? '');
      const historical = !Number.isFinite(issueCreatedMs) || issueCreatedMs < enabledMs;
      const status = signal.phase === 'completed' || stale || historical ? 'expired' : 'pending';
      record = await store.setAppStatus(record, status);
    }
    if (record.appStatus === 'pending') {
      if (!hasSendKey) {
        notifications.push({ signal: signal.key, created, appStatus: record.appStatus, configured: false });
        continue;
      }
      await send(tiboMessage(signal));
      record = await store.setAppStatus(record, 'sent');
    }
    notifications.push({ signal: signal.key, created, appStatus: record.appStatus, configured: hasSendKey });
  }
  return { signals: signals.length, warnings, notifications };
}

async function main() {
  try {
    const dryRun = process.argv.includes('--dry-run');
    const mode = process.env.TIBO_RADAR_MODE || 'monitor';
    console.log(JSON.stringify(await runCloudMonitor({ dryRun, mode }), null, 2));
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
