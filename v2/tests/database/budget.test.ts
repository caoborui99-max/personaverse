import { beforeAll, beforeEach, afterEach, afterAll, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import { harness } from './harness.ts';
import { BudgetEngine, estimateCost, MAX_UNITS } from '../../apps/api/src/ai/engine.ts';
import { FakeProvider, realProvider } from '../../apps/api/src/ai/fake-provider.ts';
let h: Awaited<ReturnType<typeof harness>>,
  engine: BudgetEngine,
  actor: { kind: 'visitor' | 'admin'; id: string; ip: string },
  sessionId: string,
  now: number,
  serial = 0,
  price: string;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const key = () => randomUUID();
const reserve = (msg = 'hello', id = key(), sid = sessionId) =>
  engine.reserve(actor, sid, id, msg, 20);
async function budgets(forActor = actor) {
  const day = new Date(now).toISOString().slice(0, 10),
    month = day.slice(0, 7);
  for (const [scope, subject, period] of [
    ['global-day', 'global', day],
    ['global-month', 'global', month],
    ...(forActor.kind === 'visitor'
      ? [
          ['visitor-day', forActor.id, day],
          ['visitor-life', forActor.id, 'lifetime'],
        ]
      : [['admin-test', forActor.id, day]]),
  ])
    await h.db.aiBudget.upsert({
      where: {
        scope_subject_period_currency: {
          scope: scope!,
          subject: subject!,
          period: period!,
          currency: 'CNY',
        },
      },
      create: {
        scope: scope!,
        subject: subject!,
        period: period!,
        currency: 'CNY',
        limitUnits: 10000000n,
      },
      update: {},
    });
}
async function chat() {
  const p = await h.db.persona.create({
    data: { id: randomUUID(), slug: 'budget-' + key(), name: 'TEST ONLY' },
  });
  const category = await h.db.category.create({
    data: { slug: 'budget-' + key(), name: 'TEST ONLY ' + key() },
  });
  const v = await h.db.personaCoreVersion.create({
    data: {
      personaId: p.id,
      versionNumber: 1,
      coreText: 'TEST SOURCE',
      openingMessage: 'TEST OPEN',
      profileSnapshot: {
        name: 'TEST',
        slug: p.slug,
        summary: 'TEST',
        background: 'TEST',
        avatarUrl: '',
        tags: [],
        categoryIds: [category.id],
      },
      createdBy: h.admin.id,
    },
  });
  await h.db.persona.update({ where: { id: p.id }, data: { draftVersionId: v.id } });
  await h.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('personaverse.publication_action','publish',true)`;
    await tx.persona.update({
      where: { id: p.id },
      data: { status: 'published', publishedVersionId: v.id, publishedSlug: p.slug },
    });
  });
  return h.db.chatSession.create({
    data: {
      personaId: p.id,
      coreVersionId: v.id,
      ...(actor.kind === 'admin' ? { adminId: actor.id } : { visitorId: actor.id }),
    },
  });
}
beforeAll(async () => {
  h = await harness();
}, 30000);
beforeEach(async () => {
  now = Date.UTC(2030, serial++, 1, 12);
  price = 'SIMULATED-' + key();
  const v = await h.db.visitorSession.create({
    data: { tokenHash: hash(key()), expiresAt: new Date('2100-01-01') },
  });
  actor = { kind: 'visitor', id: v.id, ip: '192.0.2.10' };
  await h.db.aiPrice.create({
    data: { version: price, currency: 'CNY', inputUnits: 1n, outputUnits: 10n },
  });
  await h.db.aiControl.update({
    where: { id: 'global' },
    data: {
      fakeEnabled: true,
      circuitOpen: false,
      reason: '',
      priceVersion: price,
      maxRequestUnits: 10000000n,
      maxInputTokens: 100000,
      maxOutputTokens: 100,
      maxRunning: 10,
      ratePerMinute: 100,
      requestsPerDay: 1000,
    },
  });
  engine = new BudgetEngine(h.db, { allowFake: true, clock: () => now, timeoutMs: 30 });
  sessionId = (await chat()).id;
  await budgets();
});
afterEach(async () => {
  // Disposable schema only. Do not turn interrupted dispatch into a free failure: first recover unknown,
  // then record explicit simulated reconciliation evidence to release test holds.
  await h.db.chatRequest.updateMany({
    where: { status: { in: ['reserved', 'running'] } },
    data: { leaseExpiresAt: new Date(0) },
  });
  await engine.recover();
  for (const r of await h.db.chatRequest.findMany({ where: { status: 'unknown' } }))
    await engine.reconcile(r.id, 'release', 0n, hash(r.id + ':test-evidence-release'));
});
afterAll(async () => {
  await h?.close();
});
it('starts with AI disabled by default, has no real provider and accepts no API Key', async () => {
  expect(() => realProvider()).toThrow('REAL_PROVIDER_NOT_IMPLEMENTED');
  const provider = new FakeProvider();
  const disabled = new BudgetEngine(h.db);
  await expect(
    disabled.runFake(actor, sessionId, key(), 'hello', 20, provider),
  ).rejects.toMatchObject({ code: 'AI_DISABLED' });
  expect(provider.calls).toBe(0);
  await h.db.aiControl.update({ where: { id: 'global' }, data: { fakeEnabled: false } });
  await expect(reserve()).rejects.toMatchObject({ code: 'AI_DISABLED' });
});
it('rejects zero and insufficient budgets and rolls back every reservation', async () => {
  await h.db.aiBudget.updateMany({
    where: { scope: 'global-day', period: new Date(now).toISOString().slice(0, 10) },
    data: { limitUnits: 0n },
  });
  await expect(reserve()).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
  expect(await h.db.chatRequest.count({ where: { sessionId } })).toBe(0);
  expect(
    (await h.db.aiBudget.findMany({ where: { scope: 'global-day' } })).every(
      (b) => b.reservedUnits === 0n,
    ),
  ).toBe(true);
});
it('reserves exactly the available balance using integer costs', async () => {
  const cost = estimateCost(Buffer.byteLength('TEST SOURCETEST OPENhello') + 192, 20, 1n, 10n);
  await h.db.aiBudget.updateMany({
    where: { scope: 'global-day', period: new Date(now).toISOString().slice(0, 10) },
    data: { limitUnits: cost },
  });
  const r = await reserve();
  expect(r.reservation?.amountUnits).toBe(cost);
});
it('serializes cross-instance competitors for the final balance', async () => {
  const cost = estimateCost(Buffer.byteLength('TEST SOURCETEST OPENhello') + 192, 20, 1n, 10n);
  await h.db.aiBudget.updateMany({
    where: { scope: 'global-day', period: new Date(now).toISOString().slice(0, 10) },
    data: { limitUnits: cost },
  });
  const [row] = await h.db.$queryRaw<{ schema: string }[]>`SELECT current_schema() AS schema`;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('schema', row!.schema);
  const otherDb = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const other = new BudgetEngine(otherDb, { allowFake: true, clock: () => now });
  try {
    const sid = (await chat()).id;
    const out = await Promise.allSettled([
      reserve(),
      other.reserve(actor, sid, key(), 'hello', 20),
    ]);
    expect(out.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(out.filter((r) => r.status === 'rejected')).toHaveLength(1);
  } finally {
    await otherDb.$disconnect();
  }
});
it('admin tests consume global and independent admin budgets, not visitor quota', async () => {
  actor = { kind: 'admin', id: h.admin.id, ip: '192.0.2.11' };
  sessionId = (await chat()).id;
  await budgets();
  const r = await reserve();
  const holds = await h.db.aiHold.findMany({
    where: { reservationId: r.reservation!.id },
    include: { budget: true },
  });
  expect(holds.map((h) => h.budget.scope).sort()).toEqual([
    'admin-test',
    'global-day',
    'global-month',
  ]);
});
it('denies absent new day/month budgets and preserves old reservations across UTC boundaries', async () => {
  const r = await reserve();
  const old = now;
  now = Date.UTC(2040, 0, 1);
  const sid = (await chat()).id;
  await expect(reserve('hello', key(), sid)).rejects.toMatchObject({ code: 'BUDGET_MISSING' });
  await budgets();
  expect((await reserve('hello', key(), sid)).status).toBe('reserved');
  expect(
    (await h.db.aiReservation.findUniqueOrThrow({ where: { id: r.reservation!.id } })).amountUnits,
  ).toBeGreaterThan(0n);
  now = old;
});
it('keeps integer precision and rejects overflow, negative or fractional tokens', () => {
  expect(estimateCost(1, 1, 9007199254740993n, 1n)).toBe(9007199254740994n);
  expect(() => estimateCost(2, 0, MAX_UNITS, 0n)).toThrow('AMOUNT_RANGE');
  expect(() => estimateCost(1.1, 1, 1n, 1n)).toThrow('TOKEN_RANGE');
});
it('freezes supplier price versions and releases a pre-dispatch reservation on price change', async () => {
  const r = await reserve();
  await expect(
    h.db.aiPrice.update({ where: { version: price }, data: { inputUnits: 2n } }),
  ).rejects.toBeDefined();
  await h.db.aiControl.update({ where: { id: 'global' }, data: { priceVersion: 'OTHER-VERSION' } });
  expect((await engine.dispatch(actor, r.id)).status).toBe('failed');
  expect((await h.db.aiReservation.findUniqueOrThrow({ where: { requestId: r.id } })).status).toBe(
    'released',
  );
});
it('same key and content dispatches once under concurrent retries; different content conflicts', async () => {
  const id = key(),
    provider = new FakeProvider('success', 5);
  const out = await Promise.all([
    engine.runFake(actor, sessionId, id, 'hello', 20, provider),
    engine.runFake(actor, sessionId, id, 'hello', 20, provider),
  ]);
  expect(provider.calls).toBe(1);
  expect(out.some((r) => r.status === 'succeeded')).toBe(true);
  const replay = await engine.runFake(actor, sessionId, id, 'hello', 20, provider);
  expect(replay.status).toBe('succeeded');
  expect(provider.calls).toBe(1);
  await expect(reserve('different', id)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(await h.db.aiLedgerEntry.count({ where: { requestId: replay.id, kind: 'settle' } })).toBe(
    1,
  );
});
it('uses a conservative output cap and rejects unbounded context/output', async () => {
  await h.db.aiControl.update({ where: { id: 'global' }, data: { maxOutputTokens: 5 } });
  await expect(reserve()).rejects.toMatchObject({ code: 'TOKEN_LIMIT' });
  await h.db.aiControl.update({
    where: { id: 'global' },
    data: { maxOutputTokens: 100, maxInputTokens: 1 },
  });
  await expect(reserve()).rejects.toMatchObject({ code: 'TOKEN_LIMIT' });
});
it('retains the hold on ambiguous supplier results, opens circuit and never blindly retries', async () => {
  const id = key(),
    provider = new FakeProvider('unknown');
  const r = await engine.runFake(actor, sessionId, id, 'hello', 20, provider);
  expect(r.status).toBe('unknown');
  expect(provider.calls).toBe(1);
  expect((await h.db.aiReservation.findUniqueOrThrow({ where: { requestId: r.id } })).status).toBe(
    'held',
  );
  expect((await engine.runFake(actor, sessionId, id, 'hello', 20, provider)).status).toBe(
    'unknown',
  );
  expect(provider.calls).toBe(1);
  expect((await h.db.aiControl.findUniqueOrThrow({ where: { id: 'global' } })).circuitOpen).toBe(
    true,
  );
});
it('releases only a known no-charge rejection', async () => {
  const r = await engine.runFake(
    actor,
    sessionId,
    key(),
    'hello',
    20,
    new FakeProvider('rejected'),
  );
  expect(r.status).toBe('failed');
  expect((await h.db.aiReservation.findUniqueOrThrow({ where: { requestId: r.id } })).status).toBe(
    'released',
  );
});
it('classifies timeout as unknown, not as free failure', async () => {
  const r = await engine.runFake(actor, sessionId, key(), 'hello', 20, new FakeProvider('timeout'));
  expect(r.status).toBe('unknown');
  expect(await h.db.aiUsageRecord.count({ where: { requestId: r.id } })).toBe(0);
});
it('recovers expired leases concurrently with fencing and no second dispatch', async () => {
  const r = await reserve();
  const started = await engine.dispatch(actor, r.id);
  now += 6000;
  const n = await Promise.all([engine.recover(), engine.recover()]);
  expect(n.reduce((a, b) => a + b, 0)).toBe(1);
  await expect(
    engine.finish(r.id, started.fencingToken, { content: 'late', inputTokens: 1, outputTokens: 1 }),
  ).rejects.toMatchObject({ code: 'FENCE_CONFLICT' });
  expect((await h.db.chatRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
    'unknown',
  );
});
it('releases expired reserved requests without calling any provider', async () => {
  const r = await reserve();
  now += 31000;
  await engine.recover();
  expect((await h.db.chatRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('failed');
});
it('settles evidence once, appends adjustments and rejects rewriting confirmed financial history', async () => {
  const r = await engine.runFake(actor, sessionId, key(), 'hello', 20, new FakeProvider('unknown'));
  const evidence = hash(key());
  await engine.reconcile(r.id, 'settle', 20n, evidence);
  await engine.reconcile(r.id, 'settle', 20n, evidence);
  expect(await h.db.aiLedgerEntry.count({ where: { requestId: r.id, kind: 'settle' } })).toBe(1);
  const adjustment = hash(key());
  await engine.adjust(r.id, -1n, adjustment);
  await engine.adjust(r.id, -1n, adjustment);
  expect(await h.db.aiLedgerEntry.count({ where: { requestId: r.id, kind: 'adjust' } })).toBe(1);
  const usage = await h.db.aiUsageRecord.findUniqueOrThrow({ where: { requestId: r.id } });
  await expect(
    h.db.aiUsageRecord.update({ where: { id: usage.id }, data: { actualCost: '0' } }),
  ).rejects.toBeDefined();
  await expect(h.db.aiLedgerEntry.deleteMany({ where: { requestId: r.id } })).rejects.toBeDefined();
  await expect(engine.reconcile(r.id, 'release', 0n, hash(key()))).rejects.toMatchObject({
    code: 'NOT_UNKNOWN',
  });
});
it('rejects cross-session usage attribution with a composite foreign key', async () => {
  const r = await reserve(),
    other = await chat();
  await expect(
    h.db.aiUsageRecord.create({
      data: {
        requestId: r.id,
        sessionId: other.id,
        provider: 'FAKE',
        model: 'SIMULATED',
        reservedCost: '1',
        actualCost: '0',
        status: 'released',
      },
    }),
  ).rejects.toBeDefined();
});
it('forbids illegal state transitions and request rebinding', async () => {
  const r = await reserve();
  await expect(
    h.db.chatRequest.update({ where: { id: r.id }, data: { status: 'succeeded' } }),
  ).rejects.toBeDefined();
  await expect(
    h.db.chatRequest.update({ where: { id: r.id }, data: { inputText: 'changed' } }),
  ).rejects.toBeDefined();
});
it('closed sessions and unpublished personas release before dispatch', async () => {
  const r = await reserve();
  await h.db.chatSession.update({ where: { id: sessionId }, data: { status: 'closed' } });
  const d = await engine.dispatch(actor, r.id);
  expect(d.status).toBe('failed');
  expect(d.errorCode).toBe('CHAT_CLOSED');
  sessionId = (await chat()).id;
  const next = await reserve();
  const s = await h.db.chatSession.findUniqueOrThrow({ where: { id: sessionId } });
  await h.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('personaverse.publication_action','unpublish',true)`;
    await tx.persona.update({ where: { id: s.personaId }, data: { status: 'draft' } });
  });
  expect((await engine.dispatch(actor, next.id)).status).toBe('failed');
});
it('already dispatched requests remain accountable after closure', async () => {
  const r = await reserve(),
    started = await engine.dispatch(actor, r.id);
  await h.db.chatSession.update({ where: { id: sessionId }, data: { status: 'closed' } });
  const result = await engine.finish(r.id, started.fencingToken, {
    content: 'FAKE',
    inputTokens: 1,
    outputTokens: 1,
  });
  expect(result.status).toBe('succeeded');
  expect(await h.db.aiUsageRecord.count({ where: { requestId: r.id } })).toBe(1);
});
it('global disable between reservation and dispatch releases the hold', async () => {
  const r = await reserve();
  await h.db.aiControl.update({ where: { id: 'global' }, data: { fakeEnabled: false } });
  expect((await engine.dispatch(actor, r.id)).status).toBe('failed');
});
it('database failure rejects before fake provider invocation', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.port = '1';
  url.searchParams.set('connect_timeout', '1');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const p = new FakeProvider();
  try {
    await expect(
      new BudgetEngine(db, { allowFake: true }).runFake(actor, sessionId, key(), 'hello', 20, p),
    ).rejects.toBeDefined();
    expect(p.calls).toBe(0);
  } finally {
    await db.$disconnect();
  }
});
it('rolls back budget and request on an actual connection interruption inside reservation', async () => {
  await h.db.$executeRawUnsafe(
    `CREATE FUNCTION kill_fake_reserve() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NEW; END; $$`,
  );
  await h.db.$executeRawUnsafe(
    `CREATE TRIGGER kill_fake_reserve BEFORE INSERT ON "AiLedgerEntry" FOR EACH ROW EXECUTE FUNCTION kill_fake_reserve()`,
  );
  try {
    await expect(reserve()).rejects.toBeDefined();
  } finally {
    await h.db.$executeRawUnsafe('DROP TRIGGER kill_fake_reserve ON "AiLedgerEntry"');
    await h.db.$executeRawUnsafe('DROP FUNCTION kill_fake_reserve()');
  }
  expect(await h.db.chatRequest.count({ where: { sessionId } })).toBe(0);
  const b = await h.db.aiBudget.findFirstOrThrow({
    where: { scope: 'visitor-life', subject: actor.id },
  });
  expect(b.reservedUnits).toBe(0n);
});
it('persistent rate windows survive new engine objects and do not store raw IPs', async () => {
  await h.db.aiControl.update({ where: { id: 'global' }, data: { ratePerMinute: 1 } });
  await reserve();
  const sid = (await chat()).id;
  await expect(
    new BudgetEngine(h.db, { allowFake: true, clock: () => now }).reserve(
      actor,
      sid,
      key(),
      'hello',
      20,
    ),
  ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  const rows = await h.db.aiRateBucket.findMany();
  expect(JSON.stringify(rows)).not.toContain(actor.ip);
});
it('unknown exposure consumes global running capacity and budgets cannot mix currencies', async () => {
  await h.db.aiControl.update({ where: { id: 'global' }, data: { maxRunning: 1 } });
  const r = await reserve();
  await engine.dispatch(actor, r.id);
  const sid = (await chat()).id;
  const other = await reserve('hello', key(), sid);
  expect((await engine.dispatch(actor, other.id)).status).toBe('failed');
  const budget = await h.db.aiBudget.create({
    data: { scope: 'test', subject: key(), period: 'test', currency: 'USD', limitUnits: 100n },
  });
  await expect(
    h.db.aiHold.create({ data: { reservationId: r.reservation!.id, budgetId: budget.id } }),
  ).rejects.toBeDefined();
});
it('fake provider executes without any fetch or real supplier dependency', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('NETWORK_FORBIDDEN');
  };
  try {
    expect(
      (await engine.runFake(actor, sessionId, key(), 'hello', 20, new FakeProvider())).status,
    ).toBe('succeeded');
  } finally {
    globalThis.fetch = old;
  }
});
it('rechecks reduced budgets and output limits before dispatch, releasing all holds', async () => {
  const r = await reserve();
  await h.db.aiBudget.updateMany({
    where: { scope: 'visitor-life', subject: actor.id },
    data: { limitUnits: 0n },
  });
  expect((await engine.dispatch(actor, r.id)).status).toBe('failed');
  expect((await h.db.aiReservation.findUniqueOrThrow({ where: { requestId: r.id } })).status).toBe(
    'released',
  );
});
it('records exact simulated usage and prevents duplicate terminal ledger writes', async () => {
  const r = await engine.runFake(actor, sessionId, key(), 'hello', 20, new FakeProvider());
  const usage = await h.db.aiUsageRecord.findUniqueOrThrow({ where: { requestId: r.id } });
  expect(usage.inputTokens).toBeGreaterThan(0);
  expect(usage.outputTokens).toBe(3);
  await expect(
    h.db.aiLedgerEntry.create({
      data: { requestId: r.id, kind: 'release', units: 0n, currency: 'CNY', evidence: hash(key()) },
    }),
  ).rejects.toBeDefined();
});
it('enforces Decimal precision and immutable budget hold associations in PostgreSQL', async () => {
  const r = await reserve();
  const hold = await h.db.aiHold.findFirstOrThrow({ where: { reservationId: r.reservation!.id } });
  await expect(
    h.db.aiHold.delete({
      where: {
        reservationId_budgetId: { reservationId: hold.reservationId, budgetId: hold.budgetId },
      },
    }),
  ).rejects.toBeDefined();
  await expect(
    h.db.aiBudget.update({ where: { id: hold.budgetId }, data: { limitUnits: MAX_UNITS + 1n } }),
  ).rejects.toBeDefined();
});
it('enforces daily request counts across new sessions independently of minute rate', async () => {
  await h.db.aiControl.update({ where: { id: 'global' }, data: { requestsPerDay: 1 } });
  await reserve();
  const sid = (await chat()).id;
  await expect(reserve('hello', key(), sid)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
});
it('retains unknown exposure when the database connection dies after fake acceptance', async () => {
  class Interrupted extends FakeProvider {
    override async complete(input: { estimatedInputTokens: number; maxOutputTokens: number }) {
      const result = await super.complete(input);
      await h.db.$executeRawUnsafe(
        `CREATE FUNCTION kill_fake_finish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NEW; END; $$`,
      );
      await h.db.$executeRawUnsafe(
        `CREATE TRIGGER kill_fake_finish BEFORE INSERT ON "AiLedgerEntry" FOR EACH ROW EXECUTE FUNCTION kill_fake_finish()`,
      );
      return result;
    }
  }
  const provider = new Interrupted();
  try {
    const result = await engine.runFake(actor, sessionId, key(), 'hello', 20, provider);
    expect(result.status).toBe('unknown');
    expect(provider.calls).toBe(1);
    expect(
      (await h.db.aiReservation.findUniqueOrThrow({ where: { requestId: result.id } })).status,
    ).toBe('held');
    expect(await h.db.aiUsageRecord.count({ where: { requestId: result.id } })).toBe(0);
  } finally {
    await h.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS kill_fake_finish ON "AiLedgerEntry"');
    await h.db.$executeRawUnsafe('DROP FUNCTION IF EXISTS kill_fake_finish()');
  }
});
it('HTTP entrypoints isolate identities and stay disabled even with positive test budgets', async () => {
  const path = '/api/v1/chat/sessions/' + sessionId + '/ai-requests';
  const payload = { clientMessageId: key(), content: 'hello', maxOutputTokens: 20 };
  expect(
    (await h.app.inject({ method: 'POST', url: path, headers: { origin: h.origin }, payload }))
      .statusCode,
  ).toBe(401);
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/test/sessions/' + sessionId + '/ai-requests',
        headers: { origin: h.origin },
        payload,
      })
    ).statusCode,
  ).toBe(401);
  const token = key();
  await h.db.visitorSession.update({ where: { id: actor.id }, data: { tokenHash: hash(token) } });
  const result = await h.app.inject({
    method: 'POST',
    url: path,
    headers: { origin: h.origin, cookie: 'pv_v2_visitor_local=' + token },
    payload,
  });
  expect(result.statusCode).toBe(503);
  expect(result.json().error.code).toBe('AI_DISABLED');
  expect(await h.db.chatRequest.count({ where: { sessionId } })).toBe(0);
});
it('opens the global circuit after three explicit no-charge provider failures', async () => {
  for (let n = 0; n < 3; n++) {
    const sid = n === 0 ? sessionId : (await chat()).id;
    expect(
      (await engine.runFake(actor, sid, key(), 'hello', 20, new FakeProvider('rejected'))).status,
    ).toBe('failed');
  }
  expect((await h.db.aiControl.findUniqueOrThrow({ where: { id: 'global' } })).circuitOpen).toBe(
    true,
  );
  expect(
    (await h.db.aiBudget.findFirstOrThrow({ where: { scope: 'visitor-life', subject: actor.id } }))
      .reservedUnits,
  ).toBe(0n);
});
