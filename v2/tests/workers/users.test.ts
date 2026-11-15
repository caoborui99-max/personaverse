import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { workersHarness } from './harness.ts';
import { secretHash } from '../../apps/api/src/auth.ts';
let h: Awaited<ReturnType<typeof workersHarness>>;
const origin = 'http://127.0.0.1:4320';
type Session = { cookie: string; 'x-csrf-token': string };
let a: { email: string; password: string; s: Session; id: string },
  b: typeof a,
  other: Session,
  persona: { id: string; slug: string; version: string },
  chatId: string,
  secondId: string;
async function api(
  path: string,
  method = 'GET',
  body?: unknown,
  s: Partial<Session> = {},
  extra: Record<string, string> = {},
) {
  const response = await fetch(origin + '/api/v1' + path, {
    method,
    headers: { origin, 'content-type': 'application/json', ...s, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  return { response, value };
}
async function anon(path: string, body: unknown) {
  const pre = await api('/auth/csrf');
  const cookie = pre.response.headers.get('set-cookie')!.split(';')[0]!;
  return api('/auth/' + path, 'POST', body, { cookie, 'x-csrf-token': pre.value.csrfToken });
}
function mail(email: string, purpose: 'verify' | 'reset') {
  for (const name of readdirSync(h.mailDirectory).reverse()) {
    const file = h.mailDirectory + '/' + name;
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (value.to === email && value.purpose === purpose) {
      unlinkSync(file);
      return value;
    }
  }
  throw new Error('Private synthetic mail missing');
}
async function login(email: string, password: string) {
  const r = await anon('login', { email, password });
  expect(r.response.status).toBe(200);
  const cookie = r.response.headers.get('set-cookie')!.split(';')[0]!;
  const session = await api('/auth/session', 'GET', undefined, { cookie });
  expect(session.response.status).toBe(200);
  return { s: { cookie, 'x-csrf-token': session.value.csrfToken }, id: session.value.user.id };
}
async function account() {
  const email = randomUUID() + '@test.invalid',
    password = randomBytes(24).toString('hex');
  const r = await anon('register', { email, password });
  expect(r.response.status).toBe(202);
  const proof = mail(email, 'verify');
  expect((await anon('verify', { token: proof.token })).response.status).toBe(200);
  return { email, password, ...(await login(email, password)) };
}
beforeAll(async () => {
  h = await workersHarness({ legacyAnonymousTestMode: false });
}, 120000);
afterAll(async () => {
  await h?.close();
});
it('requires user login for new chats and never claims anonymous sessions', async () => {
  expect((await api('/visitor/session', 'POST', {})).response.status).toBe(401);
  expect((await api('/chat/sessions', 'POST', { personaSlug: 'test' })).response.status).toBe(401);
  expect(
    (await api('/me/chats', 'GET', undefined, {}, { 'x-user-id': randomUUID() })).response.status,
  ).toBe(401);
});
it('registers and verifies via private local mail; tokens are hashed and single-use', async () => {
  const email = randomUUID() + '@test.invalid',
    password = randomBytes(24).toString('hex');
  const registered = await anon('register', { email, password });
  expect(registered.response.status).toBe(202);
  expect(JSON.stringify(registered.value)).not.toContain('token');
  expect((await anon('login', { email, password })).response.status).toBe(401);
  const proof = mail(email, 'verify');
  const row = await h.db.emailVerification.findUniqueOrThrow({
    where: { tokenHash: secretHash(proof.token) },
  });
  expect(row.tokenHash).not.toBe(proof.token);
  expect(row.deliveredAt).not.toBeNull();
  expect((await anon('verify', { token: proof.token })).response.status).toBe(200);
  expect((await anon('verify', { token: proof.token })).response.status).toBe(400);
  a = { email, password, ...(await login(email, password)) };
  b = await account();
});
it('keeps user and administrator identities independent; checks CSRF and Origin', async () => {
  expect((await api('/admin/personas', 'GET', undefined, a.s)).response.status).toBe(401);
  expect(
    (await api('/me', 'PUT', { displayName: 'TEST' }, a.s, { origin: 'https://attacker.invalid' }))
      .response.status,
  ).toBe(403);
  expect(
    (await api('/me', 'PUT', { displayName: 'TEST' }, { ...a.s, 'x-csrf-token': 'bad' })).response
      .status,
  ).toBe(403);
  const pre = await api('/admin/auth/csrf');
  const r = await api(
    '/admin/auth/login',
    'POST',
    { email: h.email, password: h.password },
    {
      cookie: pre.response.headers.get('set-cookie')!.split(';')[0]!,
      'x-csrf-token': pre.value.csrfToken,
    },
  );
  expect(r.response.status).toBe(200);
  expect(
    (
      await api('/auth/session', 'GET', undefined, {
        cookie: r.response.headers.get('set-cookie')!.split(';')[0]!,
      })
    ).response.status,
  ).toBe(401);
});
it('creates pinned user chat and recovers 20 persisted turns on another device', async () => {
  const slug = 'test-user-' + randomUUID();
  const c = await h.db.category.create({ data: { slug, name: 'TEST ONLY ' + randomUUID() } });
  const p = await h.db.persona.create({
    data: {
      id: randomUUID(),
      slug,
      name: 'TEST ONLY',
      summary: 'TEST ONLY',
      background: 'TEST ONLY',
    },
  });
  const v = await h.db.personaCoreVersion.create({
    data: {
      personaId: p.id,
      versionNumber: 1,
      coreText: ' TEST ONLY ORIGINAL ',
      openingMessage: 'TEST',
      profileSnapshot: {
        name: p.name,
        slug,
        summary: p.summary,
        background: p.background,
        avatarUrl: '',
        tags: [],
        categoryIds: [c.id],
      },
      createdBy: h.adminId,
    },
  });
  await h.db.personaCategory.create({ data: { personaId: p.id, categoryId: c.id } });
  await h.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('personaverse.publication_action','publish',true)`;
    await tx.persona.update({
      where: { id: p.id },
      data: {
        draftVersionId: v.id,
        publishedVersionId: v.id,
        publishedSlug: slug,
        status: 'published',
      },
    });
  });
  persona = { id: p.id, slug, version: v.id };
  const r = await api(
    '/me/chats',
    'POST',
    { personaSlug: slug, clientRequestId: randomUUID() },
    a.s,
  );
  expect(r.response.status).toBe(200);
  chatId = r.value.id;
  for (let n = 0; n < 20; n++)
    expect(
      (
        await api(
          '/me/chats/' + chatId + '/messages',
          'POST',
          { clientMessageId: randomUUID(), content: 'TEST ' + n },
          a.s,
        )
      ).response.status,
    ).toBe(200);
  other = (await login(a.email, a.password)).s;
  expect(other.cookie).not.toBe(a.s.cookie);
  const history = await api('/me/chats', 'GET', undefined, other);
  expect(history.value.items[0].id).toBe(chatId);
  const detail = await api('/me/chats/' + chatId, 'GET', undefined, other);
  expect(detail.value.messages).toHaveLength(40);
  expect(detail.value.coreVersionId).toBe(v.id);
  expect(JSON.stringify(detail.value)).not.toContain('coreText');
});
it('isolates user reads, writes, deletes and favorites across devices', async () => {
  for (const method of ['GET', 'DELETE'])
    expect((await api('/me/chats/' + chatId, method, undefined, b.s)).response.status).toBe(404);
  expect(
    (
      await api(
        '/me/chats/' + chatId + '/messages',
        'POST',
        { clientMessageId: randomUUID(), content: 'TEST' },
        b.s,
      )
    ).response.status,
  ).toBe(404);
  expect((await api('/me/favorites/' + persona.slug, 'PUT', {}, a.s)).response.status).toBe(200);
  expect((await api('/me/favorites', 'GET', undefined, other)).value.items).toHaveLength(1);
  expect((await api('/me/favorites', 'GET', undefined, b.s)).value.items).toHaveLength(0);
});
it('uses persistent idempotency for concurrent create/send and rolls back invalid inputs', async () => {
  const key = randomUUID(),
    body = { personaSlug: persona.slug, clientRequestId: key };
  const rows = await Promise.all([
    api('/me/chats', 'POST', body, a.s),
    api('/me/chats', 'POST', body, other),
  ]);
  expect(rows.map((r) => r.response.status)).toEqual([200, 200]);
  expect(rows[0].value.id).toBe(rows[1].value.id);
  secondId = rows[0].value.id;
  expect(
    (await api('/me/chats', 'POST', { ...body, personaSlug: 'other' }, a.s)).response.status,
  ).toBe(409);
  const message = { clientMessageId: randomUUID(), content: '  ORIGINAL TEST  ' };
  const results = await Promise.all([
    api('/me/chats/' + secondId + '/messages', 'POST', message, a.s),
    api('/me/chats/' + secondId + '/messages', 'POST', message, other),
  ]);
  expect(results.every((r) => r.response.status === 200)).toBe(true);
  expect(results[0].value.messages).toHaveLength(2);
  expect(
    (
      await api(
        '/me/chats/' + secondId + '/messages',
        'POST',
        { ...message, content: 'different' },
        a.s,
      )
    ).response.status,
  ).toBe(409);
  expect(await h.db.chatMessage.count({ where: { sessionId: secondId } })).toBe(2);
});
it('retains history after unpublication and rejects new sends and paid paths', async () => {
  await h.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('personaverse.publication_action','unpublish',true)`;
    await tx.persona.update({ where: { id: persona.id }, data: { status: 'draft' } });
  });
  const r = await api('/me/chats/' + chatId, 'GET', undefined, a.s);
  expect(r.response.status).toBe(200);
  expect(r.value.canSend).toBe(false);
  expect(r.value.messages).toHaveLength(40);
  expect(
    (
      await api(
        '/me/chats/' + chatId + '/messages',
        'POST',
        { clientMessageId: randomUUID(), content: 'TEST' },
        a.s,
      )
    ).response.status,
  ).toBe(409);
  expect((await api('/me/chats/' + chatId + '/ai-requests', 'POST', {}, a.s)).response.status).toBe(
    503,
  );
});
it('rejects expired reset tokens and expires idle user sessions on Workers', async () => {
  const raw = randomBytes(32).toString('hex');
  const old = new Date(Date.now() - 2 * 86400000);
  await h.db.passwordReset.create({
    data: {
      userId: a.id,
      tokenHash: secretHash(raw),
      authVersion: 1,
      createdAt: old,
      expiresAt: new Date(old.getTime() + 60000),
      deliveredAt: old,
    },
  });
  expect(
    (await anon('reset-password', { token: raw, newPassword: randomBytes(24).toString('hex') }))
      .response.status,
  ).toBe(400);
  const stale = randomBytes(32).toString('hex');
  await h.db.userSession.create({
    data: {
      userId: a.id,
      tokenHash: secretHash(stale),
      authVersion: 1,
      createdAt: old,
      lastSeenAt: old,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  expect(
    (await api('/auth/session', 'GET', undefined, { cookie: 'pv_v2_user_local=' + stale })).response
      .status,
  ).toBe(401);
});
it('resets password through local mail and immediately revokes old devices', async () => {
  expect((await anon('forgot-password', { email: a.email })).response.status).toBe(202);
  const proof = mail(a.email, 'reset');
  const next = randomBytes(24).toString('hex');
  expect(
    (await anon('reset-password', { token: proof.token, newPassword: next })).response.status,
  ).toBe(200);
  expect((await api('/auth/session', 'GET', undefined, a.s)).response.status).toBe(401);
  expect((await api('/auth/session', 'GET', undefined, other)).response.status).toBe(401);
  expect(
    (await anon('reset-password', { token: proof.token, newPassword: next })).response.status,
  ).toBe(400);
  a.password = next;
  a.s = (await login(a.email, next)).s;
});
it('deletes private text while retaining immutable accounting and prevents access/restore', async () => {
  const request = await h.db.chatRequest.create({
    data: {
      sessionId: chatId,
      coreVersionId: persona.version,
      clientMessageId: randomUUID(),
      fingerprint: 'a'.repeat(64),
      inputText: 'TEST PRIVATE BODY',
      response: { content: 'TEST PRIVATE RESPONSE' },
      maxOutputTokens: 1,
      estimatedInputTokens: 1,
      status: 'pending',
    },
  });
  const ledger = await h.db.aiLedgerEntry.create({
    data: {
      requestId: request.id,
      kind: 'reserve',
      units: 1n,
      currency: 'CNY',
      evidence: randomUUID(),
    },
  });
  expect((await api('/me/chats/' + chatId, 'DELETE', undefined, a.s)).response.status).toBe(200);
  expect((await api('/me/chats/' + chatId, 'GET', undefined, a.s)).response.status).toBe(404);
  expect(
    (
      await api(
        '/me/chats/' + chatId + '/messages',
        'POST',
        { clientMessageId: randomUUID(), content: 'TEST' },
        a.s,
      )
    ).response.status,
  ).toBe(404);
  const r = await h.db.chatRequest.findUniqueOrThrow({ where: { id: request.id } });
  expect(r.inputText).toBe('');
  expect(r.response).toBeNull();
  expect(await h.db.chatMessage.count({ where: { sessionId: chatId } })).toBe(0);
  expect(await h.db.aiLedgerEntry.findUnique({ where: { id: ledger.id } })).not.toBeNull();
  await expect(
    h.db.chatRequest.update({ where: { id: request.id }, data: { inputText: 'restore' } }),
  ).rejects.toBeDefined();
});
it('rolls back registration on actual backend interruption and fails closed', async () => {
  await h.db.$executeRawUnsafe(
    `CREATE FUNCTION kill_user_registration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NEW; END; $$`,
  );
  await h.db.$executeRawUnsafe(
    `CREATE TRIGGER kill_user_registration BEFORE INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION kill_user_registration()`,
  );
  const email = randomUUID() + '@test.invalid';
  try {
    const r = await anon('register', { email, password: randomBytes(24).toString('hex') });
    expect(r.response.status).toBe(503);
    expect(await h.db.user.count({ where: { email } })).toBe(0);
  } finally {
    await h.db.$executeRawUnsafe('DROP TRIGGER kill_user_registration ON "User"');
    await h.db.$executeRawUnsafe('DROP FUNCTION kill_user_registration()');
  }
});
it('logs out and closes accounts without granting admin access or retaining readable profiles', async () => {
  expect((await api('/auth/logout', 'POST', {}, a.s)).response.status).toBe(200);
  expect((await api('/auth/session', 'GET', undefined, a.s)).response.status).toBe(401);
  expect((await api('/me', 'DELETE', { password: b.password }, b.s)).response.status).toBe(200);
  expect((await api('/auth/session', 'GET', undefined, b.s)).response.status).toBe(401);
  const deleted = await h.db.user.findUniqueOrThrow({ where: { id: b.id } });
  expect(deleted.status).toBe('deleted');
  expect(deleted.email).not.toBe(b.email);
  expect(deleted.displayName).toBe('');
});
