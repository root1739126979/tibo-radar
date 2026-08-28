const API_ROOT = 'https://api.github.com';
export const APP_LABELS = { pending: 'tibo-app-pending', sent: 'tibo-app-sent', expired: 'tibo-app-expired' };

function repositoryParts(repository) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository ?? '');
  if (!match) throw new Error('GITHUB_REPOSITORY must have the form owner/repository');
  return { owner: match[1], repository: match[2] };
}

export async function githubRequest(path, { token, method = 'GET', body, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('GITHUB_TOKEN is required to create notifications');
  const response = await fetchImpl(`${API_ROOT}${path}`, {
    method, redirect: 'error',
    headers: {
      accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
      'content-type': 'application/json', 'user-agent': 'tibo-radar/1.0',
      'x-github-api-version': '2022-11-28'
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    const error = new Error(`GitHub API ${method} ${path} returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function appStatus(labels = []) {
  const names = labels.map((label) => typeof label === 'string' ? label : label?.name);
  return Object.entries(APP_LABELS).find(([, label]) => names.includes(label))?.[0] ?? null;
}

function recordFromIssue(issue, signalKey) {
  const labels = (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean);
  return { signalKey, number: issue.number, url: issue.html_url, createdAt: issue.created_at, labels, appStatus: appStatus(labels) };
}

function issueBody(signal) {
  const completed = signal.phase === 'completed';
  const title = completed ? 'Tibo 已经进行了重置' : 'Tibo 即将进行重置';
  const quotedText = signal.text.replaceAll('@', '@\u200b').replaceAll('\n', '\n> ');
  return {
    title,
    body: [
      `<!-- tibo-radar-key:${signal.key} -->`, `## ${title}`, '',
      `- 时间：${signal.at}`, `- 置信度：${Math.round(signal.confidence * 100)}%`,
      `- 判断依据：${signal.rationale}`, `- 数据源：${signal.source}`,
      signal.url ? `- 原始链接：${signal.url}` : null, '', '### Tibo 原文', '', `> ${quotedText}`
    ].filter((line) => line !== null).join('\n')
  };
}

export function createGithubIssueStore({ repository, token, assignee, fetchImpl = fetch }) {
  const { owner, repository: name } = repositoryParts(repository);
  const request = (requestPath, options = {}) => githubRequest(requestPath, { ...options, token, fetchImpl });
  return {
    async ensureLabels() {
      const definitions = [
        ['tibo-radar', '7c3aed', 'Automated Tibo reset signal'],
        [APP_LABELS.pending, 'fbca04', 'App notification awaits delivery'],
        [APP_LABELS.sent, '0e8a16', 'App notification delivered'],
        [APP_LABELS.expired, '6e7781', 'App notification intentionally suppressed']
      ];
      for (const [label, color, description] of definitions) {
        try {
          await request(`/repos/${owner}/${name}/labels/${label}`);
        } catch (error) {
          if (error.status !== 404) throw error;
          await request(`/repos/${owner}/${name}/labels`, { method: 'POST', body: { name: label, color, description } });
        }
      }
    },
    async findOrCreate(signal) {
      const marker = `<!-- tibo-radar-key:${signal.key} -->`;
      const issues = await request(`/repos/${owner}/${name}/issues?state=all&labels=tibo-radar&per_page=100`);
      const existing = issues.find((issue) => typeof issue.body === 'string' && issue.body.includes(marker));
      if (existing) return { ...recordFromIssue(existing, signal.key), created: false };
      const formatted = issueBody(signal);
      const issue = await request(`/repos/${owner}/${name}/issues`, {
        method: 'POST',
        body: {
          title: `[Tibo Radar] ${formatted.title}`, body: formatted.body, labels: ['tibo-radar'],
          assignees: assignee ? [assignee] : [owner]
        }
      });
      return { ...recordFromIssue(issue, signal.key), created: true };
    },
    async setAppStatus(record, status) {
      if (!APP_LABELS[status]) throw new Error(`Unknown App notification status: ${status}`);
      const labels = (record.labels ?? []).filter((label) => !Object.values(APP_LABELS).includes(label));
      labels.push(APP_LABELS[status]);
      const issue = await request(`/repos/${owner}/${name}/issues/${record.number}`, { method: 'PATCH', body: { labels } });
      return recordFromIssue(issue, record.signalKey);
    }
  };
}

export async function ensureNotificationLabel(options) {
  return createGithubIssueStore(options).ensureLabels();
}

export async function createIssueOnce(options) {
  return createGithubIssueStore(options).findOrCreate(options.signal);
}
