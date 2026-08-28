import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPOSITORY = 'root1739126979/tibo-radar';
const SECRET_NAME = 'SERVERCHAN_SENDKEY';
const WATERMARK_NAME = 'SERVERCHAN_ENABLED_AT';

function parseList(stdout) {
  const parsed = JSON.parse(String(stdout ?? ''));
  if (!Array.isArray(parsed)) throw new Error('Unexpected GitHub CLI response');
  return parsed;
}

export async function inspectCloudAppConfiguration({
  execute = execFileAsync,
  ghExecutable = process.platform === 'win32' ? 'gh.exe' : 'gh'
} = {}) {
  const options = {
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    encoding: 'utf8',
    shell: false
  };
  try {
    const [secretsResult, variablesResult] = await Promise.all([
      execute(ghExecutable, ['secret', 'list', '--repo', REPOSITORY, '--json', 'name'], options),
      execute(ghExecutable, ['variable', 'list', '--repo', REPOSITORY, '--json', 'name,value'], options)
    ]);
    const secrets = parseList(secretsResult.stdout);
    const variables = parseList(variablesResult.stdout);
    const watermark = variables.find((item) => item?.name === WATERMARK_NAME);
    return {
      secretExists: secrets.some((item) => item?.name === SECRET_NAME),
      enableWatermarkExists: Boolean(watermark),
      enableWatermarkValid: Boolean(watermark) && Number.isFinite(Date.parse(watermark.value ?? ''))
    };
  } catch {
    throw new Error('Unable to read GitHub App configuration');
  }
}

export function summarizeAppConfiguration(localResult, cloudResult) {
  const local = localResult.ok ? (localResult.value ? '已配置' : '未配置') : '未知';
  let cloud = '未知';
  if (cloudResult.ok) {
    const missing = [];
    if (!cloudResult.value.secretExists) missing.push('缺少 Secret');
    if (!cloudResult.value.enableWatermarkExists) missing.push('缺少启用水位');
    else if (!cloudResult.value.enableWatermarkValid) missing.push('启用水位无效');
    cloud = missing.length ? `未完成（${missing.join('、')}）` : '已配置';
  }
  const overall = localResult.ok && cloudResult.ok
    ? (local === '已配置' && cloud === '已配置' ? '已配置' : '未完成')
    : '未知';
  return { overall, local, cloud };
}
