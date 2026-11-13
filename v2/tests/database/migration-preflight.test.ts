import { expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
it('aborts inconsistent legacy publication atomically without changing author content or leaving partial DDL', async () => {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
  if (
    process.env.APP_ENV !== 'test' ||
    url.pathname !== '/personaverse_v2_test' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname)
  )
    throw new Error('Isolated test database required');
  const schema = 'pv_preflight_' + randomUUID().replaceAll('-', '');
  const root = new PrismaClient();
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('schema', schema);
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  mkdirSync('test-results', { recursive: true });
  const folder = mkdtempSync('test-results/preflight-');
  try {
    copyFileSync('database/schema.prisma', join(folder, 'schema.prisma'));
    mkdirSync(join(folder, 'migrations'));
    copyFileSync(
      'database/migrations/migration_lock.toml',
      join(folder, 'migrations/migration_lock.toml'),
    );
    for (const name of ['0001_foundation', '0002_admin_content', '0003_published_slug']) {
      mkdirSync(join(folder, 'migrations', name));
      copyFileSync(
        join('database/migrations', name, 'migration.sql'),
        join(folder, 'migrations', name, 'migration.sql'),
      );
    }
    const old = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--schema',
        join(folder, 'schema.prisma'),
      ],
      { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' },
    );
    expect(old.status).toBe(0);
    const admin = await db.adminAccount.create({
      data: { email: randomUUID() + '@test.invalid', passwordHash: 'TEST_ONLY' },
    });
    const p = await db.persona.create({
      data: { id: randomUUID(), slug: 'legacy-' + randomUUID(), name: 'TEST LEGACY' },
    });
    const version = await db.personaCoreVersion.create({
      data: {
        personaId: p.id,
        versionNumber: 1,
        coreText: ' \n ORIGINAL LEGACY SOURCE ',
        openingMessage: 'TEST',
        profileSnapshot: {},
        createdBy: admin.id,
      },
    });
    await db.persona.update({
      where: { id: p.id },
      data: { status: 'published', publishedVersionId: version.id, publishedSlug: p.slug },
    });
    const applied = spawnSync(
      process.execPath,
      [
        'node_modules/prisma/build/index.js',
        'db',
        'execute',
        '--file',
        'database/migrations/0004_immutable_chat_publication/migration.sql',
        '--url',
        url.toString(),
      ],
      { env: process.env, encoding: 'utf8' },
    );
    expect(applied.status).not.toBe(0);
    expect(
      (applied.stdout + applied.stderr).includes('Legacy published snapshot needs owner review'),
    ).toBe(true);
    const checks = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=${schema} AND c.conname='published_pointer_pair'`;
    expect(Number(checks[0]?.count)).toBe(0);
    const triggers = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND t.tgname='immutable_chat_binding'`;
    expect(Number(triggers[0]?.count)).toBe(0);
    expect(
      (await db.personaCoreVersion.findUniqueOrThrow({ where: { id: version.id } })).coreText,
    ).toBe(' \n ORIGINAL LEGACY SOURCE ');
    expect((await db.persona.findUniqueOrThrow({ where: { id: p.id } })).publishedVersionId).toBe(
      version.id,
    );
    expect(
      readFileSync(
        'database/migrations/0004_immutable_chat_publication/migration.sql',
        'utf8',
      ).trim(),
    ).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
  } finally {
    await db.$disconnect();
    await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await root.$disconnect();
    rmSync(folder, { recursive: true });
  }
}, 30000);
