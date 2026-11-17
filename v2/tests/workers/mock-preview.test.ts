import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { localTls } from './local-tls.ts';
import { get } from 'node:https';
import { readFileSync as readTlsFile, rmSync as removeTls } from 'node:fs';
const require = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = await import(require.resolve('miniflare'));
const { build } = await import(require.resolve('esbuild'));
it('public gateway and private signed bridge execute in actual local workerd; spoofed proof, local probes and mail pages fail closed', async () => {
  const secret = randomBytes(32).toString('hex');
  const origin = 'https://pv-web-mock-preview.test-account.workers.dev';
  const compiled = await build({
    stdin: {
      contents: `import { gateway } from './cloudflare/mock-preview/gateway.ts';import { verifyBridge } from './packages/api-client/src/private-bridge.ts';export default {fetch(request,env){return gateway(request,{...env,API:{async fetch(r){return Response.json({ip:await verifyBridge(r,env.BRIDGE_SECRET),forwarded:r.headers.get('x-forwarded-for')});}}},async()=>new Response('render'));}};`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    external: ['node:*'],
    target: 'es2022',
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: compiled.outputFiles[0].text,
      compatibilityDate: '2026-11-13',
      compatibilityFlags: ['nodejs_compat'],
      bindings: { WEB_ORIGIN: origin, BRIDGE_SECRET: secret },
    }),
  );
  try {
    for (const path of ['/__local/probe', '/%5f%5flocal/runtime'])
      expect((await mf.dispatchFetch(origin + path)).status).toBe(404);
    expect((await mf.dispatchFetch(origin + '/register')).status).toBe(503);
    expect(
      (await mf.dispatchFetch(origin + '/api/v1/health', { headers: { 'x-pv-ip': '203.0.113.8' } }))
        .status,
    ).toBe(403);
    const r = await mf.dispatchFetch(origin + '/api/v1/health', {
      headers: { 'cf-connecting-ip': '203.0.113.4', 'x-forwarded-for': '198.51.100.9' },
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ip: '203.0.113.4', forwarded: null });
  } finally {
    await mf.dispose();
  }
});
it('actual private API Worker denies unsigned API and diagnostic requests before any database connection', async () => {
  const { spawn } = await import('node:child_process');
  const { writeFileSync, rmSync, openSync, closeSync } = await import('node:fs');
  const { readFileSync } = await import('node:fs');
  const ts = await import('typescript');
  const source = ts.parseConfigFileTextToJson(
    'api.jsonc',
    readFileSync('cloudflare/mock-preview/api.jsonc', 'utf8'),
  ).config;
  const origin = 'https://pv-web-mock-preview.test-account.workers.dev';
  const config = 'cloudflare/mock-preview/.local-security.json';
  const tls = localTls();
  const status = (path: string, host = '127.0.0.1:4329') =>
    new Promise<number>((resolve, reject) => {
      const req = get(
        'https://127.0.0.1:4329' + path,
        { ca: readTlsFile(tls.ca), servername: '127.0.0.1', headers: { host } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.on('error', reject);
      req.setTimeout(2000, () => req.destroy(new Error('Local TLS deadline')));
    });
  writeFileSync(
    config,
    JSON.stringify({
      ...source,
      vars: {
        ...source.vars,
        HYPERDRIVE_CACHE_DISABLED: 'true',
        WEB_ORIGIN: origin,
        BRIDGE_SECRET: randomBytes(32).toString('hex'),
      },
      hyperdrive: [
        {
          binding: 'HYPERDRIVE',
          id: '0'.repeat(32),
          localConnectionString: `postgresql://pv_mock_app_preview:${randomBytes(32).toString('hex')}@127.0.0.1:1/pv_mock_preview`,
        },
      ],
    }),
    { mode: 0o600 },
  );
  const logFd = openSync('.local-preview/private-api-debug.log', 'w', 0o600);
  const child = spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      '4329',
      '--local-protocol',
      'https',
      '--https-key-path',
      tls.key,
      '--https-cert-path',
      tls.cert,
      '-c',
      config,
      '-c',
      'cloudflare/mock-preview/password.jsonc',
    ],
    {
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: '',
        CLOUDFLARE_API_KEY: '',
        CLOUDFLARE_ACCOUNT_ID: '',
        WRANGLER_SEND_METRICS: 'false',
        XDG_CONFIG_HOME: resolve('.local-cf-config'),
      },
      stdio: ['ignore', logFd, logFd],
    },
  );
  try {
    const end = Date.now() + 45000;
    let ready = false;
    while (Date.now() < end) {
      if (child.exitCode !== null) throw Error('Private preview worker exited');
      try {
        const r = await status('/__local/probe');
        if (r === 404) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ready).toBe(true);
    // Same script, no binding credential: request origin mismatch fails closed.
    expect(await status('/api/v1/health')).toBe(503);
    expect(await status('/api/v1/health', new URL(origin).host)).toBe(403);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', () => resolve());
    });
    removeTls(tls.directory, { recursive: true, force: true });
    closeSync(logFd);
    rmSync(config, { force: true });
  }
}, 60000);
