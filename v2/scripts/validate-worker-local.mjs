import { writeFileSync, mkdirSync } from 'node:fs';
const base = 'http://127.0.0.1:4320';
const checks = [];
async function check(name, run) {
  try {
    const result = await run();
    checks.push({ name, passed: result === true, detail: result === true ? 'ok' : result });
  } catch (e) {
    checks.push({ name, passed: false, detail: e instanceof Error ? e.name : 'error' });
  }
}
let probe;
await check('Prisma interactive transaction on isolated PostgreSQL', async () => {
  probe = await (await fetch(base + '/__local/probe')).json();
  return probe.database?.connected === true || probe.database;
});
await check('Argon2id in workerd', async () => probe?.argon?.verified === true || probe?.argon);
await check('Fastify health through Service Binding', async () => {
  const r = await fetch(base + '/api/v1/health');
  return r.status === 200 || { status: r.status };
});
for (const path of [
  '/',
  '/explore',
  '/persona/local-test',
  '/chat/local-test',
  '/favorites',
  '/admin/login',
  '/admin',
])
  await check('SSR ' + path, async () => {
    const r = await fetch(base + path, { redirect: 'manual' });
    const expected = path === '/admin' ? 307 : path.includes('local-test') ? 404 : 200;
    return r.status === expected || { status: r.status, expected };
  });
const report = {
  runtime: 'local workerd only',
  checks,
  passed: checks.filter((c) => c.passed).length,
  failed: checks.filter((c) => !c.passed).length,
};
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/cloudflare-local.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.failed ? 1 : 0;
