import { beforeAll, afterAll, it, expect } from 'vitest';
import { Client } from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

let db: Client, schema: string;
const userA = randomUUID(),
  userB = randomUUID(),
  admin = randomUUID();
const persona = randomUUID(),
  version = randomUUID(),
  visitor = randomUUID();
const legacyChat = randomUUID();
const digest = (s = randomUUID()) => createHash('sha256').update(s).digest('hex');
const migrationNames = [
  '0001_foundation',
  '0002_admin_content',
  '0003_published_slug',
  '0004_immutable_chat_publication',
  '0005_ai_safety',
  '0006_ai_ledger_precision',
];
async function chat(
  owner: 'user' | 'admin' | 'visitor' = 'user',
  key: string | null = null,
  uid = userA,
) {
  const id = randomUUID();
  await db.query(
    'INSERT INTO "ChatSession"(id,"personaId","coreVersionId","userId","adminId","visitorId","creationKey","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())',
    [
      id,
      persona,
      version,
      owner === 'user' ? uid : null,
      owner === 'admin' ? admin : null,
      owner === 'visitor' ? visitor : null,
      key,
    ],
  );
  return id;
}
async function request(sessionId: string, terminal = false) {
  const id = randomUUID();
  await db.query(
    'INSERT INTO "ChatRequest"(id,"sessionId","clientMessageId",fingerprint,status,"coreVersionId","inputText","maxOutputTokens","estimatedInputTokens",response) VALUES ($1,$2,$3,$4,$5,$6,$7,10,10,$8)',
    [
      id,
      sessionId,
      randomUUID(),
      digest(),
      terminal ? 'succeeded' : 'pending',
      version,
      'TEST PRIVATE INPUT\n',
      { content: 'TEST PRIVATE RESPONSE' },
    ],
  );
  return id;
}
async function erase(sessionId: string) {
  await db.query('UPDATE "ChatSession" SET status=$2,"deletedAt"=now() WHERE id=$1', [
    sessionId,
    'closed',
  ]);
  await db.query("SELECT set_config('personaverse.privacy_action','erase',true)");
  await db.query('UPDATE "ChatRequest" SET "inputText"=$2,response=NULL WHERE "sessionId"=$1', [
    sessionId,
    '',
  ]);
  await db.query('DELETE FROM "ChatMessage" WHERE "sessionId"=$1', [sessionId]);
}
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
  if (
    process.env.APP_ENV !== 'test' ||
    url.pathname !== '/personaverse_v2_test' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname)
  )
    throw new Error('Isolated local PostgreSQL required');
  url.searchParams.delete('schema');
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  schema = 'pv_user_constraints_' + randomUUID().replaceAll('-', '');
  await db.query(`CREATE SCHEMA "${schema}"`);
  await db.query(`SET search_path TO "${schema}"`);
  for (const folder of migrationNames)
    await db.query(readFileSync('database/migrations/' + folder + '/migration.sql', 'utf8'));
  // Legacy anonymous rows and exact source predate 0007; no migration may silently claim them.
  await db.query('INSERT INTO "AdminAccount"(id,email,"passwordHash") VALUES ($1,$2,$3)', [
    admin,
    admin + '@test.invalid',
    'TEST ONLY',
  ]);
  await db.query('INSERT INTO "Persona"(id,slug,name,"updatedAt") VALUES ($1,$2,$3,now())', [
    persona,
    'test-' + persona,
    'TEST ONLY',
  ]);
  await db.query(
    'INSERT INTO "PersonaCoreVersion"(id,"personaId","versionNumber","coreText","openingMessage","profileSnapshot","createdBy") VALUES ($1,$2,1,$3,$4,$5,$6)',
    [version, persona, '  TEST ONLY EXACT CORE\n', 'TEST ONLY', {}, admin],
  );
  await db.query(
    'INSERT INTO "VisitorSession"(id,"tokenHash","expiresAt") VALUES ($1,$2,now()+interval \'1 day\')',
    [visitor, digest()],
  );
  await db.query(
    'INSERT INTO "ChatSession"(id,"personaId","coreVersionId","visitorId","updatedAt") VALUES ($1,$2,$3,$4,now())',
    [legacyChat, persona, version, visitor],
  );
  await db.query(readFileSync('database/migrations/0007_user_accounts/migration.sql', 'utf8'));
  for (const id of [userA, userB])
    await db.query(
      'INSERT INTO "User"(id,email,"passwordHash","updatedAt") VALUES ($1,$2,$3,now())',
      [id, id + '@test.invalid', 'TEST ONLY'],
    );
});
afterAll(async () => {
  if (db) {
    await db.query('ROLLBACK');
    if (schema) await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.end();
  }
});
it('replays 0001–0007 without changing legacy owners or author source', async () => {
  const row = (
    await db.query('SELECT "visitorId","userId","adminId" FROM "ChatSession" WHERE id=$1', [
      legacyChat,
    ])
  ).rows[0];
  expect(row).toEqual({ visitorId: visitor, userId: null, adminId: null });
  expect(
    (await db.query('SELECT "coreText" FROM "PersonaCoreVersion" WHERE id=$1', [version])).rows[0]
      .coreText,
  ).toBe('  TEST ONLY EXACT CORE\n');
});
it('requires exactly one valid owner and rejects unknown users', async () => {
  await expect(
    db.query(
      'INSERT INTO "ChatSession"(id,"personaId","coreVersionId","updatedAt") VALUES ($1,$2,$3,now())',
      [randomUUID(), persona, version],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.query(
      'INSERT INTO "ChatSession"(id,"personaId","coreVersionId","userId","adminId","updatedAt") VALUES ($1,$2,$3,$4,$5,now())',
      [randomUUID(), persona, version, userA, admin],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(chat('user', null, randomUUID())).rejects.toMatchObject({ code: '23503' });
  expect(await chat()).toBeTruthy();
  expect(await chat('admin')).toBeTruthy();
  expect(await chat('visitor')).toBeTruthy();
});
it('makes user IDs immutable and forbids anonymous ownership claims', async () => {
  const id = await chat();
  await expect(
    db.query('UPDATE "ChatSession" SET "userId"=$2 WHERE id=$1', [id, userB]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.query('UPDATE "ChatSession" SET "visitorId"=NULL,"userId"=$2 WHERE id=$1', [
      legacyChat,
      userA,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (await db.query('SELECT "visitorId" FROM "ChatSession" WHERE id=$1', [legacyChat])).rows[0]
      .visitorId,
  ).toBe(visitor);
});
it('keeps creation idempotency scoped to its immutable user', async () => {
  const key = randomUUID(),
    id = await chat('user', key);
  await expect(chat('user', key)).rejects.toMatchObject({ code: '23505' });
  expect(await chat('user', key, userB)).toBeTruthy();
  await expect(
    db.query('UPDATE "ChatSession" SET "creationKey"=$2 WHERE id=$1', [id, randomUUID()]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(chat('admin', randomUUID())).rejects.toMatchObject({ code: '23514' });
});
it('enforces normalized unique emails and irreversible account deletion', async () => {
  await expect(
    db.query('INSERT INTO "User"(id,email,"passwordHash","updatedAt") VALUES ($1,$2,$3,now())', [
      randomUUID(),
      'Upper-' + randomUUID() + '@test.invalid',
      'TEST ONLY',
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.query('INSERT INTO "User"(id,email,"passwordHash","updatedAt") VALUES ($1,$2,$3,now())', [
      randomUUID(),
      userA + '@test.invalid',
      'TEST ONLY',
    ]),
  ).rejects.toMatchObject({ code: '23505' });
  const id = randomUUID();
  await db.query(
    'INSERT INTO "User"(id,email,"passwordHash","updatedAt") VALUES ($1,$2,$3,now())',
    [id, id + '@test.invalid', 'TEST ONLY'],
  );
  await db.query('UPDATE "User" SET status=$2 WHERE id=$1', [id, 'deleted']);
  await expect(
    db.query('UPDATE "User" SET status=$2 WHERE id=$1', [id, 'active']),
  ).rejects.toMatchObject({ code: '23514' });
});
it('rejects malformed/expired sessions, identity changes and revoked-session restoration', async () => {
  await expect(
    db.query(
      'INSERT INTO "UserSession"(id,"userId","tokenHash","expiresAt") VALUES ($1,$2,$3,now()-interval \'1 day\')',
      [randomUUID(), userA, digest()],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.query(
      'INSERT INTO "UserSession"(id,"userId","tokenHash","expiresAt") VALUES ($1,$2,$3,now()+interval \'1 day\')',
      [randomUUID(), userA, 'raw-token'],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  const id = randomUUID();
  await db.query(
    'INSERT INTO "UserSession"(id,"userId","tokenHash","expiresAt") VALUES ($1,$2,$3,now()+interval \'1 day\')',
    [id, userA, digest()],
  );
  await expect(
    db.query('UPDATE "UserSession" SET "userId"=$2 WHERE id=$1', [id, userB]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.query('UPDATE "UserSession" SET "expiresAt"="expiresAt"+interval \'1 day\' WHERE id=$1', [
      id,
    ]),
  ).rejects.toMatchObject({ code: '23514' });
  await db.query('UPDATE "UserSession" SET "lastSeenAt"=now(),"revokedAt"=now() WHERE id=$1', [id]);
  await expect(
    db.query('UPDATE "UserSession" SET "revokedAt"=NULL WHERE id=$1', [id]),
  ).rejects.toMatchObject({ code: '23514' });
});
it.each(['EmailVerification', 'PasswordReset'] as const)(
  '%s activation, expiry and consumption cannot be rebound or reset',
  async (table) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO "${table}"(id,"userId","tokenHash","expiresAt") VALUES ($1,$2,$3,now()+interval '1 hour')`,
      [id, userA, digest()],
    );
    await expect(
      db.query(`UPDATE "${table}" SET "usedAt"=now() WHERE id=$1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
    await db.query(`UPDATE "${table}" SET "deliveredAt"=now() WHERE id=$1`, [id]);
    await db.query(`UPDATE "${table}" SET "usedAt"=now() WHERE id=$1`, [id]);
    for (const field of ['usedAt', 'deliveredAt'])
      await expect(
        db.query(`UPDATE "${table}" SET "${field}"=NULL WHERE id=$1`, [id]),
      ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.query(`UPDATE "${table}" SET "userId"=$2 WHERE id=$1`, [id, userB]),
    ).rejects.toMatchObject({ code: '23514' });
    await db.query(`UPDATE "${table}" SET "revokedAt"=now() WHERE id=$1`, [id]);
    await expect(
      db.query(`UPDATE "${table}" SET "revokedAt"=NULL WHERE id=$1`, [id]),
    ).rejects.toMatchObject({ code: '23514' });
  },
);
it('prevents new/restored messages, requests and deletion reversal after tombstoning', async () => {
  const id = await chat(),
    message = randomUUID();
  await db.query(
    'INSERT INTO "ChatMessage"(id,"sessionId",sequence,role,content,"clientMessageId") VALUES ($1,$2,1,$3,$4,$5)',
    [message, id, 'user', 'TEST PRIVATE MESSAGE', randomUUID()],
  );
  await db.query('UPDATE "ChatSession" SET status=$2,"deletedAt"=now() WHERE id=$1', [
    id,
    'closed',
  ]);
  await expect(
    db.query('UPDATE "ChatSession" SET "deletedAt"=NULL WHERE id=$1', [id]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.query('UPDATE "ChatMessage" SET content=$2 WHERE id=$1', [message, 'RESTORED']),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.query(
      'INSERT INTO "ChatMessage"(id,"sessionId",sequence,role,content,"clientMessageId") VALUES ($1,$2,2,$3,$4,$5)',
      [randomUUID(), id, 'user', 'NEW', randomUUID()],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(request(id)).rejects.toMatchObject({ code: '23514' });
});
it('erases terminal private payloads only under explicit deletion intent while preserving all fee facts', async () => {
  const sid = await chat(),
    rid = await request(sid, true),
    ledgerId = randomUUID(),
    usageId = randomUUID();
  await db.query(
    'INSERT INTO "AiLedgerEntry"(id,"requestId",kind,units,currency,evidence) VALUES ($1,$2,$3,123,$4,$5)',
    [ledgerId, rid, 'settle', 'CNY', digest()],
  );
  await db.query(
    'INSERT INTO "AiUsageRecord"(id,"requestId","sessionId",provider,model,"reservedCost","actualCost",status) VALUES ($1,$2,$3,$4,$5,0.00000123,0.00000123,$6)',
    [usageId, rid, sid, 'deterministic-fake', 'TEST ONLY', 'settled'],
  );
  const before = (await db.query('SELECT * FROM "AiLedgerEntry" WHERE id=$1', [ledgerId])).rows[0];
  await expect(
    db.query('UPDATE "ChatRequest" SET "inputText"=$2,response=NULL WHERE id=$1', [rid, '']),
  ).rejects.toMatchObject({ code: '23514' });
  await db.query('BEGIN');
  try {
    await erase(sid);
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
  const row = (
    await db.query(
      'SELECT "inputText",response,"sessionId","coreVersionId",status FROM "ChatRequest" WHERE id=$1',
      [rid],
    )
  ).rows[0];
  expect(row).toEqual({
    inputText: '',
    response: null,
    sessionId: sid,
    coreVersionId: version,
    status: 'succeeded',
  });
  await expect(
    db.query('UPDATE "ChatRequest" SET "inputText"=$2 WHERE id=$1', [rid, 'RESTORE']),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.query('UPDATE "ChatRequest" SET response=$2 WHERE id=$1', [rid, { restore: true }]),
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    db.query('UPDATE "AiLedgerEntry" SET units=124 WHERE id=$1', [ledgerId]),
  ).rejects.toMatchObject({ code: 'P0001' });
  await expect(
    db.query('UPDATE "AiUsageRecord" SET "actualCost"=0 WHERE id=$1', [usageId]),
  ).rejects.toMatchObject({ code: 'P0001' });
  expect((await db.query('SELECT * FROM "AiLedgerEntry" WHERE id=$1', [ledgerId])).rows[0]).toEqual(
    before,
  );
});
it('rolls back a failed privacy transaction without partially deleting text or ownership', async () => {
  const sid = await chat(),
    rid = await request(sid, true);
  await db.query(
    'INSERT INTO "ChatMessage"(id,"sessionId",sequence,role,content,"clientMessageId") VALUES ($1,$2,1,$3,$4,$5)',
    [randomUUID(), sid, 'user', 'TEST PRIVATE MESSAGE', randomUUID()],
  );
  await db.query('BEGIN');
  try {
    await erase(sid);
    await expect(
      db.query('INSERT INTO "UserFavorite"("userId","personaId") VALUES ($1,$2)', [
        userA,
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: '23503' });
  } finally {
    await db.query('ROLLBACK');
  }
  expect(
    (await db.query('SELECT "deletedAt","userId",status FROM "ChatSession" WHERE id=$1', [sid]))
      .rows[0],
  ).toEqual({ deletedAt: null, userId: userA, status: 'active' });
  expect(
    (await db.query('SELECT "inputText" FROM "ChatRequest" WHERE id=$1', [rid])).rows[0].inputText,
  ).toBe('TEST PRIVATE INPUT\n');
  expect(
    (await db.query('SELECT count(*)::int AS n FROM "ChatMessage" WHERE "sessionId"=$1', [sid]))
      .rows[0].n,
  ).toBe(1);
});
