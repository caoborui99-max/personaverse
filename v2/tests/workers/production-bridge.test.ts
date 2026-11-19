import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = await import(require.resolve('miniflare'));
const { build } = await import(require.resolve('esbuild'));
it('actual workerd Service Binding keeps the SSR production URL port-free and verifies the signed cookie-bearing request', async () => {
  const origin = 'https://pv-web-production.test-account.workers.dev';
  const secret = 'synthetic-bridge-secret-32-bytes-minimum';
  const compile = async (contents: string) =>
    (
      await build({
        stdin: { contents, resolveDir: process.cwd() },
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        external: ['node:*'],
        target: 'es2022',
      })
    ).outputFiles[0].text;
  const web = await compile(
    `import { privateApiRequest } from './packages/api-client/src/service-request.ts';export default {async fetch(request,env){let r=await privateApiRequest('http://127.0.0.1:4311/api/v1/personas?page=2',{headers:{cookie:'synthetic=only'}},env.WEB_ORIGIN,env.BRIDGE_SECRET);if(new URL(request.url).pathname==='/tamper')r=new Request(r.url+'&changed=1',r);return env.API.fetch(r);}};`,
  );
  const api = await compile(
    `import { verifyBridge } from './packages/api-client/src/private-bridge.ts';export default {async fetch(request,env){const u=new URL(request.url);if(u.origin!==env.WEB_ORIGIN)return new Response('wrong origin',{status:503});const ip=await verifyBridge(request,env.BRIDGE_SECRET);if(!ip)return new Response('bad proof',{status:403});return Response.json({url:request.url,port:u.port,ip,cookie:request.headers.get('cookie')});}};`,
  );
  const common = {
    modules: true,
    compatibilityDate: '2026-11-13',
    compatibilityFlags: ['nodejs_compat'],
    bindings: { WEB_ORIGIN: origin, BRIDGE_SECRET: secret },
  };
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        { ...common, name: 'web', script: web, serviceBindings: { API: 'api' } },
        { ...common, name: 'api', script: api },
      ],
    }),
  );
  try {
    const response = await mf.dispatchFetch(origin + '/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: origin + '/api/v1/personas?page=2',
      port: '',
      ip: 'ssr',
      cookie: 'synthetic=only',
    });
    expect((await mf.dispatchFetch(origin + '/tamper')).status).toBe(403);
  } finally {
    await mf.dispose();
  }
}, 30000);
