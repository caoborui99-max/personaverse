import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { harness } from './harness.ts';
import { buildDatabaseApp } from '../../apps/api/src/database-app.ts';
import { secretHash } from '../../apps/api/src/auth.ts';

type Mail = { to: string; purpose: 'verify' | 'reset'; token: string };
const mail = {
  messages: [] as Mail[],
  async send(value: Mail) {
    this.messages.push({ ...value });
  },
};
let h: Awaited<ReturnType<typeof harness>>;
type Headers = { origin: string; cookie: string; 'x-csrf-token': string };
const password = () => randomBytes(24).toString('hex');
const address = () => randomUUID() + '@test.invalid';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function token(to: string, purpose: Mail['purpose']) {
  const value = [...mail.messages]
    .reverse()
    .find((item) => item.to === to && item.purpose === purpose);
  if (!value) throw new Error('Expected private synthetic mail missing');
  return value.token;
}
async function anonymous(
  path: string,
  payload: Record<string, unknown>,
  extra: Record<string, string> = {},
) {
  const pre = await h.app.inject('/api/v1/auth/csrf');
  expect(pre.statusCode).toBe(200);
  return h.app.inject({
    method: 'POST',
    url: '/api/v1' + path,
    payload,
    headers: {
      origin: h.origin,
      cookie: String(pre.headers['set-cookie']).split(';')[0]!,
      'x-csrf-token': pre.json().csrfToken,
      ...extra,
    },
  });
}
async function register(email = address(), secret = password()) {
  const result = await anonymous('/auth/register', {
    email,
    password: secret,
    displayName: 'TEST ONLY',
  });
  expect(result.statusCode).toBe(202);
  return { email: email.trim().toLowerCase(), password: secret };
}
async function login(account: { email: string; password: string }) {
  const result = await anonymous('/auth/login', {
    email: account.email,
    password: account.password,
  });
  expect(result.statusCode).toBe(200);
  const cookie = String(result.headers['set-cookie']).split(';')[0]!;
  const session = await h.app.inject({ url: '/api/v1/auth/session', headers: { cookie } });
  expect(session.statusCode).toBe(200);
  return {
    result,
    session,
    user: session.json().user,
    headers: { origin: h.origin, cookie, 'x-csrf-token': session.json().csrfToken } as Headers,
  };
}
async function verified() {
  const account = await register();
  expect(
    (await anonymous('/auth/verify', { token: token(account.email, 'verify') })).statusCode,
  ).toBe(200);
  return { ...account, ...(await login(account)) };
}
async function published() {
  // A disposable TEST ONLY fixture, never seeded into production or reused as formal persona content.
  const slug = 'test-user-' + randomUUID();
  const category = await h.db.category.create({
    data: { slug, name: 'TEST ONLY ' + randomUUID() },
  });
  const profile = {
    slug,
    name: 'TEST ONLY USER HISTORY',
    summary: 'TEST ONLY',
    background: 'TEST ONLY',
    avatarUrl: '',
    tags: ['TEST'],
    categoryIds: [category.id],
  };
  const p = await h.db.persona.create({
    data: {
      id: randomUUID(),
      slug,
      name: profile.name,
      summary: profile.summary,
      background: profile.background,
      tags: profile.tags,
    },
  });
  const version = await h.db.personaCoreVersion.create({
    data: {
      personaId: p.id,
      versionNumber: 1,
      coreText: '  TEST ONLY SOURCE\n ',
      openingMessage: 'TEST ONLY OPEN',
      profileSnapshot: profile,
      createdBy: h.admin.id,
    },
  });
  await h.db.personaCategory.create({ data: { personaId: p.id, categoryId: category.id } });
  await h.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('personaverse.publication_action','publish',true)`;
    await tx.persona.update({
      where: { id: p.id },
      data: {
        draftVersionId: version.id,
        publishedVersionId: version.id,
        publishedSlug: slug,
        status: 'published',
      },
    });
  });
  return { ...p, coreVersionId: version.id };
}
async function chat(headers: Headers, slug: string, clientRequestId = randomUUID()) {
  const result = await h.app.inject({
    method: 'POST',
    url: '/api/v1/me/chats',
    headers,
    payload: { personaSlug: slug, clientRequestId },
  });
  expect(result.statusCode).toBe(200);
  return result.json();
}
async function send(
  headers: Headers,
  id: string,
  content = 'TEST PRIVATE MESSAGE',
  clientMessageId = randomUUID(),
) {
  return h.app.inject({
    method: 'POST',
    url: `/api/v1/me/chats/${id}/messages`,
    headers,
    payload: { clientMessageId, content },
  });
}
beforeAll(async () => {
  h = await harness({ mailSender: mail, legacyAnonymousTestMode: false });
}, 30000);
beforeEach(() => {
  h.advance(2 * 3600000);
  mail.messages.length = 0;
});
afterAll(async () => {
  await h?.close();
});

it('registers normalized email, requires verification and confirms a real independent user session', async () => {
  const email = address(),
    secret = password();
  const account = await register('  ' + email.toUpperCase() + '  ', secret);
  const row = await h.db.user.findUniqueOrThrow({ where: { email } });
  expect(row.emailVerifiedAt).toBeNull();
  expect(row.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  expect((await anonymous('/auth/login', account)).statusCode).toBe(401);
  const raw = token(email, 'verify');
  const verification = await h.db.emailVerification.findFirstOrThrow({ where: { userId: row.id } });
  expect(verification.tokenHash).toBe(secretHash(raw));
  expect(verification.tokenHash).not.toBe(raw);
  expect((await anonymous('/auth/verify', { token: raw })).statusCode).toBe(200);
  const signed = await login(account);
  expect(signed.user.id).toBe(row.id);
  const cookie = String(signed.result.headers['set-cookie']);
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Strict');
  expect(cookie).not.toMatch(/Domain=|Secure/i);
  const sessionRaw = signed.headers.cookie.split('=')[1]!;
  const session = await h.db.userSession.findUniqueOrThrow({
    where: { tokenHash: secretHash(sessionRaw) },
  });
  expect(session.userId).toBe(row.id);
  expect(session.tokenHash).not.toBe(sessionRaw);
});
it('uses generic registration/forgot responses and does not replace an existing account password', async () => {
  const account = await register();
  const original = (await h.db.user.findUniqueOrThrow({ where: { email: account.email } }))
    .passwordHash;
  const duplicate = await anonymous('/auth/register', {
    email: account.email,
    password: password(),
  });
  const fresh = await anonymous('/auth/register', { email: address(), password: password() });
  expect(duplicate.statusCode).toBe(202);
  expect(duplicate.json()).toEqual(fresh.json());
  expect(
    (await h.db.user.findUniqueOrThrow({ where: { email: account.email } })).passwordHash,
  ).toBe(original);
  const known = await anonymous('/auth/forgot-password', { email: account.email });
  const unknown = await anonymous('/auth/forgot-password', { email: address() });
  expect(known.statusCode).toBe(202);
  expect(known.json()).toEqual(unknown.json());
});
it('rejects missing login CSRF, cross-site registration and missing user write CSRF', async () => {
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { origin: h.origin },
        payload: { email: address(), password: password() },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await anonymous(
        '/auth/register',
        { email: address(), password: password() },
        { origin: 'https://attacker.invalid' },
      )
    ).statusCode,
  ).toBe(403);
  const a = await verified();
  expect(
    (
      await h.app.inject({
        method: 'PUT',
        url: '/api/v1/me',
        headers: { ...a.headers, 'x-csrf-token': 'wrong' },
        payload: { displayName: 'TEST' },
      })
    ).statusCode,
  ).toBe(403);
});
it('verification is single-use and concurrent consumers cannot both succeed', async () => {
  const a = await register(),
    raw = token(a.email, 'verify');
  const results = await Promise.all([
    anonymous('/auth/verify', { token: raw }),
    anonymous('/auth/verify', { token: raw }),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
  expect((await anonymous('/auth/verify', { token: raw })).json().error.code).toBe('TOKEN_INVALID');
});
it('rejects expired verification and reset tokens without changing the account', async () => {
  const unverified = await register();
  const raw = token(unverified.email, 'verify');
  h.advance(31 * 60000);
  expect((await anonymous('/auth/verify', { token: raw })).statusCode).toBe(400);
  expect(
    (await h.db.user.findUniqueOrThrow({ where: { email: unverified.email } })).emailVerifiedAt,
  ).toBeNull();
  const a = await verified();
  await anonymous('/auth/forgot-password', { email: a.email });
  const reset = token(a.email, 'reset');
  h.advance(16 * 60000);
  expect(
    (await anonymous('/auth/reset-password', { token: reset, newPassword: password() })).statusCode,
  ).toBe(400);
  expect(
    (await anonymous('/auth/login', { email: a.email, password: a.password })).statusCode,
  ).toBe(200);
});
it('password reset changes the PHC, revokes every old session and consumes only a digest', async () => {
  const a = await verified(),
    second = await login(a);
  await anonymous('/auth/forgot-password', { email: a.email });
  const raw = token(a.email, 'reset'),
    next = password();
  const row = await h.db.passwordReset.findFirstOrThrow({ where: { userId: a.user.id } });
  expect(row.tokenHash).toBe(secretHash(raw));
  expect(
    (await anonymous('/auth/reset-password', { token: raw, newPassword: next })).statusCode,
  ).toBe(200);
  for (const headers of [a.headers, second.headers])
    expect((await h.app.inject({ url: '/api/v1/auth/session', headers })).statusCode).toBe(401);
  expect(
    (await anonymous('/auth/reset-password', { token: raw, newPassword: password() })).statusCode,
  ).toBe(400);
  expect(
    (await anonymous('/auth/login', { email: a.email, password: a.password })).statusCode,
  ).toBe(401);
  expect((await login({ email: a.email, password: next })).user.id).toBe(a.user.id);
});
it('logout revokes the opaque server session and leaves no authority in the old Cookie', async () => {
  const a = await verified();
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: a.headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect((await h.app.inject({ url: '/api/v1/auth/session', headers: a.headers })).statusCode).toBe(
    401,
  );
});
it('enforces independent absolute and idle user session expiration', async () => {
  const a = await verified();
  h.advance(24 * 3600000 + 1);
  expect((await h.app.inject({ url: '/api/v1/auth/session', headers: a.headers })).statusCode).toBe(
    401,
  );
  const fresh = await login(a);
  h.advance(8 * 86400000);
  expect(
    (await h.app.inject({ url: '/api/v1/auth/session', headers: fresh.headers })).statusCode,
  ).toBe(401);
});
it('separates administrators and users even when attacker supplies role headers', async () => {
  const a = await verified(),
    admin = await h.login();
  expect(
    (
      await h.app.inject({
        url: '/api/v1/admin/personas',
        headers: { ...a.headers, 'x-admin': 'true' },
      })
    ).statusCode,
  ).toBe(401);
  expect((await h.app.inject({ url: '/api/v1/me/chats', headers: admin.headers })).statusCode).toBe(
    401,
  );
  expect(
    (
      await h.app.inject({
        url: '/api/v1/me/chats',
        headers: { cookie: 'user=true; admin=true', authorization: 'Bearer owner' },
      })
    ).statusCode,
  ).toBe(401);
});
it('persists login and registration abuse limits before unlimited password hashing or mailbox delivery', async () => {
  const email = address();
  for (let n = 0; n < 10; n++)
    expect((await anonymous('/auth/login', { email, password: 'wrong' })).statusCode).toBe(401);
  expect((await anonymous('/auth/login', { email, password: 'wrong' })).statusCode).toBe(429);
  h.advance(2 * 3600000);
  const signup = address();
  for (let n = 0; n < 5; n++)
    expect(
      (await anonymous('/auth/register', { email: signup, password: password() })).statusCode,
    ).toBe(202);
  expect(
    (await anonymous('/auth/register', { email: signup, password: password() })).statusCode,
  ).toBe(429);
});
it('reports database failure without authenticating or trusting a previously valid user Cookie', async () => {
  const a = await verified();
  const url = new URL(process.env.DATABASE_URL!);
  url.port = '1';
  url.searchParams.set('connect_timeout', '1');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const app = buildDatabaseApp({
    db,
    config: { environment: 'test', databaseUrl: url.toString(), origin: h.origin, secure: false },
    mailSender: mail,
  });
  try {
    expect((await app.inject({ url: '/api/v1/auth/session', headers: a.headers })).statusCode).toBe(
      503,
    );
  } finally {
    await app.close();
  }
});
it('refuses mail-dependent authentication when no local sender was configured', async () => {
  const app = buildDatabaseApp({
    db: h.db,
    config: {
      environment: 'test',
      databaseUrl: process.env.DATABASE_URL!,
      origin: h.origin,
      secure: false,
    },
  });
  await app.ready();
  // Closing the secondary app disconnects the shared client; Prisma reconnects for later cases.
  try {
    const pre = await app.inject('/api/v1/auth/csrf');
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: {
        origin: h.origin,
        cookie: String(pre.headers['set-cookie']).split(';')[0]!,
        'x-csrf-token': pre.json().csrfToken,
      },
      payload: { email: address(), password: password() },
    });
    expect(r.statusCode).toBe(503);
  } finally {
    await app.close();
  }
});
it('rolls back registration if verification token persistence fails', async () => {
  const email = address();
  await h.db.$executeRawUnsafe(
    `CREATE FUNCTION fail_test_user_token() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST ONLY rollback' USING ERRCODE='23514'; END; $$`,
  );
  await h.db.$executeRawUnsafe(
    `CREATE TRIGGER fail_test_user_token BEFORE INSERT ON "EmailVerification" FOR EACH ROW EXECUTE FUNCTION fail_test_user_token()`,
  );
  try {
    const r = await anonymous('/auth/register', { email, password: password() });
    expect([409, 503]).toContain(r.statusCode);
    expect(await h.db.user.count({ where: { email } })).toBe(0);
    expect(mail.messages.some((m) => m.to === email)).toBe(false);
  } finally {
    await h.db.$executeRawUnsafe('DROP TRIGGER fail_test_user_token ON "EmailVerification"');
    await h.db.$executeRawUnsafe('DROP FUNCTION fail_test_user_token()');
  }
});
it('requires a real user for new chats and never claims a legacy anonymous conversation', async () => {
  const p = await published();
  const visitor = await h.db.visitorSession.create({
    data: { tokenHash: secretHash(randomUUID()), expiresAt: new Date(Date.now() + 86400000) },
  });
  const old = await h.db.chatSession.create({
    data: { personaId: p.id, coreVersionId: p.coreVersionId, visitorId: visitor.id },
  });
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/chat/sessions',
        headers: { origin: h.origin },
        payload: { personaSlug: p.slug },
      })
    ).statusCode,
  ).toBe(401);
  const a = await verified();
  expect(
    (await h.app.inject({ url: '/api/v1/me/chats/' + old.id, headers: a.headers })).statusCode,
  ).toBe(404);
  await expect(
    h.db.chatSession.update({
      where: { id: old.id },
      data: { visitorId: null, userId: a.user.id },
    }),
  ).rejects.toBeDefined();
});
it('restores private messages after logout and second-device login, with stable creation/message idempotency', async () => {
  const a = await verified(),
    p = await published(),
    createKey = randomUUID();
  const results = await Promise.all([
    chat(a.headers, p.slug, createKey),
    chat(a.headers, p.slug, createKey),
  ]);
  expect(results[0].id).toBe(results[1].id);
  const id = results[0].id,
    messageKey = randomUUID();
  const first = await send(a.headers, id, 'TEST PRIVATE ORIGINAL', messageKey);
  expect(first.statusCode).toBe(200);
  expect((await send(a.headers, id, 'TEST PRIVATE ORIGINAL', messageKey)).statusCode).toBe(200);
  expect((await send(a.headers, id, 'DIFFERENT CONTENT', messageKey)).statusCode).toBe(409);
  await h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: a.headers,
    payload: {},
  });
  const device = await login(a);
  const list = await h.app.inject({
    url: '/api/v1/me/chats?page=1&limit=1',
    headers: device.headers,
  });
  expect(list.statusCode).toBe(200);
  expect(list.json().items[0].id).toBe(id);
  expect(list.json().total).toBe(1);
  const history = await h.app.inject({ url: '/api/v1/me/chats/' + id, headers: device.headers });
  expect(history.statusCode).toBe(200);
  expect(history.json().messages.filter((m: { role: string }) => m.role === 'user')).toHaveLength(
    1,
  );
  expect(
    history.json().messages.some((m: { content: string }) => m.content === 'TEST PRIVATE ORIGINAL'),
  ).toBe(true);
  expect((await send(device.headers, id, 'TEST SECOND DEVICE')).statusCode).toBe(200);
});
it('isolates two users for every chat read, write, deletion, listing and AI endpoint', async () => {
  const a = await verified(),
    b = await verified(),
    p = await published(),
    c = await chat(a.headers, p.slug);
  for (const [method, suffix, payload] of [
    ['GET', '', undefined],
    ['POST', '/messages', { clientMessageId: randomUUID(), content: 'TEST' }],
    ['DELETE', '', undefined],
    [
      'POST',
      '/ai-requests',
      { clientMessageId: randomUUID(), content: 'TEST', maxOutputTokens: 10 },
    ],
  ] as const) {
    expect(
      (
        await h.app.inject({
          method,
          url: '/api/v1/me/chats/' + c.id + suffix,
          headers: b.headers,
          payload,
        })
      ).statusCode,
    ).toBe(404);
  }
  expect(
    (await h.app.inject({ url: '/api/v1/me/chats', headers: b.headers })).json().items,
  ).toHaveLength(0);
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/me/chats/' + c.id + '/ai-requests',
        headers: a.headers,
        payload: { clientMessageId: randomUUID(), content: 'TEST', maxOutputTokens: 10 },
      })
    ).statusCode,
  ).toBe(503);
});
it('retains history when a persona is unpublished but refuses new sends and new chat creation', async () => {
  const a = await verified(),
    p = await published(),
    c = await chat(a.headers, p.slug);
  expect((await send(a.headers, c.id)).statusCode).toBe(200);
  await h.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('personaverse.publication_action','unpublish',true)`;
    await tx.persona.update({ where: { id: p.id }, data: { status: 'draft' } });
  });
  const history = await h.app.inject({ url: '/api/v1/me/chats/' + c.id, headers: a.headers });
  expect(history.statusCode).toBe(200);
  expect(history.json().canSend).toBe(false);
  expect(history.json().messages.length).toBeGreaterThan(0);
  expect((await send(a.headers, c.id)).statusCode).toBe(409);
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/me/chats',
        headers: a.headers,
        payload: { personaSlug: p.slug, clientRequestId: randomUUID() },
      })
    ).statusCode,
  ).toBe(404);
});
it('persists individual favorites across device sessions without sharing between users', async () => {
  const a = await verified(),
    b = await verified(),
    p = await published();
  expect(
    (
      await h.app.inject({
        method: 'PUT',
        url: '/api/v1/me/favorites/' + p.slug,
        headers: a.headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  const device = await login(a);
  expect(
    (await h.app.inject({ url: '/api/v1/me/favorites/' + p.slug, headers: device.headers })).json()
      .saved,
  ).toBe(true);
  expect(
    (await h.app.inject({ url: '/api/v1/me/favorites/' + p.slug, headers: b.headers })).json()
      .saved,
  ).toBe(false);
  expect(
    (
      await h.app.inject({ url: '/api/v1/me/favorites?page=1&limit=1', headers: device.headers })
    ).json().items[0].slug,
  ).toBe(p.slug);
  expect(
    (
      await h.app.inject({
        method: 'DELETE',
        url: '/api/v1/me/favorites/' + p.slug,
        headers: device.headers,
      })
    ).statusCode,
  ).toBe(200);
});
it('deletes private chat content while keeping immutable minimal financial evidence and fixed ownership', async () => {
  const a = await verified(),
    p = await published(),
    c = await chat(a.headers, p.slug);
  expect((await send(a.headers, c.id)).statusCode).toBe(200);
  const request = await h.db.chatRequest.create({
    data: {
      sessionId: c.id,
      coreVersionId: p.coreVersionId,
      clientMessageId: randomUUID(),
      fingerprint: digest('TEST REQUEST'),
      inputText: 'TEST PRIVATE REQUEST',
      response: { content: 'TEST PRIVATE RESPONSE' },
      maxOutputTokens: 10,
      estimatedInputTokens: 10,
      status: 'pending',
    },
  });
  const ledger = await h.db.aiLedgerEntry.create({
    data: {
      requestId: request.id,
      kind: 'reserve',
      units: 1n,
      currency: 'CNY',
      evidence: digest(randomUUID()),
    },
  });
  expect(
    (await h.app.inject({ method: 'DELETE', url: '/api/v1/me/chats/' + c.id, headers: a.headers }))
      .statusCode,
  ).toBe(200);
  expect(
    (await h.app.inject({ url: '/api/v1/me/chats/' + c.id, headers: a.headers })).statusCode,
  ).toBe(404);
  expect((await send(a.headers, c.id)).statusCode).toBe(404);
  expect(await h.db.chatMessage.count({ where: { sessionId: c.id } })).toBe(0);
  const erased = await h.db.chatRequest.findUniqueOrThrow({ where: { id: request.id } });
  expect(erased.inputText).toBe('');
  expect(erased.response).toBeNull();
  expect((await h.db.aiLedgerEntry.findUniqueOrThrow({ where: { id: ledger.id } })).units).toBe(1n);
  await expect(
    h.db.aiLedgerEntry.update({ where: { id: ledger.id }, data: { units: 0n } }),
  ).rejects.toBeDefined();
  await expect(
    h.db.chatRequest.update({
      where: { id: request.id },
      data: { inputText: 'RESTORED PRIVATE CONTENT' },
    }),
  ).rejects.toBeDefined();
  expect((await h.db.chatSession.findUniqueOrThrow({ where: { id: c.id } })).userId).toBe(
    a.user.id,
  );
  await expect(
    h.db.chatSession.update({ where: { id: c.id }, data: { userId: randomUUID() } }),
  ).rejects.toBeDefined();
});
it('rolls back privacy deletion completely when physical message purge fails', async () => {
  const a = await verified(),
    p = await published(),
    c = await chat(a.headers, p.slug);
  await send(a.headers, c.id);
  await h.db.$executeRawUnsafe(
    `CREATE FUNCTION fail_test_user_erase() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST ONLY rollback' USING ERRCODE='23514'; END; $$`,
  );
  await h.db.$executeRawUnsafe(
    `CREATE TRIGGER fail_test_user_erase BEFORE DELETE ON "ChatMessage" FOR EACH ROW EXECUTE FUNCTION fail_test_user_erase()`,
  );
  try {
    const r = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/me/chats/' + c.id,
      headers: a.headers,
    });
    expect([409, 503]).toContain(r.statusCode);
    expect(
      (await h.db.chatSession.findUniqueOrThrow({ where: { id: c.id } })).deletedAt,
    ).toBeNull();
    expect(
      (await h.app.inject({ url: '/api/v1/me/chats/' + c.id, headers: a.headers })).statusCode,
    ).toBe(200);
    expect(await h.db.chatMessage.count({ where: { sessionId: c.id } })).toBeGreaterThan(0);
  } finally {
    await h.db.$executeRawUnsafe('DROP TRIGGER fail_test_user_erase ON "ChatMessage"');
    await h.db.$executeRawUnsafe('DROP FUNCTION fail_test_user_erase()');
  }
});
it('updates only the user profile whitelist and unregisters with private data erased and sessions revoked', async () => {
  const a = await verified(),
    otherDevice = await login(a),
    p = await published(),
    c = await chat(a.headers, p.slug);
  await send(a.headers, c.id);
  expect(
    (
      await h.app.inject({
        method: 'PUT',
        url: '/api/v1/me',
        headers: a.headers,
        payload: { displayName: 'TEST PROFILE' },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await h.app.inject({
        method: 'PUT',
        url: '/api/v1/me',
        headers: a.headers,
        payload: { displayName: 'TEST', role: 'owner' },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await h.app.inject({
        method: 'DELETE',
        url: '/api/v1/me',
        headers: a.headers,
        payload: { password: a.password },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await h.app.inject({ url: '/api/v1/auth/session', headers: otherDevice.headers })).statusCode,
  ).toBe(401);
  expect(
    (await anonymous('/auth/login', { email: a.email, password: a.password })).statusCode,
  ).toBe(401);
  const user = await h.db.user.findUniqueOrThrow({ where: { id: a.user.id } });
  expect(user.status).toBe('deleted');
  expect(user.email).not.toBe(a.email);
  expect(user.displayName).toBe('');
  expect(await h.db.chatMessage.count({ where: { sessionId: c.id } })).toBe(0);
});
it('rejects reset-token account substitution without changing another user credentials', async () => {
  const a = await verified(),
    b = await verified();
  await anonymous('/auth/forgot-password', { email: a.email });
  const raw = token(a.email, 'reset'),
    next = password();
  const substitution = await anonymous('/auth/reset-password', {
    token: raw,
    newPassword: next,
    userId: b.user.id,
  });
  expect(substitution.statusCode).toBe(400);
  expect(
    (await anonymous('/auth/reset-password', { token: raw, newPassword: next })).statusCode,
  ).toBe(200);
  expect((await login({ email: a.email, password: next })).user.id).toBe(a.user.id);
  expect((await login(b)).user.id).toBe(b.user.id);
});
it('enforces exactly one existing owner, matching persona version and irreversible deletion in PostgreSQL', async () => {
  const a = await verified(),
    p = await published(),
    q = await published();
  for (const data of [
    { personaId: p.id, coreVersionId: p.coreVersionId },
    { personaId: p.id, coreVersionId: p.coreVersionId, userId: a.user.id, adminId: h.admin.id },
    { personaId: p.id, coreVersionId: p.coreVersionId, userId: randomUUID() },
    { personaId: p.id, coreVersionId: q.coreVersionId, userId: a.user.id },
  ])
    await expect(h.db.chatSession.create({ data })).rejects.toBeDefined();
  const c = await chat(a.headers, p.slug);
  expect(
    (await h.app.inject({ method: 'DELETE', url: '/api/v1/me/chats/' + c.id, headers: a.headers }))
      .statusCode,
  ).toBe(200);
  await expect(
    h.db.chatSession.update({ where: { id: c.id }, data: { status: 'active', deletedAt: null } }),
  ).rejects.toBeDefined();
  await expect(
    h.db.chatMessage.create({
      data: {
        sessionId: c.id,
        sequence: 1,
        role: 'user',
        content: 'RESTORED TEST CONTENT',
        clientMessageId: randomUUID(),
      },
    }),
  ).rejects.toBeDefined();
});
it('accepts mail requests without enumeration or activating undelivered tokens when the local sender fails', async () => {
  const captured: Mail[] = [];
  const app = buildDatabaseApp({
    db: h.db,
    config: {
      environment: 'test',
      databaseUrl: process.env.DATABASE_URL!,
      origin: h.origin,
      secure: false,
    },
    mailSender: {
      async send(message: Mail) {
        captured.push({ ...message });
        throw new Error('TEST_ONLY_DELIVERY_FAILURE');
      },
    },
  });
  await app.ready();
  async function post(path: string, payload: Record<string, unknown>) {
    const pre = await app.inject('/api/v1/auth/csrf');
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/' + path,
      payload,
      headers: {
        origin: h.origin,
        cookie: String(pre.headers['set-cookie']).split(';')[0]!,
        'x-csrf-token': pre.json().csrfToken,
      },
    });
  }
  try {
    const email = address();
    const registered = await post('register', { email, password: password() });
    const unknown = await post('forgot-password', { email: address() });
    const known = await post('forgot-password', { email });
    for (const response of [registered, known, unknown]) expect(response.statusCode).toBe(202);
    expect(registered.json()).toEqual(unknown.json());
    expect(known.json()).toEqual(unknown.json());
    expect(captured).toHaveLength(2);
    const verification = captured.find((message) => message.purpose === 'verify')!;
    const reset = captured.find((message) => message.purpose === 'reset')!;
    expect((await post('verify', { token: verification.token })).statusCode).toBe(400);
    expect(
      (await post('reset-password', { token: reset.token, newPassword: password() })).statusCode,
    ).toBe(400);
    const user = await h.db.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).toBeNull();
    const proof = await h.db.emailVerification.findFirstOrThrow({ where: { userId: user.id } });
    expect(proof.revokedAt !== null || proof.deliveredAt === null).toBe(true);
    const resetProof = await h.db.passwordReset.findFirstOrThrow({ where: { userId: user.id } });
    expect(resetProof.revokedAt !== null || resetProof.deliveredAt === null).toBe(true);
  } finally {
    await app.close();
  }
});
