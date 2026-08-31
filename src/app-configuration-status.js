const HEALTH_URL = 'https://tibo-radar.sdcz900828.workers.dev/health';

export async function inspectCloudAppConfiguration({ fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(HEALTH_URL, {
      headers: { accept: 'application/json', 'user-agent': 'tibo-radar/1.0' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error('Cloudflare health check failed');
    const payload = await response.json();
    if (payload?.ok !== true) throw new Error('Cloudflare health response is invalid');
    const enableWatermarkExists = typeof payload.enabledAt === 'string';
    return {
      workerReachable: true,
      configured: payload.configured === true,
      enableWatermarkExists,
      enableWatermarkValid: enableWatermarkExists && Number.isFinite(Date.parse(payload.enabledAt))
    };
  } catch {
    throw new Error('Unable to read Cloudflare App configuration');
  }
}

export function summarizeAppConfiguration(localResult, cloudResult) {
  const local = localResult.ok ? (localResult.value ? '已配置' : '未配置') : '未知';
  let cloud = '未知';
  if (cloudResult.ok) {
    const missing = [];
    if (!cloudResult.value.workerReachable || !cloudResult.value.configured) missing.push('Worker 未配置');
    if (!cloudResult.value.enableWatermarkExists) missing.push('缺少启用水位');
    else if (!cloudResult.value.enableWatermarkValid) missing.push('启用水位无效');
    cloud = missing.length ? `未完成（${missing.join('、')}）` : '已配置';
  }
  const overall = localResult.ok && cloudResult.ok
    ? (local === '已配置' && cloud === '已配置' ? '已配置' : '未完成')
    : '未知';
  return { overall, local, cloud };
}
