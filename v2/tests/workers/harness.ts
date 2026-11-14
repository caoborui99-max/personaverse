import { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { unlinkSync } from 'node:fs';
import { passwordHash } from '../../apps/api/src/auth.ts';
const origin = 'http://127.0.0.1:4320';
export async function workersHarness() {
  let root: PrismaClient,
    db: PrismaClient,
    worker: ChildProcess,
    schema: string,
    email: string,
    password: string,
    adminId: string;
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
  if (
    process.env.APP_ENV !== 'test' ||
    url.pathname !== '/personaverse_v2_test' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname)
  )
    throw new Error('Isolated local PostgreSQL required');
  try {
    await fetch(origin + '/api/v1/health');
    throw new Error('PORT_ALREADY_IN_USE');
  } catch (e) {
    if (e instanceof Error && e.message === 'PORT_ALREADY_IN_USE') throw e;
  }
  schema = 'pv_workerd_' + randomUUID().replaceAll('-', '');
  root = new PrismaClient();
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('schema', schema);
  const result = spawnSync(process.execPath, ['scripts/database.mjs', 'migrate'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
  if (result.status !== 0) throw new Error('Isolated Workers migration failed');
  db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  email = randomUUID() + '@test.invalid';
  password = randomBytes(32).toString('hex');
  adminId = (
    await db.adminAccount.create({ data: { email, passwordHash: await passwordHash(password) } })
  ).id;
  worker = spawn(process.execPath, ['scripts/cf-local.mjs', 'dev'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error('Local Workers process exited');
    try {
      const r = await fetch(origin + '/api/v1/health');
      if (r.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error('Local Workers did not become healthy');

  return {
    db,
    email,
    password,
    adminId,
    async close() {
      if (worker && worker.exitCode === null) {
        worker.kill('SIGTERM');
        await Promise.race([once(worker, 'exit'), new Promise((r) => setTimeout(r, 5000))]);
        if (worker.exitCode === null) worker.kill('SIGKILL');
      }
      if (db) await db.$disconnect();
      if (root) {
        if (schema) await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await root.$disconnect();
      }
      try {
        unlinkSync('cloudflare/api/.dev.vars');
      } catch {}
    },
  };
}
