import { it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { harness } from './harness.ts';
import { secretHash } from '../../apps/api/src/auth.ts';
import { DeepSeekProvider } from '../../apps/api/src/ai/deepseek.ts';
import { BudgetEngine } from '../../apps/api/src/ai/engine.ts';
it('real chat admission persists once, rejects spoofing/concurrency, and retains unknown charges without resending', async () => {
  let calls = 0,
    broken = false;
  const provider = new DeepSeekProvider('synthetic-only', async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (broken) throw new Error('synthetic lost response');
    return Response.json({
      choices: [
        { finish_reason: 'stop', message: { role: 'assistant', content: 'SYNTHETIC COMPLETION' } },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
  });
  const h = await harness({ deepseek: provider, legacyAnonymousTestMode: false });
  try {
    const now = new Date();
    const p = await h.db.persona.create({
      data: { id: randomUUID(), slug: 'test-' + randomUUID(), name: 'TEST ONLY' },
    });
    const cat = await h.db.category.create({
      data: { id: randomUUID(), slug: 'test-' + randomUUID(), name: 'TEST ONLY' },
    });
    const v = await h.db.personaCoreVersion.create({
      data: {
        personaId: p.id,
        versionNumber: 1,
        coreText: 'TEST ONLY',
        openingMessage: 'TEST OPEN',
        profileSnapshot: {
          name: 'TEST ONLY',
          slug: p.slug,
          summary: 'TEST',
          background: 'TEST',
          avatarUrl: '',
          tags: [],
          categoryIds: [cat.id],
        },
        createdBy: h.admin.id,
      },
    });
    await h.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('personaverse.publication_action','publish',true)`;
      await tx.persona.update({
        where: { id: p.id },
        data: {
          status: 'published',
          publishedSlug: p.slug,
          publishedVersionId: v.id,
          draftVersionId: v.id,
        },
      });
    });
    const u = await h.db.user.create({
      data: { email: randomUUID() + '@test.invalid', passwordHash: '!TEST', emailVerifiedAt: now },
    });
    const raw = randomBytes(32).toString('hex');
    const login = await h.db.userSession.create({
      data: {
        userId: u.id,
        tokenHash: secretHash(raw),
        authVersion: 1,
        lastSeenAt: now,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const c = await h.db.chatSession.create({
      data: { userId: u.id, personaId: p.id, coreVersionId: v.id },
    });
    const session = await h.app.inject({
      url: '/api/v1/auth/session',
      headers: { cookie: 'pv_v2_user_local=' + raw },
    });
    expect(session.statusCode).toBe(200);
    const headers = {
      origin: h.origin,
      cookie: 'pv_v2_user_local=' + raw,
      'x-csrf-token': session.json().csrfToken,
    };
    const send = (key: string, content = 'TEST ONLY') =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/me/chats/' + c.id + '/messages',
        headers,
        payload: { clientMessageId: key, content },
      });
    const first = randomUUID();
    expect((await send(first)).statusCode).toBe(409); // no price/budget: zero network
    expect(calls).toBe(0);
    await h.db.aiPrice.create({
      data: {
        version: provider.priceVersion,
        simulated: false,
        currency: 'CNY',
        inputUnits: 100n,
        outputUnits: 100n,
      },
    });
    await h.db.aiControl.update({
      where: { id: 'global' },
      data: {
        priceVersion: provider.priceVersion,
        maxRequestUnits: 1000000n,
        maxInputTokens: 10000,
        maxOutputTokens: 1024,
        maxRunning: 2,
        ratePerMinute: 20,
        requestsPerDay: 100,
      },
    });
    for (const [scope, period] of [
      ['global-day', now.toISOString().slice(0, 10)],
      ['global-month', now.toISOString().slice(0, 7)],
    ])
      await h.db.aiBudget.create({
        data: {
          scope: scope!,
          subject: 'global',
          period: period!,
          currency: 'CNY',
          limitUnits: 10000000n,
        },
      });
    const results = await Promise.all([send(first), send(first)]);
    expect(results.some((r) => r.statusCode === 200)).toBe(true);
    expect(calls).toBe(1);
    expect((await send(first)).json().mode).toBe('deepseek');
    expect(calls).toBe(1);
    expect((await send(first, 'CHANGED')).statusCode).toBe(409);
    expect(await h.db.chatMessage.count({ where: { sessionId: c.id } })).toBe(2);
    expect(await h.db.aiLedgerEntry.count({ where: { simulated: false } })).toBe(2);
    expect(await h.db.aiUsageRecord.count({ where: { provider: 'deepseek' } })).toBe(1);
    const engine = new BudgetEngine(h.db, { deepseek: provider });
    await expect(
      engine.reserve(
        { kind: 'user', id: randomUUID(), sessionId: login.id, authVersion: 1, ip: '192.0.2.1' },
        c.id,
        randomUUID(),
        'TEST',
        1024,
      ),
    ).rejects.toThrow('OWNER_MISMATCH');
    broken = true;
    const uncertain = randomUUID();
    expect((await send(uncertain)).json().error.code).toBe('AI_OUTCOME_UNKNOWN');
    expect(calls).toBe(2);
    await send(uncertain);
    expect(calls).toBe(2);
    expect((await h.db.aiControl.findUniqueOrThrow({ where: { id: 'global' } })).circuitOpen).toBe(
      true,
    );
    expect(await h.db.aiReservation.count({ where: { status: 'held' } })).toBe(1);
    const unknown = await h.db.chatRequest.findUniqueOrThrow({
      where: { sessionId_clientMessageId: { sessionId: c.id, clientMessageId: uncertain } },
    });
    await engine.reconcile(unknown.id, 'release', 0n, 'a'.repeat(64));
    expect(await h.db.aiReservation.count({ where: { status: 'held' } })).toBe(0);
  } finally {
    await h.close();
  }
}, 60000);
