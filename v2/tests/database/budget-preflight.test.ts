import { it, expect } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
it('0005 rejects legacy requests atomically without financial or author backfill', async () => {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
  if (
    process.env.APP_ENV !== 'test' ||
    url.pathname !== '/personaverse_v2_test' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname)
  )
    throw new Error('Isolated local database required');
  url.searchParams.delete('schema');
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const schema = 'pv_budget_preflight_' + randomUUID().replaceAll('-', '');
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const folder of [
      '0001_foundation',
      '0002_admin_content',
      '0003_published_slug',
      '0004_immutable_chat_publication',
    ])
      await client.query(readFileSync('database/migrations/' + folder + '/migration.sql', 'utf8'));
    const a = randomUUID(),
      p = randomUUID(),
      v = randomUUID(),
      s = randomUUID(),
      r = randomUUID();
    await client.query('INSERT INTO "AdminAccount"(id,email,"passwordHash") VALUES ($1,$2,$3)', [
      a,
      a + '@test.invalid',
      'TEST_ONLY_NOT_A_PASSWORD',
    ]);
    await client.query('INSERT INTO "Persona"(id,slug,name,"updatedAt") VALUES ($1,$2,$3,now())', [
      p,
      p,
      'TEST ONLY',
    ]);
    await client.query(
      'INSERT INTO "PersonaCoreVersion"(id,"personaId","versionNumber","coreText","openingMessage","profileSnapshot","createdBy") VALUES ($1,$2,1,$3,$4,$5,$6)',
      [v, p, '  ORIGINAL TEST SOURCE\n', 'TEST', '{}', a],
    );
    await client.query(
      'INSERT INTO "ChatSession"(id,"personaId","coreVersionId","adminId","updatedAt") VALUES ($1,$2,$3,$4,now())',
      [s, p, v, a],
    );
    await client.query(
      'INSERT INTO "ChatRequest"(id,"sessionId","clientMessageId",fingerprint,status) VALUES ($1,$2,$3,$4,$5)',
      [r, s, randomUUID(), 'a'.repeat(64), 'pending'],
    );
    await expect(
      client.query(readFileSync('database/migrations/0005_ai_safety/migration.sql', 'utf8')),
    ).rejects.toThrow('Legacy AI requests/usage require owner reconciliation');
    await client.query('ROLLBACK');
    expect(
      (await client.query(`SELECT to_regclass('"AiControl"') AS found`)).rows[0].found,
    ).toBeNull();
    expect(
      (await client.query('SELECT count(*)::int AS count FROM "ChatRequest"')).rows[0].count,
    ).toBe(1);
    expect(
      (await client.query('SELECT "coreText" FROM "PersonaCoreVersion"')).rows[0].coreText,
    ).toBe('  ORIGINAL TEST SOURCE\n');
  } finally {
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
