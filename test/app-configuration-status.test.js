import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectCloudAppConfiguration, summarizeAppConfiguration } from '../src/app-configuration-status.js';

test('cloud configuration checks only names and validates the enable watermark using fixed gh arguments', async () => {
  const calls = [];
  const execute = async (program, args, options) => {
    calls.push({ program, args, options });
    if (args[0] === 'secret') return { stdout: JSON.stringify([{ name: 'SERVERCHAN_SENDKEY' }]) };
    return { stdout: JSON.stringify([{ name: 'SERVERCHAN_ENABLED_AT', value: '2026-08-28T00:00:00.000Z' }]) };
  };
  const result = await inspectCloudAppConfiguration({ execute, ghExecutable: 'gh-test' });
  assert.deepEqual(result, { secretExists: true, enableWatermarkExists: true, enableWatermarkValid: true });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.program, 'gh-test');
    assert.deepEqual(call.args.slice(1, 4), ['list', '--repo', 'root1739126979/tibo-radar']);
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.options.timeout, 10_000);
    assert.equal(call.options.shell, false);
  }
  assert.deepEqual(calls[0].args, ['secret', 'list', '--repo', 'root1739126979/tibo-radar', '--json', 'name']);
  assert.deepEqual(calls[1].args, ['variable', 'list', '--repo', 'root1739126979/tibo-radar', '--json', 'name,value']);
});

test('full configuration requires local DPAPI, cloud Secret name, and a valid watermark', () => {
  assert.deepEqual(summarizeAppConfiguration(
    { ok: true, value: true },
    { ok: true, value: { secretExists: true, enableWatermarkExists: true, enableWatermarkValid: true } }
  ), { overall: '已配置', local: '已配置', cloud: '已配置' });

  assert.deepEqual(summarizeAppConfiguration(
    { ok: true, value: true },
    { ok: true, value: { secretExists: false, enableWatermarkExists: false, enableWatermarkValid: false } }
  ), { overall: '未完成', local: '已配置', cloud: '未完成（缺少 Secret、缺少启用水位）' });
});

test('a failed gh query reports unknown without hiding known local state', () => {
  assert.deepEqual(summarizeAppConfiguration(
    { ok: true, value: true },
    { ok: false, error: 'gh unavailable' }
  ), { overall: '未知', local: '已配置', cloud: '未知' });
});

test('cloud query failures do not include captured command output in the public error', async () => {
  await assert.rejects(inspectCloudAppConfiguration({
    execute: async () => { throw new Error('gh failed with sensitive-looking output'); },
    ghExecutable: 'gh-test'
  }), /^Error: Unable to read GitHub App configuration$/);
});
