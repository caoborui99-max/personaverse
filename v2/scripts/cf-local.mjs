import { localMailBridge } from './local-mail-bridge.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import ts from 'typescript';
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
const apiRuntimeConfig = 'cloudflare/api/.local-runtime.json';
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
  const https = process.env.PV_CF_HTTPS === '1';
  const origin = `${https ? 'https' : 'http'}://127.0.0.1:4320`;
  const tlsArgs = [];
  if (https) {
    const key = process.env.PV_CF_TLS_KEY;
    const cert = process.env.PV_CF_TLS_CERT;
    if (!key || !cert) throw new Error('Explicit local TLS key and certificate required');
    readFileSync(key);
    readFileSync(cert);
    tlsArgs.push('--local-protocol', 'https', '--https-key-path', key, '--https-cert-path', cert);
  }
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
    origin,
  });
  writeFileSync(
    'cloudflare/api/.dev.vars',
    `WEB_ORIGIN=${origin}\nRENGINE_MOCK=${process.env.PV_RENGINE_MOCK === '1' ? '1' : '0'}\nTEST_DATABASE_URL=${url}\nLEGACY_ANON_REGRESSION=${process.env.PV_LEGACY_ANON_REGRESSION === '1' ? '1' : '0'}\nLOCAL_MAIL_URL=${mailbox.url}\nLOCAL_MAIL_CAPABILITY=${mailbox.capability}\n`,
    { mode: 0o600 },
  );
  const source = ts.parseConfigFileTextToJson(
    'cloudflare/api/wrangler.jsonc',
    readFileSync('cloudflare/api/wrangler.jsonc', 'utf8'),
  );
  if (source.error) throw new Error('Invalid local API configuration');
  // Multi-worker CLI options apply to the first worker. Pin the API origin's
  // protocol too, including after a Wrangler config/source hot reload.
  const runtimeJson = Buffer.from(
    JSON.stringify({
      ...source.config,
      vars: { ...source.config.vars, WEB_ORIGIN: origin },
      dev: { ...source.config.dev, local_protocol: https ? 'https' : 'http' },
    }),
  );
  if (runtimeJson.length > 4096)
    throw new Error('Local runtime configuration exceeds reserved size');
  const runtimeBuffer = Buffer.alloc(4096, ' ');
  runtimeJson.copy(runtimeBuffer);
  writeFileSync(apiRuntimeConfig, runtimeBuffer, { mode: 0o600 });
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
    apiRuntimeConfig,
    '-c',
    'cloudflare/password/wrangler.jsonc',
    ...tlsArgs,
  ];
} else throw new Error('Only local build/dev are supported; no remote command exists');
const p = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => p.kill(s));
p.on('exit', async (c) => {
  await mailbox?.close();
  if (command === 'dev') rmSync(apiRuntimeConfig, { force: true });
  process.exit(c ?? 1);
});
