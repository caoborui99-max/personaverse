import { localMailBridge } from './local-mail-bridge.mjs';
import { spawn, spawnSync } from 'node:child_process';
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
let mailbox;
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
  const generated = spawnSync(process.execPath, ['scripts/generate-static-argon.mjs'], {
    stdio: 'inherit',
  });
  if (generated.status !== 0) throw new Error('Static WASM preparation failed');
  process.loadEnvFile('.env.test.local');
  const url = process.env.DATABASE_URL;
  const parsed = new URL(url);
  if (
    parsed.pathname !== '/personaverse_v2_test' ||
    !['127.0.0.1', 'localhost'].includes(parsed.hostname)
  )
    throw new Error('Isolated PostgreSQL only');
  mailbox = await localMailBridge({
    directory: process.env.PV_LOCAL_MAIL_DIR ?? '.local-mail',
    origin: 'http://127.0.0.1:4320',
  });
  writeFileSync(
    'cloudflare/api/.dev.vars',
    `TEST_DATABASE_URL=${url}\nLEGACY_ANON_REGRESSION=${process.env.PV_LEGACY_ANON_REGRESSION === '1' ? '1' : '0'}\nLOCAL_MAIL_URL=${mailbox.url}\nLOCAL_MAIL_CAPABILITY=${mailbox.capability}\n`,
    { mode: 0o600 },
  );
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
p.on('exit', async (c) => {
  await mailbox?.close();
  process.exit(c ?? 1);
});
