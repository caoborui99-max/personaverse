import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { harness } from './harness.ts';
import { passwordHash, secretHash } from '../../apps/api/src/auth.ts';
import {
  mockRengineProvider,
  type RengineProvider,
} from '../../apps/api/src/auth-providers/rengine.ts';
let h: Awaited<ReturnType<typeof harness>>;
const mock = mockRengineProvider();
let calls = 0,
  failProvider = false,
  delayed: Promise<void> | undefined;
const provider: RengineProvider = {
  softwareId: '1',
  start: (s) => mock.start(s),
  async verify(c) {
    calls++;
    await delayed;
    if (failProvider) throw new Error('PRIVATE_PROVIDER_FAILURE');
    return mock.verify(c);
  },
};
beforeAll(async () => {
  h = await harness({ externalProvider: provider, legacyAnonymousTestMode: false });
});
afterAll(async () => {
  await h?.close();
});
async function account(verified = true) {
  const password = randomBytes(24).toString('hex'),
    email = randomUUID() + '@test.invalid';
  const user = await h.db.user.create({
    data: {
      email,
      passwordHash: await passwordHash(password),
      emailVerifiedAt: verified ? new Date() : null,
    },
  });
  const pre = await h.app.inject('/api/v1/auth/csrf');
  const login = await h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: {
      origin: h.origin,
      cookie: String(pre.headers['set-cookie']).split(';')[0]!,
      'x-csrf-token': pre.json().csrfToken,
    },
    payload: { email, password },
  });
  if (!verified) {
    expect(login.statusCode).toBe(401);
    return { user, password, headers: { origin: h.origin, cookie: '', 'x-csrf-token': '' } };
  }
  expect(login.statusCode).toBe(200);
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const session = await h.app.inject({ url: '/api/v1/auth/session', headers: { cookie } });
  return {
    user,
    password,
    headers: { origin: h.origin, cookie, 'x-csrf-token': session.json().csrfToken },
  };
}
type Account = Awaited<ReturnType<typeof account>>;
async function start(a: Account) {
  const r = await h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/rengine/start',
    headers: a.headers,
    payload: { password: a.password },
  });
  expect(r.statusCode).toBe(200);
  const url = new URL(r.json().url, h.origin);
  return {
    state: url.searchParams.get('state')!,
    cookie: String(r.headers['set-cookie']).split(';')[0]!,
  };
}
async function finish(
  a: Account,
  t: Awaited<ReturnType<typeof start>>,
  code = 'mock-' + randomUUID(),
  headers: Record<string, string> = {},
) {
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/rengine/finalize',
    headers: { ...a.headers, cookie: a.headers.cookie + '; ' + t.cookie, ...headers },
    payload: { state: t.state, code },
  });
}
it('feature disabled by default, anonymous/forged identities denied and unverified local login refused', async () => {
  const off = await harness({ legacyAnonymousTestMode: false });
  try {
    expect(
      (
        await off.app.inject({
          method: 'POST',
          url: '/api/v1/auth/rengine/start',
          headers: { origin: off.origin },
          payload: { password: 'test' },
        })
      ).statusCode,
    ).toBe(503);
  } finally {
    await off.close();
  }
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/rengine/start',
        headers: { origin: h.origin, 'x-user-id': randomUUID() },
        payload: { password: 'test' },
      })
    ).statusCode,
  ).toBe(401);
  await account(false);
});
it('requires origin, CSRF and password reconfirmation', async () => {
  const a = await account();
  for (const [headers, password, status] of [
    [{ ...a.headers, origin: 'https://attacker.invalid' }, a.password, 403],
    [{ ...a.headers, 'x-csrf-token': 'bad' }, a.password, 403],
    [a.headers, 'wrong', 401],
  ] as const) {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/rengine/start',
      headers,
      payload: { password },
    });
    expect(r.statusCode).toBe(status);
  }
});
it('single-use successful binding preserves internal identity, favorites, sessions and immutable ledger', async () => {
  const a = await account(),
    t = await start(a),
    code = 'mock-' + randomUUID();
  const before = {
    chats: await h.db.chatSession.count(),
    favorites: await h.db.userFavorite.count(),
    ledger: await h.db.aiLedgerEntry.count(),
    users: await h.db.user.count(),
  };
  const r = await finish(a, t, code);
  expect(r.statusCode).toBe(200);
  expect(r.headers['set-cookie']).toHaveLength(2);
  expect(
    await h.db.externalIdentity.findFirstOrThrow({ where: { userId: a.user.id } }),
  ).toMatchObject({ subject: code, userId: a.user.id });
  expect({
    chats: await h.db.chatSession.count(),
    favorites: await h.db.userFavorite.count(),
    ledger: await h.db.aiLedgerEntry.count(),
    users: await h.db.user.count(),
  }).toEqual(before);
  expect(
    (await h.app.inject({ url: '/api/v1/auth/session', headers: a.headers })).json().user.id,
  ).toBe(a.user.id);
  expect((await finish(a, t, code)).statusCode).toBe(409);
  const stored = await h.db.externalAuthTransaction.findUniqueOrThrow({
    where: { stateHash: secretHash(t.state) },
  });
  expect(stored.stateHash).not.toBe(t.state);
  expect(stored.status).toBe('complete');
});
it('same identity binding is idempotent for owner; cross-account duplicate never merges or changes owner', async () => {
  const a = await account(),
    b = await account(),
    code = 'mock-' + randomUUID();
  expect((await finish(a, await start(a), code)).statusCode).toBe(200);
  expect((await finish(a, await start(a), code)).statusCode).toBe(200);
  expect((await finish(b, await start(b), code)).statusCode).toBe(409);
  expect((await h.db.externalIdentity.findFirstOrThrow({ where: { subject: code } })).userId).toBe(
    a.user.id,
  );
});
it('missing, duplicate and wrong browser cookies and cross-account state substitution are rejected before provider', async () => {
  const a = await account(),
    b = await account(),
    t = await start(a),
    before = calls;
  expect((await finish(a, t, undefined, { cookie: a.headers.cookie })).statusCode).toBe(403);
  expect(
    (
      await finish(a, t, undefined, {
        cookie: a.headers.cookie + '; ' + t.cookie + '; ' + t.cookie,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await finish(a, { ...t, cookie: 'pv_rengine_flow_local=' + randomBytes(32).toString('hex') }))
      .statusCode,
  ).toBe(409);
  expect((await finish(b, t)).statusCode).toBe(409);
  expect(calls).toBe(before);
});
it('claims concurrent callbacks exactly once; duplicate cannot call provider twice', async () => {
  const a = await account(),
    t = await start(a);
  let release!: () => void;
  delayed = new Promise<void>((r) => {
    release = r;
  });
  const before = calls;
  const first = finish(a, t);
  await expect.poll(() => calls).toBe(before + 1);
  const second = await finish(a, t);
  expect(second.statusCode).toBe(409);
  release();
  expect((await first).statusCode).toBe(200);
  delayed = undefined;
  expect(calls).toBe(before + 1);
});
it('provider unknown failure is terminal, sanitized and never blindly retried', async () => {
  const a = await account(),
    t = await start(a);
  failProvider = true;
  const before = calls;
  try {
    const r = await finish(a, t);
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain('PRIVATE_PROVIDER_FAILURE');
    expect((await finish(a, t)).statusCode).toBe(409);
    expect(calls).toBe(before + 1);
  } finally {
    failProvider = false;
  }
});
it('session revocation during provider exchange rolls back binding and leaves a failed transaction', async () => {
  const a = await account(),
    t = await start(a);
  let release!: () => void;
  delayed = new Promise<void>((r) => {
    release = r;
  });
  const before = calls;
  const pending = finish(a, t);
  await expect.poll(() => calls).toBe(before + 1);
  await h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: a.headers,
    payload: {},
  });
  release();
  expect((await pending).statusCode).toBe(401);
  delayed = undefined;
  expect(await h.db.externalIdentity.count({ where: { userId: a.user.id } })).toBe(0);
});
it('database enforces ownership foreign keys, immutable identities and terminal transaction states', async () => {
  const a = await account(),
    b = await account(),
    t = await start(a);
  await finish(a, t);
  const identity = await h.db.externalIdentity.findFirstOrThrow({ where: { userId: a.user.id } });
  await expect(
    h.db.externalIdentity.update({ where: { id: identity.id }, data: { userId: b.user.id } }),
  ).rejects.toThrow();
  const transaction = await h.db.externalAuthTransaction.findUniqueOrThrow({
    where: { stateHash: secretHash(t.state) },
  });
  await expect(
    h.db.externalAuthTransaction.update({
      where: { id: transaction.id },
      data: { status: 'pending' },
    }),
  ).rejects.toThrow();
  await expect(
    h.db.externalAuthTransaction.create({
      data: {
        userId: b.user.id,
        sessionId: transaction.sessionId,
        authVersion: 1,
        softwareId: '1',
        stateHash: secretHash(randomUUID()),
        browserHash: secretHash(randomUUID()),
        expiresAt: new Date(Date.now() + 60000),
      },
    }),
  ).rejects.toThrow();
});
it('expired authorization cannot dispatch provider', async () => {
  const a = await account(),
    t = await start(a),
    before = calls;
  h.advance(181000);
  expect((await finish(a, t)).statusCode).toBe(409);
  expect(calls).toBe(before);
});
