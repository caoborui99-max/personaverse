import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const command = process.argv[2];
const env = {
  ...process.env,
  CLOUDFLARE_API_TOKEN: '',
  CLOUDFLARE_API_KEY: '',
  CLOUDFLARE_ACCOUNT_ID: '',
  WRANGLER_SEND_METRICS: 'false',
  NEXT_TELEMETRY_DISABLED: '1',
  XDG_CONFIG_HOME: process.cwd() + '/.local-cf-config',
};
let args,
  cwd = process.cwd();
if (command === 'build') {
  cwd += '/apps/web';
  env.PV_WORKERS_ADAPTER = 'opennext';
  args = [
    '../../node_modules/@opennextjs/cloudflare/dist/cli/index.js',
    'build',
    '--skipWranglerConfigCheck',
  ];
} else if (command === 'dev') {
  process.loadEnvFile('.env.test.local');
  const url = process.env.DATABASE_URL;
  const parsed = new URL(url);
  if (
    parsed.pathname !== '/personaverse_v2_test' ||
    !['127.0.0.1', 'localhost'].includes(parsed.hostname)
  )
    throw new Error('Isolated PostgreSQL only');
  writeFileSync('cloudflare/api/.dev.vars', `TEST_DATABASE_URL=${url}\n`, { mode: 0o600 });
  args = [
    'node_modules/wrangler/bin/wrangler.js',
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    '4320',
    '-c',
    'cloudflare/web.jsonc',
    '-c',
    'cloudflare/api/wrangler.jsonc',
  ];
} else throw new Error('Only local build/dev are supported; no remote command exists');
const p = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => p.kill(s));
p.on('exit', (c) => process.exit(c ?? 1));
