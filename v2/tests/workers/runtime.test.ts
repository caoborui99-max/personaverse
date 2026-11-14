import { workersHarness } from './harness.ts';
import { beforeAll, afterAll, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { randomUUID, randomBytes } from 'node:crypto';
import type { AdminPersona } from '../../packages/shared/src/index.ts';
import { passwordHash, passwordValid, secretHash } from '../../apps/api/src/auth.ts';
const origin = 'http://127.0.0.1:4320',
  prefix = '/api/v1';
let db: PrismaClient;
let email: string, password: string, adminId: string, headers: Record<string, string>;
let persona: AdminPersona,
  fields: Record<string, unknown>,
  categoryId: string,
  chatId: string,
  guest: Record<string, string>;
// Test result bodies deliberately stay local. No credentials/hashes are logged or committed.
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  h: Record<string, string> = {},
) {
  const res = await fetch(
    origin + (path.startsWith('/api/') || path.startsWith('/__local/') ? path : prefix + path),
    {
      method,
      headers: {
        ...(['GET', 'HEAD'].includes(method) ? {} : { origin, 'content-type': 'application/json' }),
        ...h,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    },
  );
  const text = await res.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = {};
  }
  return { res, value };
}
async function login(secret = password, address = email) {
  const pre = await request('/admin/auth/csrf');
  const cookie = pre.res.headers.get('set-cookie')!.split(';')[0]!;
  const result = await request(
    '/admin/auth/login',
    'POST',
    { email: address, password: secret },
    { cookie, 'x-csrf-token': pre.value.csrfToken },
  );
  if (result.res.status !== 200)
    return { ...result, headers: { origin, cookie, 'x-csrf-token': '' } };
  const adminCookie = result.res.headers.get('set-cookie')!.split(';')[0]!;
  const session = await request('/admin/auth/session', 'GET', undefined, { cookie: adminCookie });
  expect(session.res.status).toBe(200);
  return {
    ...result,
    headers: { origin, cookie: adminCookie, 'x-csrf-token': session.value.csrfToken },
  };
}
let owned: Awaited<ReturnType<typeof workersHarness>>;
beforeAll(async () => {
  owned = await workersHarness();
  ({ db, email, password, adminId } = owned);
}, 120000);
afterAll(async () => {
  await owned?.close();
});
it('Web/API binding, static WASM, PG transactions and default-off control are real workerd responses', async () => {
  const { res, value } = await request('/__local/probe');
  expect(res.status).toBe(200);
  expect(value.database).toEqual({ connected: true, aiDisabled: true });
  expect(value.argon.verified).toBe(true);
  expect((await request('/health')).value.ai).toBe('not-connected');
});
it('rejects unauthenticated/forged and encoded admin paths without exposing data', async () => {
  for (const path of [
    '/admin/personas',
    '/admin/categories',
    '/%61dmin/personas',
    '/admin%2fpersonas',
  ]) {
    const r = await request(path, 'GET', undefined, { 'x-admin': 'true' });
    expect([400, 401, 404]).toContain(r.res.status);
    expect(r.value.items).toBeUndefined();
  }
});
it('verifies Node PHC in Workers for Unicode, whitespace and long passwords', async () => {
  for (const secret of ['  synthetic Unicode 人格 🔒  ', 'X'.repeat(256)]) {
    const address = randomUUID() + '@test.invalid';
    await db.adminAccount.create({
      data: { email: address, passwordHash: await passwordHash(secret) },
    });
    expect((await login(secret, address)).res.status).toBe(200);
    expect((await login('wrong', address)).res.status).toBe(401);
  }
  const address = randomUUID() + '@test.invalid';
  await db.adminAccount.create({
    data: { email: address, passwordHash: '$argon2id$v=19$m=999999999,t=2,p=1$bad$bad' },
  });
  expect((await login('synthetic', address)).res.status).toBe(401);
});
it('bounds simultaneous memory-hard Worker logins without authentication bypass', async () => {
  const results = await Promise.all([login(), login(), login()]);
  for (const result of results) expect([200, 429]).toContain(result.res.status);
  expect(results.some((r) => r.res.status === 200)).toBe(true);
});
it('real login confirms DB session and Strict host-only HttpOnly local cookie', async () => {
  const result = await login();
  expect(result.res.status).toBe(200);
  headers = result.headers;
  const cookie = result.res.headers.get('set-cookie')!;
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Strict');
  expect(cookie).not.toMatch(/Domain=|Secure/i);
  const session = await db.adminSession.findUniqueOrThrow({
    where: { tokenHash: secretHash(headers.cookie!.split('=')[1]!) },
  });
  expect(session.adminId).toBe(adminId);
  expect(session.revokedAt).toBeNull();
  expect(session.tokenHash).toBe(secretHash(headers.cookie!.split('=')[1]!));
});
it('enforces Origin/CSRF, malformed JSON, duplicate query fields and JSON size limits', async () => {
  expect(
    (
      await request(
        '/admin/personas',
        'POST',
        {},
        { ...headers, origin: 'https://attacker.invalid' },
      )
    ).res.status,
  ).toBe(403);
  expect(
    (await request('/admin/personas', 'POST', {}, { ...headers, 'x-csrf-token': 'bad' })).res
      .status,
  ).toBe(403);
  const bad = await fetch(origin + prefix + '/admin/personas', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: '{',
  });
  expect(bad.status).toBe(400);
  expect(
    (await request('/admin/personas?page=1&page=2', 'GET', undefined, headers)).res.status,
  ).toBe(400);
  const large = await fetch(origin + prefix + '/admin/personas', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: ' '.repeat(2_200_001),
  });
  expect(large.status).toBe(413);
});
it('creates a blank draft and category, saves long exact source and enforces unpublished privacy', async () => {
  const c = await request(
    '/admin/categories',
    'POST',
    { name: 'TEST ONLY LOCAL', slug: 'test-' + randomUUID() },
    headers,
  );
  expect(c.res.status).toBe(200);
  categoryId = c.value.id;
  const created = await request('/admin/personas', 'POST', {}, headers);
  expect(created.res.status).toBe(201);
  persona = created.value;
  expect(persona.name).toBe('');
  const core = '  TEST ONLY ORIGINAL\n' + 'TEST TEXT '.repeat(10000) + '\n  ';
  fields = {
    name: 'TEST ONLY LOCAL',
    slug: 'test-' + randomUUID(),
    summary: 'ISOLATED TEST',
    background: 'ISOLATED TEST',
    avatarUrl: '',
    tags: ['TEST'],
    categoryIds: [categoryId],
    coreText: core,
    openingMessage: 'TEST ONLY OPEN',
  };
  const saved = await request(
    '/admin/personas/' + persona.id,
    'PUT',
    { ...fields, expectedRevision: 0 },
    headers,
  );
  expect(saved.res.status).toBe(200);
  persona = saved.value;
  expect(persona.draftVersion!.coreText).toBe(core);
  expect((await request('/personas/' + persona.slug)).res.status).toBe(404);
});
it('rolls back draft revision, version and audit when a transaction fails', async () => {
  const before = await db.persona.findUniqueOrThrow({ where: { id: persona.id } });
  const count = await db.personaCoreVersion.count({ where: { personaId: persona.id } });
  const failed = await request(
    '/admin/personas/' + persona.id,
    'PUT',
    { ...fields, categoryIds: [randomUUID()], expectedRevision: before.revision },
    headers,
  );
  expect(failed.res.status).toBe(400);
  expect((await db.persona.findUniqueOrThrow({ where: { id: persona.id } })).revision).toBe(
    before.revision,
  );
  expect(await db.personaCoreVersion.count({ where: { personaId: persona.id } })).toBe(count);
});
it('detects concurrent edits and publishes only the displayed immutable version', async () => {
  const body = { ...fields, expectedRevision: persona.revision };
  const results = await Promise.all([
    request('/admin/personas/' + persona.id, 'PUT', body, headers),
    request('/admin/personas/' + persona.id, 'PUT', body, headers),
  ]);
  expect(results.map((r) => r.res.status).sort()).toEqual([200, 409]);
  persona = results.find((r) => r.res.status === 200)!.value;
  const pub = await request(
    '/admin/personas/' + persona.id + '/publish',
    'POST',
    { expectedRevision: persona.revision, expectedVersionId: persona.draftVersionId },
    headers,
  );
  expect(pub.res.status).toBe(200);
  persona = pub.value;
  const publicView = await request('/personas/' + persona.slug);
  expect(publicView.res.status).toBe(200);
  expect(JSON.stringify(publicView.value)).not.toContain('coreText');
  for (const path of [
    '/',
    '/explore',
    '/persona/' + persona.slug,
    '/chat/' + persona.slug,
    '/admin/login',
  ]) {
    const res = await fetch(origin + path);
    expect(res.status).toBe(200);
  }
});
it('persists 20 mock turns, retries idempotently and binds immutable owner/version', async () => {
  const v = await request('/visitor/session', 'POST', {});
  guest = { cookie: v.res.headers.get('set-cookie')!.split(';')[0]! };
  const c = await request('/chat/sessions', 'POST', { personaSlug: persona.slug }, guest);
  expect(c.res.status).toBe(200);
  chatId = c.value.id;
  const version = c.value.coreVersionId;
  const id = randomUUID();
  for (let n = 0; n < 20; n++) {
    const r = await request(
      '/chat/sessions/' + chatId + '/messages',
      'POST',
      { clientMessageId: n === 0 ? id : randomUUID(), content: 'TEST ' + n },
      guest,
    );
    expect(r.res.status).toBe(200);
    expect(r.value.id).toBe(chatId);
  }
  const retry = await request(
    '/chat/sessions/' + chatId + '/messages',
    'POST',
    { clientMessageId: id, content: 'TEST 0' },
    guest,
  );
  expect(retry.res.status).toBe(200);
  expect(retry.value.messages).toHaveLength(40);
  const other = await request('/visitor/session', 'POST', {});
  expect(
    (
      await request('/chat/sessions/' + chatId + '/messages', 'GET', undefined, {
        cookie: other.res.headers.get('set-cookie')!.split(';')[0]!,
      })
    ).res.status,
  ).toBe(404);
  const row = await db.chatSession.findUniqueOrThrow({ where: { id: chatId } });
  expect(row.coreVersionId).toBe(version);
  await expect(
    db.chatSession.update({ where: { id: chatId }, data: { adminId, visitorId: null } }),
  ).rejects.toBeDefined();
  const reread = await request('/chat/sessions/' + chatId + '/messages', 'GET', undefined, guest);
  expect(reread.value.messages).toHaveLength(40);
});
it('mock fail-once retries across separate Worker request lifecycles', async () => {
  const body = { clientMessageId: randomUUID(), content: '/fail-once' };
  expect(
    (await request('/chat/sessions/' + chatId + '/messages', 'POST', body, guest)).res.status,
  ).toBe(503);
  expect(
    (await request('/chat/sessions/' + chatId + '/messages', 'POST', body, guest)).res.status,
  ).toBe(200);
  expect(
    (await request('/chat/sessions/' + chatId + '/messages', 'POST', body, guest)).value.messages,
  ).toHaveLength(42);
});
it('rejects parallel messages with NOWAIT safely and retains no duplicate sequences', async () => {
  const results = await Promise.all([
    request(
      '/chat/sessions/' + chatId + '/messages',
      'POST',
      { clientMessageId: randomUUID(), content: 'TEST parallel A' },
      guest,
    ),
    request(
      '/chat/sessions/' + chatId + '/messages',
      'POST',
      { clientMessageId: randomUUID(), content: 'TEST parallel B' },
      guest,
    ),
  ]);
  for (const r of results)
    expect([200, 409], JSON.stringify(r.value.error)).toContain(r.res.status);
  const messages = await db.chatMessage.findMany({ where: { sessionId: chatId } });
  expect(new Set(messages.map((m) => m.sequence)).size).toBe(messages.length);
});
it('AI budget routes stay off, closed sessions and unpublication reject new messages', async () => {
  const fee = await request(
    '/chat/sessions/' + chatId + '/ai-requests',
    'POST',
    { clientMessageId: randomUUID(), content: 'TEST', maxOutputTokens: 10 },
    guest,
  );
  expect(fee.res.status).toBe(503);
  expect(fee.value.error.code).toBe('AI_DISABLED');
  expect((await request('/chat/sessions/' + chatId + '/close', 'POST', {}, guest)).res.status).toBe(
    200,
  );
  expect(
    (
      await request(
        '/chat/sessions/' + chatId + '/messages',
        'POST',
        { clientMessageId: randomUUID(), content: 'TEST' },
        guest,
      )
    ).res.status,
  ).toBe(409);
  const down = await request(
    '/admin/personas/' + persona.id + '/unpublish',
    'POST',
    { expectedRevision: persona.revision },
    headers,
  );
  expect(down.res.status).toBe(200);
  persona = down.value;
  expect((await request('/personas/' + persona.slug)).res.status).toBe(404);
  expect(
    (await request('/chat/sessions', 'POST', { personaSlug: persona.slug }, guest)).res.status,
  ).toBe(404);
});
it('restores a historical version as a new immutable version and archives safely', async () => {
  const old = await db.personaCoreVersion.findFirstOrThrow({
    where: { personaId: persona.id },
    orderBy: { versionNumber: 'asc' },
  });
  const restored = await request(
    '/admin/personas/' + persona.id + '/restore',
    'POST',
    { versionId: old.id, expectedRevision: persona.revision },
    headers,
  );
  expect(restored.res.status).toBe(200);
  persona = restored.value;
  expect(persona.draftVersionId).not.toBe(old.id);
  expect(persona.draftVersion!.coreText).toBe(old.coreText);
  const archive = await request(
    '/admin/personas/' + persona.id + '/archive',
    'POST',
    { expectedRevision: persona.revision },
    headers,
  );
  expect(archive.res.status).toBe(200);
  expect(archive.value.status).toBe('archived');
});
it('database connection interruption rolls back publication and returns a non-success error', async () => {
  const c = await request('/admin/personas', 'POST', {}, headers);
  const before = c.value;
  await db.$executeRawUnsafe(
    `CREATE FUNCTION kill_workers_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NEW; END; $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER kill_workers_save BEFORE INSERT ON "PersonaCoreVersion" FOR EACH ROW EXECUTE FUNCTION kill_workers_save()`,
  );
  try {
    const r = await request(
      '/admin/personas/' + before.id,
      'PUT',
      { ...fields, slug: 'test-' + randomUUID(), expectedRevision: 0 },
      headers,
    );
    expect(r.res.status).toBe(503);
    expect((await db.persona.findUniqueOrThrow({ where: { id: before.id } })).revision).toBe(0);
    expect(await db.personaCoreVersion.count({ where: { personaId: before.id } })).toBe(0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER kill_workers_save ON "PersonaCoreVersion"');
    await db.$executeRawUnsafe('DROP FUNCTION kill_workers_save()');
  }
});
it('password change creates Workers PHC verifiable in Node and revokes all old sessions', async () => {
  const second = await login();
  const next = '  NEW SYNTHETIC 🔒 ' + randomBytes(16).toString('hex');
  expect(
    (
      await request(
        '/admin/auth/password',
        'POST',
        { currentPassword: password, newPassword: next },
        headers,
      )
    ).res.status,
  ).toBe(200);
  expect(
    await passwordValid(
      (await db.adminAccount.findUniqueOrThrow({ where: { id: adminId } })).passwordHash,
      next,
    ),
  ).toBe(true);
  expect((await request('/admin/auth/session', 'GET', undefined, second.headers)).res.status).toBe(
    401,
  );
  expect((await login(password)).res.status).toBe(401);
  password = next;
  headers = (await login()).headers;
});
it('expires sessions, logs out immediately and records authentication audit', async () => {
  const temporary = await login();
  const raw = temporary.headers.cookie!.split('=')[1]!;
  await db.adminSession.update({
    where: { tokenHash: secretHash(raw) },
    data: {
      createdAt: new Date(Date.now() - 7200000),
      lastSeenAt: new Date(Date.now() - 7200000),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  expect(
    (await request('/admin/auth/session', 'GET', undefined, temporary.headers)).res.status,
  ).toBe(401);
  expect((await request('/admin/auth/logout', 'POST', {}, headers)).res.status).toBe(200);
  expect((await request('/admin/auth/session', 'GET', undefined, headers)).res.status).toBe(401);
  const actions = (await db.adminAuditLog.findMany({ where: { adminId } })).map((a) => a.action);
  expect(actions).toEqual(
    expect.arrayContaining([
      'login',
      'logout',
      'password-change',
      'save-draft',
      'publish',
      'restore-version',
    ]),
  );
});
