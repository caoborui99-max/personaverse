import { spawnSync } from 'node:child_process';
const env = {
  ...process.env,
  CLOUDFLARE_API_TOKEN: '',
  CLOUDFLARE_API_KEY: '',
  CLOUDFLARE_ACCOUNT_ID: '',
  WRANGLER_SEND_METRICS: 'false',
  XDG_CONFIG_HOME: process.cwd() + '/.local-cf-config',
};
for (const name of ['password', 'api', 'web']) {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'deploy',
      '--dry-run',
      '--config',
      `cloudflare/production/${name}.jsonc`,
      '--outdir',
      `.local-preview/production-bundles/${name}`,
    ],
    { env, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
