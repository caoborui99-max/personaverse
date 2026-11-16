import { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { unlinkSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { get } from 'node:https';
import { localTls } from './local-tls.ts';
import { passwordHash } from '../../apps/api/src/auth.ts';
export async function workersHarness(
  options: { legacyAnonymousTestMode?: boolean; externalMock?: boolean; https?: boolean } = {},
) {
  const tls = options.https ? localTls() : undefined;
  const origin = `${tls ? 'https' : 'http'}://127.0.0.1:4320`;
  const localGet = async (path: string) => {
    if (!tls) {
      const r = await fetch(origin + path);
      return { status: r.status, value: await r.json() };
    }
    return new Promise<{ status: number; value: unknown }>((resolve, reject) => {
      // Trust the isolated CA and verify the IP SAN; never disable TLS validation.
      const req = get(origin + path, { ca: readFileSync(tls.ca) }, (r) => {
        let data = '';
        r.on('data', (chunk) => {
          data += chunk;
        });
        r.on('end', () => {
          try {
            resolve({ status: r.statusCode ?? 0, value: JSON.parse(data) });
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(2000, () => req.destroy(new Error('Local TLS health timeout')));
    });
  };
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
    await localGet('/api/v1/health');
    throw new Error('PORT_ALREADY_IN_USE');
  } catch (e) {
    if (e instanceof Error && e.message === 'PORT_ALREADY_IN_USE') throw e;
  }
  schema = 'pv_workerd_' + randomUUID().replaceAll('-', '');
  root = new PrismaClient();
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('schema', schema);
  // Playwright may clear test-results when another suite starts. Private mail
  // fixtures must outlive those output-directory resets and stay off HTTP.
  const mailDirectory = resolve('.local-preview/cloudflare-validation', 'mail-' + randomUUID());
  mkdirSync(mailDirectory, { recursive: true, mode: 0o700 });
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
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      PV_LOCAL_MAIL_DIR: mailDirectory,
      PV_RENGINE_MOCK: options.externalMock ? '1' : '0',
      PV_LEGACY_ANON_REGRESSION: options.legacyAnonymousTestMode === false ? '0' : '1',
      PV_CF_HTTPS: tls ? '1' : '0',
      PV_CF_TLS_KEY: tls?.key ?? '',
      PV_CF_TLS_CERT: tls?.cert ?? '',
    },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error('Local Workers process exited');
    try {
      if ((await localGet('/api/v1/health')).status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error('Local Workers did not become healthy');

  return {
    origin,
    tls,
    db,
    mailDirectory,
    email,
    password,
    adminId,
    async reload(localProtocol?: 'http' | 'https') {
      const configPath = 'cloudflare/api/.local-runtime.json';
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const generation = randomUUID();
      config.vars.LOCAL_GENERATION = generation;
      if (localProtocol) config.dev.local_protocol = localProtocol;
      writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        try {
          const r = await localGet('/__local/runtime');
          if ((r.value as { generation: string }).generation === generation) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error('Local configuration reload did not complete');
    },
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
      rmSync(mailDirectory, { recursive: true, force: true });
      if (tls) rmSync(tls.directory, { recursive: true, force: true });
      try {
        unlinkSync('cloudflare/api/.dev.vars');
      } catch {}
      rmSync('cloudflare/api/.local-runtime.json', { force: true });
    },
  };
}
