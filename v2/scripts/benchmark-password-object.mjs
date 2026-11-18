import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const wr = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = wr('miniflare');
const esbuild = wr('esbuild');
const output = resolve('.local-preview/password-object-validation/benchmark');
mkdirSync(output, { recursive: true, mode: 0o700 });
if (
  spawnSync(process.execPath, ['scripts/generate-static-argon.mjs'], { stdio: 'pipe' }).status !== 0
)
  throw new Error('Pinned static WASM generation failed');
const common = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['node:*', 'cloudflare:*', '*.wasm'],
  metafile: true,
  minify: false,
};
const caller = await esbuild.build({
  ...common,
  entryPoints: ['cloudflare/password-benchmark.ts'],
  outfile: output + '/caller.js',
});
await esbuild.build({
  ...common,
  entryPoints: ['cloudflare/password-worker.ts'],
  outfile: output + '/password.js',
  alias: { 'hash-wasm': resolve('cloudflare/generated/hash-wasm/static.mjs') },
});
const callerInputs = Object.keys(caller.metafile.inputs);
if (callerInputs.some((x) => /hash-wasm|argon-wasm|password-worker|\.wasm$/.test(x)))
  throw new Error('Password computation leaked into caller bundle');
const modules = (name) => [
  {
    type: 'ESModule',
    path: output + '/' + name + '.js',
    contents: readFileSync(output + '/' + name + '.js'),
  },
];
const mf = new Miniflare(
  convertV4MiniflareOptions({
    host: '127.0.0.1',
    port: 0,
    inspectorPort: 0,
    log: new Log(LogLevel.ERROR),
    durableObjectsPersist: false,
    workers: [
      {
        name: 'caller',
        compatibilityDate: '2026-11-13',
        compatibilityFlags: ['nodejs_compat'],
        modules: modules('caller'),
        durableObjects: {
          PASSWORD_HASHERS: {
            className: 'PasswordHasher',
            scriptName: 'password',
            useSQLite: true,
          },
        },
      },
      {
        name: 'password',
        compatibilityDate: '2026-11-13',
        modules: [
          ...modules('password'),
          ...['argon2', 'blake2b'].map((name) => ({
            type: 'CompiledWasm',
            path: output + '/' + name + '.wasm',
            contents: readFileSync('cloudflare/generated/hash-wasm/' + name + '.wasm'),
          })),
        ],
        durableObjects: { SELF: { className: 'PasswordHasher', useSQLite: true } },
      },
    ],
  }),
);
const sockets = [];
async function inspector(url) {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const job = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) job?.reject(new Error('Local inspector protocol failed'));
    else job?.resolve(message.result);
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const key = ++id;
      pending.set(key, { resolve, reject });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
}
function profileSummary(profile, count) {
  const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
  const byName = {};
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const name = nodes.get(profile.samples[i])?.callFrame.functionName ?? '(unknown)';
    byName[name] = (byName[name] ?? 0) + 1;
  }
  return {
    // timeDeltas can include an entire await gap in the next sample. Neither
    // those deltas nor total wallProfileMs are a per-isolate CPU meter.
    samplesPerRequest: (profile.samples?.length ?? 0) / count,
    wasmSamples: (profile.samples ?? []).filter((id) =>
      nodes.get(id)?.callFrame.functionName.startsWith('wasm-function'),
    ).length,
    sampleCountsByFunction: Object.fromEntries(
      Object.entries(byName)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    ),
    wallProfileMs: (profile.endTime - profile.startTime) / 1000,
    samples: profile.samples?.length ?? 0,
  };
}
try {
  const origin = await mf.ready;
  const request = async (path) => {
    const r = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('Local benchmark request failed');
    const v = await r.json();
    if ('valid' in v && !v.valid) throw new Error('Real password computation failed');
    return v;
  };
  await request('/setup');
  for (let n = 0; n < 2; n++) {
    await request('/hash');
    await request('/verify');
  }
  const inspectorOrigin = await mf.getInspectorURL();
  inspectorOrigin.protocol = inspectorOrigin.protocol === 'wss:' ? 'https:' : 'http:';
  const targets = await (await fetch(new URL('/json/list', inspectorOrigin))).json();
  const clients = {};
  for (const name of ['caller', 'password']) {
    const target = targets.find(
      (x) => x.id === 'core:user:' + name || x.title === 'core:user:' + name,
    );
    if (!target) throw new Error('Separate isolate inspector target missing: ' + name);
    clients[name] = await inspector(target.webSocketDebuggerUrl);
    await clients[name]('Profiler.enable');
    await clients[name]('Profiler.setSamplingInterval', { interval: 100 });
  }
  const metrics = {};
  for (const path of ['/health', '/hash', '/verify']) {
    for (const client of Object.values(clients)) await client('Profiler.start');
    for (let n = 0; n < 12; n++) await request(path);
    metrics[path] = {};
    for (const [name, client] of Object.entries(clients)) {
      const { profile } = await client('Profiler.stop');
      metrics[path][name] = profileSummary(profile, 12);
    }
  }
  const result = {
    runtime:
      'local Miniflare/workerd; separate caller and password isolates; SQLite-backed private Durable Object; no cloud resources',
    method:
      'V8 per-isolate stack sampling proves where WASM executes. timeDeltas may include await gaps and must NOT be interpreted as CPU milliseconds. Neither local cloud quotas nor per-isolate CPU limits are enforced or verified.',
    hostedFreeCpuVerified: false,
    callerInputs,
    parameters: { memoryKiB: 19456, timeCost: 2, parallelism: 1 },
    metrics,
  };
  for (const path of ['/hash', '/verify'])
    if (metrics[path].caller.wasmSamples !== 0 || metrics[path].password.wasmSamples === 0)
      throw new Error('WASM execution placement was not verified in separate isolates');
  writeFileSync(output + '/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const socket of sockets) socket.close();
  await mf.dispose();
}
