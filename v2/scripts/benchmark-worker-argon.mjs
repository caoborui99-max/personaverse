import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
const wr = createRequire(require.resolve('wrangler/package.json'));
const mf = createRequire(wr.resolve('miniflare/package.json'));
const wk = createRequire(mf.resolve('workerd/package.json'));
const binary = wk.resolve('@cloudflare/workerd-linux-64/bin/workerd');
const output = resolve('.local-preview/cloudflare-validation/argon');
if (process.platform !== 'linux') throw new Error('Linux per-thread CPU accounting required');
mkdirSync(output, { recursive: true, mode: 0o700 });
const generated = spawnSync(process.execPath, ['scripts/generate-static-argon.mjs'], {
  stdio: 'pipe',
});
if (generated.status !== 0) throw new Error('Pinned static WASM generation failed');
await wr('esbuild').build({
  entryPoints: ['cloudflare/argon-benchmark.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: resolve(output, 'worker.js'),
  alias: { 'hash-wasm': resolve('cloudflare/generated/hash-wasm/static.mjs') },
  external: ['*.wasm'],
  minify: true,
});
for (const name of ['argon2', 'blake2b'])
  copyFileSync('cloudflare/generated/hash-wasm/' + name + '.wasm', resolve(output, name + '.wasm'));
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise((r, e) => socket.close((x) => (x ? e(x) : r())));
writeFileSync(
  resolve(output, 'local.capnp'),
  `using Workerd = import "/workerd/workerd.capnp";\nconst config :Workerd.Config = (services=[(name="main", worker=(compatibilityDate="2026-11-13",modules=[(name="worker.js",esModule=embed "worker.js"),(name="argon2.wasm",wasm=embed "argon2.wasm"),(name="blake2b.wasm",wasm=embed "blake2b.wasm")]))],sockets=[(name="http",address="127.0.0.1:${port}",http=(),service="main")]);\n`,
);
const child = spawn(binary, ['serve', 'local.capnp'], {
  cwd: output,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (b) => (stderr += b.toString()));
function cpu() {
  let total = 0n;
  for (const tid of readdirSync(`/proc/${child.pid}/task`)) {
    try {
      total += BigInt(
        readFileSync(`/proc/${child.pid}/task/${tid}/schedstat`, 'utf8').split(' ')[0],
      );
    } catch {}
  }
  return total;
}
function memory() {
  return Object.fromEntries(
    readFileSync(`/proc/${child.pid}/status`, 'utf8')
      .split('\n')
      .filter((l) => /^Vm(RSS|HWM):/.test(l))
      .map((l) => {
        const [k, v] = l.split(':');
        return [k, Number(v.trim().split(' ')[0])];
      }),
  );
}
async function request(path) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Local benchmark HTTP failure');
  return r.json();
}
function stats(samples) {
  const values = samples.map((x) => x.cpuMs).sort((a, b) => a - b);
  return {
    samples,
    medianCpuMs: values[Math.floor(values.length / 2)],
    p95CpuMs: values[Math.ceil(values.length * 0.95) - 1],
    meanCpuMs: values.reduce((a, b) => a + b, 0) / values.length,
  };
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('workerd failed: ' + stderr.slice(0, 800));
    try {
      await request('/health');
      ready = true;
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error('Local benchmark startup timeout');
  await request('/setup');
  for (let n = 0; n < 2; n++) {
    await request('/hash');
    await request('/verify');
  }
  const metrics = {};
  for (const path of ['/health', '/hash', '/verify']) {
    const samples = [];
    for (let n = 0; n < 12; n++) {
      const before = cpu(),
        start = performance.now();
      const result = await request(path);
      const cpuMs = Number(cpu() - before) / 1e6;
      if (path !== '/health' && result.valid !== true) throw new Error('Argon verification failed');
      samples.push({ cpuMs, wallMs: performance.now() - start });
    }
    metrics[path] = stats(samples);
  }
  const result = {
    runtime: 'standalone local workerd; pinned static WASM',
    version: JSON.parse(readFileSync(mf.resolve('workerd/package.json'))).version,
    parameters: { memoryKiB: 19456, timeCost: 2, parallelism: 1 },
    method:
      'sum of Linux per-thread schedstat runtime deltas around real HTTP requests; one standalone worker; warmed; no database/network I/O; whole-process CPU estimate, not Cloudflare edge metering',
    freeCpuLimitMs: 10,
    localLimitEnforced: false,
    metrics,
    memoryProcessKiB: memory(),
    freeCpuFitsLocally: metrics['/hash'].medianCpuMs <= 10 && metrics['/verify'].medianCpuMs <= 10,
  };
  writeFileSync(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes('--require-free-cpu') && !result.freeCpuFitsLocally)
    process.exitCode = 2;
} finally {
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 2000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
