const API_ROOT = 'https://api.github.com';

function repositoryParts(repository) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository ?? '');
  if (!match) throw new Error('GITHUB_REPOSITORY must have the form owner/repository');
  return { owner: match[1], repository: match[2] };
}

async function githubRequest(path, { token, method = 'GET', body } = {}) {
  if (!token) throw new Error('GITHUB_TOKEN is required to create notifications');
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    redirect: 'error',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'tibo-radar/1.0',
      'x-github-api-version': '2022-11-28'
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`GitHub API ${method} ${path} returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.status === 204 ? null : response.json();
}

export async function ensureNotificationLabel({ repository, token }) {
  const { owner, repository: name } = repositoryParts(repository);
  try {
    await githubRequest(`/repos/${owner}/${name}/labels/tibo-radar`, { token });
  } catch (error) {
    if (!error.message.includes('returned 404')) throw error;
    await githubRequest(`/repos/${owner}/${name}/labels`, {
      token, method: 'POST', body: { name: 'tibo-radar', color: '7c3aed', description: 'Automated Tibo reset signal' }
    });
  }
}

export async function createIssueOnce({ repository, token, signal, assignee }) {
  const { owner, repository: name } = repositoryParts(repository);
  const marker = `<!-- tibo-radar-key:${signal.key} -->`;
  const issues = await githubRequest(`/repos/${owner}/${name}/issues?state=all&labels=tibo-radar&per_page=100`, { token });
  if (issues.some((issue) => typeof issue.body === 'string' && issue.body.includes(marker))) {
    return { created: false };
  }

  const completed = signal.phase === 'completed';
  const title = completed ? 'Tibo 已经进行了重置' : 'Tibo 即将进行重置';
  const quotedText = signal.text.replaceAll('@', '@\u200b').replaceAll('\n', '\n> ');
  const body = [
    marker,
    `## ${title}`,
    '',
    `- 时间：${signal.at}`,
    `- 置信度：${Math.round(signal.confidence * 100)}%`,
    `- 判断依据：${signal.rationale}`,
    `- 数据源：${signal.source}`,
    signal.url ? `- 原始链接：${signal.url}` : null,
    '',
    '### Tibo 原文',
    '',
    `> ${quotedText}`
  ].filter((line) => line !== null).join('\n');

  const issue = await githubRequest(`/repos/${owner}/${name}/issues`, {
    token,
    method: 'POST',
    body: {
      title: `[Tibo Radar] ${title}`,
      body,
      labels: ['tibo-radar'],
      assignees: assignee ? [assignee] : [owner]
    }
  });
  return { created: true, number: issue.number, url: issue.html_url };
}
