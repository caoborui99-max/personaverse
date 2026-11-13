import { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { databaseConfig } from '../apps/api/src/config.ts';
import { passwordHash } from '../apps/api/src/auth.ts';
import { ensureTestDraft } from './seed-test.ts';
const config = databaseConfig();
if (config.environment !== 'test') throw new Error('Test database required');
const schema = 'pv_browser_' + randomUUID().replaceAll('-', '');
const url = new URL(config.databaseUrl);
const root = new PrismaClient();
await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
let status = 1;
try {
  const migration = spawnSync(process.execPath, ['scripts/database.mjs', 'migrate'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
  if (migration.status !== 0) throw new Error('Browser test clean migration failed');
  const password = randomBytes(24).toString('hex');
  const email = 'owner-' + randomUUID() + '@test.invalid';
  await db.adminAccount.create({ data: { email, passwordHash: await passwordHash(password) } });
  // The only fixture is a clearly marked UNPUBLISHED test draft; startup never seeds formal content.
  await ensureTestDraft(db);
  const p = spawnSync(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.database.config.ts'],
    {
      env: {
        ...process.env,
        PV_MODE: 'database',
        DATABASE_URL: url.toString(),
        TEST_ADMIN_EMAIL: email,
        TEST_ADMIN_PASSWORD: password,
      },
      stdio: 'inherit',
    },
  );
  status = p.status ?? 1;
} finally {
  await db.$disconnect();
  await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await root.$disconnect();
}
process.exit(status);
