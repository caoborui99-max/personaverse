import { beforeAll, afterAll, expect, it } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (
  process.env.APP_ENV !== 'test' ||
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.pathname !== '/personaverse_v2_test'
)
  throw new Error('Isolated PostgreSQL test configuration required');
const schema = 'pv_constraints_' + randomUUID().replaceAll('-', '');
const original = new PrismaClient();
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
let admin: string, p: string, other: string, version: string;
beforeAll(async () => {
  await original.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const migrate = spawnSync(process.execPath, ['scripts/database.mjs', 'migrate'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    encoding: 'utf8',
  });
  if (migrate.status !== 0) throw new Error('Clean schema migration failed');
  admin = (
    await db.adminAccount.create({
      data: { email: randomUUID() + '@test.invalid', passwordHash: 'TEST_ONLY_HASH' },
    })
  ).id;
  p = (await db.persona.create({ data: { id: randomUUID(), slug: 'p-' + randomUUID(), name: '' } }))
    .id;
  other = (
    await db.persona.create({ data: { id: randomUUID(), slug: 'p-' + randomUUID(), name: '' } })
  ).id;
  version = (
    await db.personaCoreVersion.create({
      data: {
        personaId: p,
        versionNumber: 1,
        coreText: '  TEST ONLY\n完整原文  ',
        openingMessage: '',
        profileSnapshot: {},
        createdBy: admin,
      },
    })
  ).id;
}, 30000);
afterAll(async () => {
  await db.$disconnect();
  await original.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await original.$disconnect();
});
it('replays real migrations on a clean PostgreSQL schema with all model tables and validated constraints', async () => {
  const rows = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname=${schema}`;
  expect(rows.map((r) => r.tablename)).toEqual(
    expect.arrayContaining(Prisma.dmmf.datamodel.models.map((m) => m.dbName ?? m.name)),
  );
  const constraints = await db.$queryRaw<
    { conname: string; convalidated: boolean }[]
  >`SELECT conname,convalidated FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=${schema}`;
  expect(constraints.every((c) => c.convalidated)).toBe(true);
  for (const name of [
    'exactly_one_owner',
    'persona_draft_version_owner',
    'persona_published_version_owner',
    'restored_version_owner',
    'test_not_published',
    'positive_sequence',
    'admin_email_normalized',
    'nonnegative_usage',
  ])
    expect(
      constraints.some((c) => c.conname === name),
      name,
    ).toBe(true);
});
it('enforces uniqueness and normalized administrator email', async () => {
  const account = await db.adminAccount.findUniqueOrThrow({ where: { id: admin } });
  await expect(
    db.adminAccount.create({ data: { email: account.email, passwordHash: 'TEST' } }),
  ).rejects.toMatchObject({ code: 'P2002' });
  await expect(
    db.adminAccount.create({ data: { email: 'UPPER@test.invalid', passwordHash: 'TEST' } }),
  ).rejects.toBeDefined();
  await expect(
    db.personaCoreVersion.create({
      data: {
        personaId: p,
        versionNumber: 1,
        coreText: 'TEST',
        openingMessage: '',
        profileSnapshot: {},
        createdBy: admin,
      },
    }),
  ).rejects.toMatchObject({ code: 'P2002' });
});
it('enforces foreign keys, exactly one owner, and cross-persona chat versions', async () => {
  const chat = { personaId: p, coreVersionId: version };
  await expect(db.chatSession.create({ data: chat })).rejects.toBeDefined();
  const visitor = (
    await db.visitorSession.create({
      data: {
        tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
        expiresAt: new Date(Date.now() + 60000),
      },
    })
  ).id;
  await expect(
    db.chatSession.create({ data: { ...chat, adminId: admin, visitorId: visitor } }),
  ).rejects.toBeDefined();
  await expect(
    db.chatSession.create({ data: { ...chat, adminId: randomUUID() } }),
  ).rejects.toBeDefined();
  await expect(
    db.chatSession.create({ data: { ...chat, personaId: other, adminId: admin } }),
  ).rejects.toBeDefined();
  await db.chatSession.create({ data: { ...chat, adminId: admin } });
});
it('rejects draft/published/restored pointers into another persona', async () => {
  await expect(
    db.persona.update({ where: { id: other }, data: { draftVersionId: version } }),
  ).rejects.toBeDefined();
  await expect(
    db.persona.update({ where: { id: other }, data: { publishedVersionId: version } }),
  ).rejects.toBeDefined();
  await expect(
    db.personaCoreVersion.create({
      data: {
        personaId: other,
        versionNumber: 1,
        coreText: 'TEST',
        openingMessage: '',
        profileSnapshot: {},
        createdBy: admin,
        restoredFromId: version,
      },
    }),
  ).rejects.toBeDefined();
});
it('preserves full core source and rejects UPDATE and DELETE of immutable versions', async () => {
  expect((await db.personaCoreVersion.findUniqueOrThrow({ where: { id: version } })).coreText).toBe(
    '  TEST ONLY\n完整原文  ',
  );
  await expect(
    db.personaCoreVersion.update({ where: { id: version }, data: { coreText: 'changed' } }),
  ).rejects.toBeDefined();
  await expect(db.personaCoreVersion.delete({ where: { id: version } })).rejects.toBeDefined();
});
it('rolls back the entire transaction on invalid foreign key', async () => {
  const slug = 'rollback-' + randomUUID();
  await expect(
    db.$transaction(async (tx) => {
      const c = await tx.category.create({ data: { slug, name: slug } });
      await tx.personaCategory.create({ data: { categoryId: c.id, personaId: randomUUID() } });
    }),
  ).rejects.toBeDefined();
  expect(await db.category.count({ where: { slug } })).toBe(0);
});
it('prevents test records from being published and invalid negative usage counters', async () => {
  await expect(
    db.persona.create({
      data: {
        id: randomUUID(),
        slug: 'test-' + randomUUID(),
        name: 'TEST ONLY',
        isTest: true,
        status: 'published',
        publishedVersionId: version,
      },
    }),
  ).rejects.toBeDefined();
  await expect(
    db.quotaBucket.create({
      data: { scope: 'test', subject: 'test', bucketStart: new Date(), calls: -1 },
    }),
  ).rejects.toBeDefined();
});
it('matches Prisma tables, foreign keys and unique indexes with no schema drift', async () => {
  const diff = spawnSync(process.execPath, ['scripts/database.mjs', 'diff'], {
    env: { ...process.env, DATABASE_URL: url.toString() },
    encoding: 'utf8',
  });
  expect(diff.status, diff.stdout).toBe(0);
  const indexes = await db.$queryRaw<
    { table: string; unique: boolean; columns: string[] }[]
  >`SELECT t.relname::text AS "table", i.indisunique AS "unique", ARRAY(SELECT a.attname::text FROM unnest(i.indkey) AS k(attnum) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum) AS columns FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=${schema}`;
  for (const model of Prisma.dmmf.datamodel.models) {
    const expected = [
      ...model.uniqueFields,
      ...model.fields.filter((f) => f.isUnique || f.isId).map((f) => [f.name]),
      ...(model.primaryKey ? [model.primaryKey.fields] : []),
    ];
    for (const fields of expected)
      expect(
        indexes.some(
          (i) =>
            i.table === (model.dbName ?? model.name) &&
            i.unique &&
            JSON.stringify([...i.columns].sort()) === JSON.stringify([...fields].sort()),
        ),
        model.name + ':' + fields.join(','),
      ).toBe(true);
  }
});
