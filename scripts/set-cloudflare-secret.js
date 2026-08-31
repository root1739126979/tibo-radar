import { spawn } from 'node:child_process';

const allowedNames = new Set(['SERVERCHAN_SENDKEY', 'ADMIN_TOKEN']);
const name = process.argv[2];
if (!allowedNames.has(name)) throw new Error('Cloudflare secret name is not allowed');

let value = '';
for await (const chunk of process.stdin) value += chunk;
value = value.trim();
if (!value) throw new Error('Cloudflare secret value is empty');

const command = `npx.cmd --yes wrangler@4.127.1 secret put ${name} --config .\\wrangler.jsonc`;
const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], {
  cwd: new URL('..', import.meta.url),
  stdio: ['pipe', 'inherit', 'inherit'],
  windowsHide: true
});
child.stdin.end(value);
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', resolve);
});
value = '';
if (exitCode !== 0) process.exitCode = exitCode;
