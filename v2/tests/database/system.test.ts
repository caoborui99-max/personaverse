import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { harness } from './harness.ts';
import { buildDatabaseApp } from '../../apps/api/src/database-app.ts';
import { ensureTestDraft } from '../../scripts/seed-test.ts';
import { passwordHash } from '../../apps/api/src/auth.ts';
let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => {
  h = await harness();
}, 30000);
afterAll(async () => {
  await h?.close();
});
it('authenticates using Argon2id and confirms actual opaque database session', async () => {
  const { res, session } = await h.login();
  expect(res.statusCode).toBe(200);
  expect(session?.statusCode).toBe(200);
  expect(session?.json().admin.email).toBe(h.email);
  const raw = String(res.headers['set-cookie']).split('=')[1]?.split(';')[0];
  const row = await h.db.adminSession.findFirstOrThrow({ where: { adminId: h.admin.id } });
  expect(row.tokenHash).not.toBe(raw);
  expect(h.admin.passwordHash).toMatch(/^\$argon2id\$/);
  expect(res.headers['set-cookie']).toContain('HttpOnly; SameSite=Lax');
});
it('rejects wrong passwords, unauthenticated and forged administrators', async () => {
  expect((await h.login('wrong-password')).res.statusCode).toBe(401);
  for (const headers of [
    {},
    { cookie: 'admin=true; pv_v2_mock=fake', authorization: 'Bearer admin', 'x-admin': 'true' },
  ])
    expect((await h.app.inject({ url: '/api/v1/admin/personas', headers })).statusCode).toBe(401);
});
it('rejects login CSRF, cross-origin and missing authenticated CSRF', async () => {
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/auth/login',
        headers: { origin: h.origin },
        payload: { email: h.email, password: h.password },
      })
    ).statusCode,
  ).toBe(403);
  const { headers } = await h.login();
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/personas',
        headers: { ...headers, origin: 'https://evil.invalid' },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/personas',
        headers: { ...headers, 'x-csrf-token': 'wrong' },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
});
it('immediately revokes logout and records an immutable audit event', async () => {
  const { headers } = await h.login();
  expect(
    (await h.app.inject({ method: 'POST', url: '/api/v1/admin/auth/logout', headers })).statusCode,
  ).toBe(200);
  expect((await h.app.inject({ url: '/api/v1/admin/auth/session', headers })).statusCode).toBe(401);
  const audit = await h.db.adminAuditLog.findFirstOrThrow({ where: { action: 'logout' } });
  await expect(h.db.adminAuditLog.delete({ where: { id: audit.id } })).rejects.toBeDefined();
});
it('enforces absolute and idle expiry', async () => {
  const { headers } = await h.login();
  h.advance(31 * 60000);
  expect((await h.app.inject({ url: '/api/v1/admin/auth/session', headers })).statusCode).toBe(401);
  const fresh = await h.login();
  h.advance(13 * 3600000);
  expect(
    (await h.app.inject({ url: '/api/v1/admin/auth/session', headers: fresh.headers })).statusCode,
  ).toBe(401);
});
it('password change revokes all existing sessions', async () => {
  const { headers } = await h.login();
  const second = await h.login();
  const next = randomUUID() + randomUUID();
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/auth/password',
        headers,
        payload: { currentPassword: h.password, newPassword: next },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await h.app.inject({ url: '/api/v1/admin/auth/session', headers: second.headers })).statusCode,
  ).toBe(401);
  expect((await h.login(h.password)).res.statusCode).toBe(401);
  expect((await h.login(next)).res.statusCode).toBe(200);
  h.password = next;
});
it('returns 403 for read-only administrator writes while allowing logout', async () => {
  const email = randomUUID() + '@test.invalid';
  await h.db.adminAccount.create({
    data: { email, passwordHash: await passwordHash(h.password), role: 'viewer' },
  });
  const { headers } = await h.login(h.password, email);
  expect((await h.app.inject({ url: '/api/v1/admin/personas', headers })).statusCode).toBe(200);
  expect(
    (await h.app.inject({ method: 'POST', url: '/api/v1/admin/personas', headers, payload: {} }))
      .statusCode,
  ).toBe(403);
  expect(
    (await h.app.inject({ method: 'POST', url: '/api/v1/admin/auth/logout', headers })).statusCode,
  ).toBe(200);
});
it('enforces persistent login rate limits', async () => {
  h.advance(16 * 60000);
  const email = randomUUID() + '@test.invalid';
  for (let n = 0; n < 10; n++) expect((await h.login('wrong', email)).res.statusCode).toBe(401);
  const last = await h.login('wrong', email);
  expect(last.res.statusCode).toBe(429);
  expect(last.res.headers['retry-after']).toBe('900');
  h.advance(16 * 60000);
});
it('rejects authentication with 503 on PostgreSQL outage, never fake success', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.port = '1';
  url.searchParams.set('connect_timeout', '1');
  const app = buildDatabaseApp({
    db: new PrismaClient({ datasources: { db: { url: url.toString() } } }),
    config: { environment: 'test', databaseUrl: url.toString(), origin: h.origin, secure: false },
  });
  const res = await app.inject('/api/v1/admin/auth/session');
  expect(res.statusCode).toBe(503);
  expect(res.json().error.code).toBe('DATABASE_UNAVAILABLE');
  await app.close();
});
it('creates blank draft, saves exact original source and validates publication', async () => {
  const { headers } = await h.login();
  const draft = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/personas',
    headers,
    payload: {},
  });
  expect(draft.statusCode).toBe(201);
  const p = draft.json();
  expect(p.name).toBe('');
  expect(p.status).toBe('draft');
  expect(p.draftVersionId).toBeNull();
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/personas/${p.id}/publish`,
        headers,
        payload: { expectedRevision: 0 },
      })
    ).statusCode,
  ).toBe(400);
  const cat = (
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/categories',
      headers,
      payload: { name: '测试分类 ' + randomUUID(), slug: 'test-' + randomUUID() },
    })
  ).json();
  const fields = {
    name: '手工测试资料',
    slug: 'manual-' + randomUUID(),
    summary: '测试简介',
    background: '测试背景原文',
    avatarUrl: '',
    tags: ['测试标签'],
    categoryIds: [cat.id],
    coreText: ' \n站长原文测试\n  ',
    openingMessage: '测试开场白',
    expectedRevision: 0,
  };
  const save = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/personas/${p.id}`,
    headers,
    payload: fields,
  });
  expect(save.statusCode).toBe(200);
  expect(save.json().draftVersion.coreText).toBe(fields.coreText);
  expect((await h.app.inject('/api/v1/personas/' + fields.slug)).statusCode).toBe(404);
  const pub = await h.app.inject({
    method: 'POST',
    url: `/api/v1/admin/personas/${p.id}/publish`,
    headers,
    payload: { expectedRevision: 1 },
  });
  expect(pub.statusCode).toBe(200);
  const publicResult = await h.app.inject('/api/v1/personas/' + fields.slug);
  expect(publicResult.statusCode).toBe(200);
  expect(JSON.stringify(publicResult.json())).not.toContain(fields.coreText);
  expect(publicResult.json().persona).not.toHaveProperty('draftVersion');
  const change = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/personas/${p.id}`,
    headers,
    payload: { ...fields, expectedRevision: 2, name: '未发布改动', coreText: '新内核原文' },
  });
  expect(change.statusCode).toBe(200);
  expect(change.json().draftVersion.versionNumber).toBe(2);
  expect((await h.app.inject('/api/v1/personas/' + fields.slug)).json().persona.name).toBe(
    fields.name,
  );
  const conflict = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/personas/${p.id}`,
    headers,
    payload: { ...fields, expectedRevision: 2 },
  });
  expect(conflict.statusCode).toBe(409);
  const versions = (
    await h.app.inject({ url: `/api/v1/admin/personas/${p.id}/versions`, headers })
  ).json().items;
  const restored = await h.app.inject({
    method: 'POST',
    url: `/api/v1/admin/personas/${p.id}/restore`,
    headers,
    payload: { versionId: versions[1].id, expectedRevision: 3 },
  });
  expect(restored.statusCode).toBe(200);
  expect(restored.json().draftVersion.versionNumber).toBe(3);
  expect(restored.json().draftVersion.restoredFromId).toBe(versions[1].id);
  expect(restored.json().draftVersion.coreText).toBe(fields.coreText);
  const compare = await h.app.inject({
    url: `/api/v1/admin/personas/${p.id}/compare?from=${versions[1].id}&to=${versions[0].id}`,
    headers,
  });
  expect(compare.json().changedFields).toContain('coreText');
  const unpublish = await h.app.inject({
    method: 'POST',
    url: `/api/v1/admin/personas/${p.id}/unpublish`,
    headers,
    payload: { expectedRevision: 4 },
  });
  expect(unpublish.statusCode).toBe(200);
  expect((await h.app.inject('/api/v1/personas/' + fields.slug)).statusCode).toBe(404);
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/personas/${p.id}/archive`,
        headers,
        payload: { expectedRevision: 5 },
      })
    ).statusCode,
  ).toBe(200);
});
it('keeps test drafts private and rolls back partial save on invalid category', async () => {
  const { headers } = await h.login();
  const p = (
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/personas',
      headers,
      payload: { isTest: true },
    })
  ).json();
  const before = await h.db.persona.findUniqueOrThrow({ where: { id: p.id } });
  const res = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/personas/${p.id}`,
    headers,
    payload: {
      name: 'TEST ONLY',
      slug: p.slug,
      summary: '',
      background: '',
      avatarUrl: '',
      tags: [],
      categoryIds: [randomUUID()],
      coreText: 'TEST',
      openingMessage: '',
      expectedRevision: 0,
    },
  });
  expect(res.statusCode).toBe(400);
  expect((await h.db.persona.findUniqueOrThrow({ where: { id: p.id } })).revision).toBe(
    before.revision,
  );
  expect(await h.db.personaCoreVersion.count({ where: { personaId: p.id } })).toBe(0);
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/personas/${p.id}/publish`,
        headers,
        payload: { expectedRevision: 0 },
      })
    ).statusCode,
  ).toBe(400);
});
it('binds admin unpublished-version test sessions permanently, isolates visitors, and supports 20 rounds without visitor quota', async () => {
  const { headers } = await h.login();
  const id = randomUUID();
  const p = await h.db.persona.create({
    data: { id, slug: 'test-' + id, name: 'TEST ONLY', isTest: true },
  });
  const v = await h.db.personaCoreVersion.create({
    data: {
      personaId: p.id,
      versionNumber: 1,
      coreText: 'TEST ONLY',
      openingMessage: '',
      profileSnapshot: {},
      createdBy: h.admin.id,
    },
  });
  const chat = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/test/sessions',
    headers,
    payload: { personaId: p.id, versionId: v.id },
  });
  expect(chat.statusCode).toBe(200);
  const chatId = chat.json().id;
  for (let i = 0; i < 20; i++)
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/test/sessions/${chatId}/messages`,
          headers,
          payload: { clientMessageId: randomUUID(), content: 'TEST ' + i },
        })
      ).statusCode,
    ).toBe(200);
  const response = await h.app.inject({
    url: `/api/v1/admin/test/sessions/${chatId}/messages`,
    headers,
  });
  expect(response.json().messages).toHaveLength(40);
  expect(response.json().coreVersionId).toBe(v.id);
  await h.db.personaCoreVersion.create({
    data: {
      personaId: p.id,
      versionNumber: 2,
      coreText: 'TEST NEW',
      openingMessage: '',
      profileSnapshot: {},
      createdBy: h.admin.id,
    },
  });
  expect((await h.db.chatSession.findUniqueOrThrow({ where: { id: chatId } })).coreVersionId).toBe(
    v.id,
  );
  expect(
    (await h.app.inject({ url: `/api/v1/chat/sessions/${chatId}/messages`, headers })).statusCode,
  ).toBe(401);
});

it('detects simultaneous saves atomically and creates only one new version', async () => {
  const { headers } = await h.login();
  const p = (
    await h.app.inject({ method: 'POST', url: '/api/v1/admin/personas', headers, payload: {} })
  ).json();
  const fields = {
    name: 'TEST ONLY',
    slug: p.slug,
    summary: '',
    background: '',
    avatarUrl: '',
    tags: [],
    categoryIds: [],
    coreText: '  TEST ORIGINAL  ',
    openingMessage: '',
    expectedRevision: 0,
  };
  const responses = await Promise.all(
    ['first', 'second'].map((name) =>
      h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/personas/${p.id}`,
        headers,
        payload: { ...fields, name },
      }),
    ),
  );
  expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(await h.db.personaCoreVersion.count({ where: { personaId: p.id } })).toBe(1);
});
it('repeats test initialization without overwriting author content or publishing fixtures', async () => {
  const first = await ensureTestDraft(h.db);
  await h.db.persona.update({
    where: { id: first.id },
    data: { background: 'DO NOT OVERWRITE TEST SOURCE' },
  });
  const second = await ensureTestDraft(h.db);
  expect(second.id).toBe(first.id);
  expect(second.background).toBe('DO NOT OVERWRITE TEST SOURCE');
  expect(second.status).toBe('draft');
  expect((await h.app.inject('/api/v1/personas/' + second.slug)).statusCode).toBe(404);
});
it('uses Secure host-only cookies for an explicit HTTPS environment', async () => {
  const url = process.env.DATABASE_URL!;
  const app = buildDatabaseApp({
    config: { environment: 'test', databaseUrl: url, origin: 'https://test.invalid', secure: true },
  });
  const res = await app.inject('/api/v1/admin/auth/csrf');
  expect(res.headers['set-cookie']).toMatch(/^__Host-pv_v2_login=/);
  expect(res.headers['set-cookie']).toContain('; Secure');
  expect(res.headers['set-cookie']).not.toContain('Domain=');
  await app.close();
});
it('persists visitor mock chat for 20 rounds with idempotency, retry, fixed versions and unpublish denial', async () => {
  const { headers } = await h.login();
  const p = (
    await h.app.inject({ method: 'POST', url: '/api/v1/admin/personas', headers, payload: {} })
  ).json();
  const category = await h.db.category.create({
    data: { name: 'TEST ' + randomUUID(), slug: 'test-' + randomUUID() },
  });
  const fields = {
    name: 'TEST ONLY manual publication',
    slug: p.slug,
    summary: 'TEST ONLY',
    background: 'TEST ONLY',
    avatarUrl: '',
    tags: [],
    categoryIds: [category.id],
    coreText: 'TEST ONLY SOURCE',
    openingMessage: 'TEST ONLY',
    expectedRevision: 0,
  };
  const saved = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/personas/${p.id}`,
    headers,
    payload: fields,
  });
  expect(saved.statusCode).toBe(200);
  const versionId = saved.json().draftVersionId;
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/personas/${p.id}/publish`,
        headers,
        payload: { expectedRevision: 1 },
      })
    ).statusCode,
  ).toBe(200);
  const visitor = await h.app.inject({
    method: 'POST',
    url: '/api/v1/visitor/session',
    headers: { origin: h.origin },
    payload: {},
  });
  const vh = { origin: h.origin, cookie: String(visitor.headers['set-cookie']).split(';')[0]! };
  const session = await h.app.inject({
    method: 'POST',
    url: '/api/v1/chat/sessions',
    headers: vh,
    payload: { personaSlug: p.slug },
  });
  expect(session.statusCode).toBe(200);
  const id = session.json().id;
  const send = (content: string, clientMessageId = randomUUID()) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/chat/sessions/${id}/messages`,
      headers: vh,
      payload: { content, clientMessageId },
    });
  for (let i = 0; i < 20; i++) expect((await send('TEST ' + i)).statusCode).toBe(200);
  const requestId = randomUUID();
  expect((await send('/fail-once', requestId)).statusCode).toBe(503);
  expect((await send('/fail-once', requestId)).statusCode).toBe(200);
  expect((await send('/fail-once', requestId)).json().messages).toHaveLength(42);
  const history = await h.app.inject({ url: `/api/v1/chat/sessions/${id}/messages`, headers: vh });
  expect(history.json().id).toBe(id);
  expect(history.json().coreVersionId).toBe(versionId);
  expect((await h.app.inject({ url: '/api/v1/admin/personas', headers: vh })).statusCode).toBe(401);
  await h.app.inject({
    method: 'POST',
    url: `/api/v1/admin/personas/${p.id}/unpublish`,
    headers,
    payload: { expectedRevision: 2 },
  });
  expect((await send('not available')).statusCode).toBe(404);
  expect(
    (await h.app.inject({ method: 'DELETE', url: '/api/v1/chat/sessions', headers: vh }))
      .statusCode,
  ).toBe(200);
  expect(await h.db.chatSession.count({ where: { id } })).toBe(0);
});
