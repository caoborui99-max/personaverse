import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { workersHarness } from './harness.ts';
import { passwordHash, secretHash } from '../../apps/api/src/auth.ts';
let h: Awaited<ReturnType<typeof workersHarness>>;
const origin = 'http://127.0.0.1:4320';
beforeAll(async () => {
  h = await workersHarness({ externalMock: true, legacyAnonymousTestMode: false });
}, 120000);
afterAll(async () => {
  await h?.close();
});
async function account() {
  const raw = randomBytes(32).toString('hex'),
    password = randomBytes(24).toString('hex');
  const user = await h.db.user.create({
    data: {
      email: randomUUID() + '@test.invalid',
      passwordHash: await passwordHash(password),
      emailVerifiedAt: new Date(),
    },
  });
  await h.db.userSession.create({
    data: { userId: user.id, tokenHash: secretHash(raw), expiresAt: new Date(Date.now() + 60000) },
  });
  return {
    password,
    user,
    headers: {
      origin,
      'content-type': 'application/json',
      cookie: 'pv_v2_user_local=' + raw,
      'x-csrf-token': secretHash('user-session-csrf:' + raw),
    },
  };
}
async function start(a: Awaited<ReturnType<typeof account>>) {
  const r = await fetch(origin + '/api/v1/auth/rengine/start', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ password: a.password }),
  });
  expect(r.status).toBe(200);
  const data = await r.json();
  const url = new URL(data.url, origin);
  return {
    state: url.searchParams.get('state'),
    cookie: r.headers.getSetCookie()[0]!.split(';')[0]!,
  };
}
async function finish(
  a: Awaited<ReturnType<typeof account>>,
  t: Awaited<ReturnType<typeof start>>,
  code = 'mock-' + randomUUID(),
) {
  return fetch(origin + '/api/v1/auth/rengine/finalize', {
    method: 'POST',
    headers: { ...a.headers, cookie: a.headers.cookie + '; ' + t.cookie },
    body: JSON.stringify({ state: t.state, code }),
  });
}
it('Worker binding verifies PHC, preserves both cookie clears and the original local session', async () => {
  const a = await account(),
    t = await start(a);
  const r = await finish(a, t);
  expect(r.status).toBe(200);
  expect(r.headers.getSetCookie()).toHaveLength(2);
  expect(
    r.headers
      .getSetCookie()
      .every(
        (c) => c.includes('Max-Age=0') && c.includes('HttpOnly') && c.includes('SameSite=Strict'),
      ),
  ).toBe(true);
  expect(
    (await h.db.externalIdentity.findFirstOrThrow({ where: { userId: a.user.id } })).userId,
  ).toBe(a.user.id);
  expect((await fetch(origin + '/api/v1/auth/session', { headers: a.headers })).status).toBe(200);
  expect((await finish(a, t)).status).toBe(409);
});
it('Worker rejects user conflict, CSRF and cross-account state without transferring ownership', async () => {
  const a = await account(),
    b = await account(),
    t = await start(a);
  expect((await finish(b, t)).status).toBe(409);
  expect(
    (
      await fetch(origin + '/api/v1/auth/rengine/start', {
        method: 'POST',
        headers: { ...a.headers, 'x-csrf-token': 'bad' },
        body: JSON.stringify({ password: a.password }),
      })
    ).status,
  ).toBe(403);
  const code = 'mock-' + randomUUID();
  expect((await finish(a, t, code)).status).toBe(200);
  expect((await finish(b, await start(b), code)).status).toBe(409);
});
it('Worker parallel callback has one success and one replay refusal', async () => {
  const a = await account(),
    t = await start(a);
  const results = await Promise.all([finish(a, t), finish(a, t)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await h.db.externalIdentity.count({ where: { userId: a.user.id } })).toBe(1);
});
it('Worker logout invalidates pending binding and administrator access remains isolated', async () => {
  const a = await account(),
    t = await start(a);
  expect((await fetch(origin + '/api/v1/admin/personas', { headers: a.headers })).status).toBe(401);
  expect(
    (
      await fetch(origin + '/api/v1/auth/logout', {
        method: 'POST',
        headers: a.headers,
        body: '{}',
      })
    ).status,
  ).toBe(200);
  expect((await finish(a, t)).status).toBe(401);
  expect(await h.db.externalIdentity.count({ where: { userId: a.user.id } })).toBe(0);
});
