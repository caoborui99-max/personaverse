import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { harness } from './harness.ts';
import {
  chatAllowance,
  beijingDay,
  nextBeijingDay,
  CHAT_DAY_MS,
} from '../../apps/api/src/chat-allowance.ts';
import { buildDatabaseApp } from '../../apps/api/src/database-app.ts';
import { secretHash } from '../../apps/api/src/auth.ts';
let h: Awaited<ReturnType<typeof harness>>;
let now = Date.now(),
  personaId: string,
  versionId: string,
  slug: string;
const quota = chatAllowance(() => now);
beforeAll(async () => {
  h = await harness({ legacyAnonymousTestMode: false });
  slug = 'test-allowance-' + randomUUID();
  const p = await h.db.persona.create({ data: { id: randomUUID(), slug, name: 'TEST ONLY' } });
  personaId = p.id;
  const category = await h.db.category.create({
    data: { slug: 'test-' + randomUUID(), name: 'TEST ONLY' },
  });
  const v = await h.db.personaCoreVersion.create({
    data: {
      personaId,
      versionNumber: 1,
      coreText: 'TEST ONLY',
      openingMessage: 'TEST ONLY',
      profileSnapshot: {
        name: 'TEST ONLY',
        slug,
        summary: 'TEST ONLY',
        background: 'TEST ONLY',
        avatarUrl: '',
        tags: [],
        categoryIds: [category.id],
      },
      createdBy: h.admin.id,
    },
  });
  versionId = v.id;
  await h.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('personaverse.publication_action','publish',true)`;
    await tx.persona.update({
      where: { id: personaId },
      data: {
        status: 'published',
        publishedSlug: slug,
        publishedVersionId: versionId,
        draftVersionId: versionId,
      },
    });
  });
});
afterAll(async () => {
  await h?.close();
});
async function fixture() {
  const user = await h.db.user.create({
    data: {
      email: randomUUID() + '@test.invalid',
      passwordHash: '!TEST FIXTURE',
      emailVerifiedAt: new Date(now),
    },
  });
  const raw = randomBytes(32).toString('hex');
  const owner = await h.db.userSession.create({
    data: {
      userId: user.id,
      tokenHash: secretHash(raw),
      authVersion: 1,
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: new Date(now + 86400000),
    },
  });
  const chat = await h.db.chatSession.create({
    data: { personaId, coreVersionId: versionId, userId: user.id },
  });
  return { userId: user.id, owner: owner.id, chatId: chat.id, raw };
}
type F = Awaited<ReturnType<typeof fixture>>;
const status = (f: F) => h.db.$transaction((tx) => quota.status(tx, f.userId, f.owner));
const activity = (f: F, action: 'start' | 'activity' | 'heartbeat' | 'pause', lease?: string) =>
  h.db.$transaction((tx) => quota.activity(tx, f.userId, f.owner, f.chatId, action, lease));
it('grants a verified account 60 minutes and a simulated Token budget, not ten replies', async () => {
  const f = await fixture(),
    s = await status(f);
  expect(s).toMatchObject({
    dailyMs: 3600000,
    remainingMs: 3600000,
    remainingTokens: 100000,
    active: false,
    timezone: 'Asia/Shanghai',
    mode: 'mock',
  });
});
it('server heartbeats settle elapsed time once; repeated reads never double debit', async () => {
  const f = await fixture(),
    s = await activity(f, 'start');
  now += 10000;
  const a = await activity(f, 'heartbeat', s.leaseId!);
  expect(a.remainingMs).toBe(CHAT_DAY_MS - 10000);
  expect((await status(f)).remainingMs).toBe(a.remainingMs);
});
it('a closed page or disconnected device can debit at most its 30-second outstanding lease', async () => {
  const f = await fixture();
  await activity(f, 'start');
  now += 3600000;
  expect((await status(f)).remainingMs).toBe(CHAT_DAY_MS - 30000);
  now += 3600000;
  expect((await status(f)).remainingMs).toBe(CHAT_DAY_MS - 30000);
});
it('heartbeats alone cannot extend activity beyond five minutes', async () => {
  const f = await fixture();
  let s = await activity(f, 'start');
  for (let n = 0; n < 30; n++) {
    now += 10000;
    s = await activity(
      f,
      'heartbeat',
      s.leaseId ??
        (await h.db.userChatClock.findUniqueOrThrow({ where: { userId: f.userId } })).leaseId!,
    );
  }
  expect(s.active).toBe(false);
  expect(s.remainingMs).toBe(CHAT_DAY_MS - 300000);
  now += 10000;
  expect((await status(f)).remainingMs).toBe(s.remainingMs);
});
it('accepted input activity resumes timing and extends the idle deadline using only server time', async () => {
  const f = await fixture();
  const a = await activity(f, 'start');
  now += 40000;
  const s = await activity(f, 'activity', a.leaseId!);
  expect(s.active).toBe(true);
  expect(s.leaseId).not.toBe(a.leaseId);
});
it('pausing settles only elapsed time and prevents subsequent debit', async () => {
  const f = await fixture();
  const a = await activity(f, 'start');
  now += 1234;
  const s = await activity(f, 'pause', a.leaseId!);
  now += 1000000;
  expect((await status(f)).remainingMs).toBe(CHAT_DAY_MS - 1234);
  expect(s.active).toBe(false);
});
it('splits a live interval at Beijing midnight and synchronizes the new day', async () => {
  now = Date.UTC(2030, 0, 1, 15, 59, 50);
  const f = await fixture();
  await activity(f, 'start');
  now += 20000;
  const s = await status(f);
  expect(s.day).toBe('2030-01-02');
  expect(s.remainingMs).toBe(CHAT_DAY_MS - 10000);
  expect(
    (
      await h.db.userChatDay.findUniqueOrThrow({
        where: { userId_day: { userId: f.userId, day: '2030-01-01' } },
      })
    ).usedMs,
  ).toBe(10000);
  expect(s.resetsAt).toBe('2030-01-02T16:00:00.000Z');
});
it('one account has only one active clock; a message can fence an older device lease', async () => {
  const f = await fixture(),
    other = await h.db.userSession.create({
      data: {
        userId: f.userId,
        tokenHash: secretHash(randomUUID()),
        authVersion: 1,
        createdAt: new Date(now),
        lastSeenAt: new Date(now),
        expiresAt: new Date(now + 86400000),
      },
    });
  const old = await activity(f, 'start');
  await expect(activity({ ...f, owner: other.id }, 'start')).rejects.toMatchObject({ status: 409 });
  now += 1000;
  await h.db.$transaction((tx) => quota.consume(tx, f.userId, other.id, f.chatId, 10));
  await expect(activity(f, 'heartbeat', old.leaseId!)).rejects.toMatchObject({ status: 409 });
  expect((await status({ ...f, owner: other.id })).remainingTokens).toBe(99990);
});
it('parallel requests competing for the last tokens cannot overspend', async () => {
  const f = await fixture();
  await status(f);
  await h.db.userChatDay.update({
    where: { userId_day: { userId: f.userId, day: beijingDay(now) } },
    data: { usedTokens: 99995 },
  });
  const results = await Promise.allSettled([
    h.db.$transaction((tx) => quota.consume(tx, f.userId, f.owner, f.chatId, 4)),
    h.db.$transaction((tx) => quota.consume(tx, f.userId, f.owner, f.chatId, 4)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await status(f)).remainingTokens).toBe(1);
});
it('exhausted time and zero tokens deny new consumption and SQL rejects negative counters', async () => {
  const f = await fixture();
  await status(f);
  await h.db.userChatDay.update({
    where: { userId_day: { userId: f.userId, day: beijingDay(now) } },
    data: { usedMs: 3600000 },
  });
  await expect(
    h.db.$transaction((tx) => quota.consume(tx, f.userId, f.owner, f.chatId, 1)),
  ).rejects.toMatchObject({ status: 429 });
  await expect(
    h.db.userChatDay.update({
      where: { userId_day: { userId: f.userId, day: beijingDay(now) } },
      data: { usedMs: -1 },
    }),
  ).rejects.toBeDefined();
});
it('an aborted transaction rolls back both time and token changes', async () => {
  const f = await fixture();
  await status(f);
  await expect(
    h.db.$transaction(async (tx) => {
      await quota.consume(tx, f.userId, f.owner, f.chatId, 25);
      throw new Error('TEST ROLLBACK');
    }),
  ).rejects.toThrow('TEST ROLLBACK');
  expect((await status(f)).remainingTokens).toBe(100000);
});
it('caps elapsed time exactly at sixty minutes and restores a fresh allowance next Beijing day', async () => {
  const f = await fixture();
  await status(f);
  await h.db.userChatDay.update({
    where: { userId_day: { userId: f.userId, day: beijingDay(now) } },
    data: { usedMs: CHAT_DAY_MS - 1 },
  });
  await activity(f, 'start');
  now += 2;
  expect((await status(f)).remainingMs).toBe(0);
  await expect(activity(f, 'start')).rejects.toMatchObject({ status: 429 });
  now = nextBeijingDay(now) + 1;
  expect((await status(f)).remainingMs).toBe(CHAT_DAY_MS);
});
it('database foreign keys prevent a clock from pointing at another users chat or login session', async () => {
  const a = await fixture(),
    b = await fixture();
  const valid = {
    userId: a.userId,
    chatId: a.chatId,
    ownerSessionId: a.owner,
    leaseId: randomUUID(),
    settledAt: new Date(now),
    leaseUntil: new Date(now + 30000),
    activityAt: new Date(now),
  };
  await expect(
    h.db.userChatClock.create({ data: { ...valid, chatId: b.chatId } }),
  ).rejects.toMatchObject({ code: 'P2003' });
  await expect(
    h.db.userChatClock.create({ data: { ...valid, ownerSessionId: b.owner } }),
  ).rejects.toMatchObject({ code: 'P2003' });
});
it('real user APIs enforce ownership, CSRF and idempotency while AI stays disabled', async () => {
  const f = await fixture(),
    other = await fixture();
  const app = buildDatabaseApp({
    db: h.db,
    config: {
      environment: 'test',
      databaseUrl: process.env.DATABASE_URL!,
      origin: h.origin,
      secure: false,
    },
    clock: () => now,
  });
  await app.ready();
  const cookie = 'pv_v2_user_local=' + f.raw;
  const session = await app.inject({ url: '/api/v1/auth/session', headers: { cookie } });
  expect(session.statusCode).toBe(200);
  const headers = { cookie, origin: h.origin, 'x-csrf-token': session.json().csrfToken };
  const body = { eventId: randomUUID(), action: 'start' };
  try {
    expect((await app.inject('/api/v1/me/chat-allowance')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/me/chats/' + f.chatId + '/activity',
          headers: { cookie, origin: h.origin },
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    const call = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/me/chats/' + f.chatId + '/activity',
        headers,
        payload: body,
      });
    const results = await Promise.all([call(), call()]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(results[0].json()).toEqual(results[1].json());
    expect(await h.db.chatActivityEvent.count({ where: { userId: f.userId } })).toBe(1);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/me/chats/' + f.chatId + '/activity',
          headers,
          payload: { ...body, action: 'pause' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/me/chats/' + f.chatId + '/activity',
          headers,
          payload: { ...body, eventId: randomUUID(), seconds: 3600 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/me/chats/' + other.chatId + '/activity',
          headers,
          payload: { ...body, eventId: randomUUID() },
        })
      ).statusCode,
    ).toBe(404);
    const message = { clientMessageId: randomUUID(), content: 'TEST ONLY' };
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/me/chats/' + f.chatId + '/messages',
        headers,
        payload: message,
      });
    expect((await send()).statusCode).toBe(200);
    const tokens = (await status(f)).remainingTokens;
    expect((await send()).statusCode).toBe(200);
    expect((await status(f)).remainingTokens).toBe(tokens);
    await h.db.aiControl.update({ where: { id: 'global' }, data: { circuitOpen: true } });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/me/chats/' + f.chatId + '/messages',
          headers,
          payload: { ...message, clientMessageId: randomUUID() },
        })
      ).statusCode,
    ).toBe(503);
    expect((await status(f)).remainingTokens).toBe(tokens);
    await h.db.aiControl.update({ where: { id: 'global' }, data: { circuitOpen: false } });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/me/chats/' + f.chatId + '/ai-requests',
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(503);
  } finally {
    await app.close();
  }
});
