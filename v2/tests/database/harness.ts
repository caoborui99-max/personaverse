import { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildDatabaseApp } from '../../apps/api/src/database-app.ts';
import { passwordHash } from '../../apps/api/src/auth.ts';
export async function harness() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
  if (
    process.env.APP_ENV !== 'test' ||
    url.pathname !== '/personaverse_v2_test' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname)
  )
    throw new Error('Isolated test database required');
  const schema = 'pv_system_' + randomUUID().replaceAll('-', '');
  const root = new PrismaClient();
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('schema', schema);
  const migration = spawnSync(process.execPath, ['scripts/database.mjs', 'migrate'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    encoding: 'utf8',
  });
  if (migration.status !== 0) throw new Error('Clean migration failed');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  let now = Date.now();
  const origin = 'http://127.0.0.1:4310';
  const app = buildDatabaseApp({
    db,
    clock: () => now,
    config: { environment: 'test', databaseUrl: url.toString(), origin, secure: false },
  });
  await app.ready();
  const password = randomBytes(24).toString('hex');
  const email = randomUUID() + '@test.invalid';
  const admin = await db.adminAccount.create({
    data: { email, passwordHash: await passwordHash(password) },
  });
  const credentials = { password };
  async function login(secret = credentials.password, address = email) {
    const pre = await app.inject('/api/v1/admin/auth/csrf');
    const cookie = String(pre.headers['set-cookie']).split(';')[0]!;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      headers: { origin, cookie, 'x-csrf-token': pre.json().csrfToken },
      payload: { email: address, password: secret },
    });
    const adminCookie = String(res.headers['set-cookie']).split(';')[0]!;
    const session =
      res.statusCode === 200
        ? await app.inject({ url: '/api/v1/admin/auth/session', headers: { cookie: adminCookie } })
        : null;
    return {
      res,
      headers: {
        origin,
        cookie: adminCookie,
        'x-csrf-token': String(session?.json().csrfToken ?? ''),
      },
      session,
    };
  }
  return {
    app,
    db,
    admin,
    get password() {
      return credentials.password;
    },
    set password(value: string) {
      credentials.password = value;
    },
    email,
    origin,
    login,
    advance: (ms: number) => {
      now += ms;
    },
    close: async () => {
      await app.close();
      await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await root.$disconnect();
    },
  };
}
