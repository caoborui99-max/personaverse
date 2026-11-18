import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { harness } from './harness.ts';
let h: Awaited<ReturnType<typeof harness>>;
let headers: Record<string, string>;
beforeAll(async () => {
  h = await harness();
  headers = (await h.login()).headers;
}, 30000);
afterAll(async () => {
  await h?.close();
});
async function draft() {
  const p = (
    await h.app.inject({ method: 'POST', url: '/api/v1/admin/personas', headers, payload: {} })
  ).json();
  const category = await h.db.category.create({
    data: { name: 'TEST ONLY ' + randomUUID(), slug: 'test-' + randomUUID() },
  });
  const fields = {
    name: 'TEST ONLY',
    slug: p.slug,
    summary: 'TEST ONLY',
    background: 'TEST ONLY',
    avatarUrl: '',
    tags: [],
    categoryIds: [category.id],
    coreText: '  TEST ORIGINAL\n不改写  ',
    openingMessage: 'TEST ONLY',
  };
  const res = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/personas/${p.id}`,
    headers,
    payload: { ...fields, expectedRevision: 0 },
  });
  expect(res.statusCode).toBe(200);
  return { p: res.json(), fields };
}
const publish = (p: { id: string; revision: number; draftVersionId: string }) =>
  h.app.inject({
    method: 'POST',
    url: `/api/v1/admin/personas/${p.id}/publish`,
    headers,
    payload: { expectedRevision: p.revision, expectedVersionId: p.draftVersionId },
  });
it('permits chat status changes but rejects rebinding to any valid persona, version or owner', async () => {
  const { p } = await draft(),
    other = await draft();
  const next = await h.db.personaCoreVersion.create({
    data: {
      personaId: p.id,
      versionNumber: 2,
      coreText: 'TEST',
      openingMessage: '',
      profileSnapshot: {},
      createdBy: h.admin.id,
    },
  });
  const admin = await h.db.adminAccount.create({
    data: { email: randomUUID() + '@test.invalid', passwordHash: h.admin.passwordHash },
  });
  const visitor = () =>
    h.db.visitorSession.create({
      data: {
        tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
  const a = await visitor(),
    b = await visitor();
  const chat = await h.db.chatSession.create({
    data: { personaId: p.id, coreVersionId: p.draftVersionId, adminId: h.admin.id },
  });
  expect(
    (
      await h.db.chatSession.update({
        where: { id: chat.id },
        data: { status: 'closed', updatedAt: new Date() },
      })
    ).status,
  ).toBe('closed');
  for (const data of [
    { coreVersionId: next.id },
    { adminId: admin.id },
    { adminId: null, visitorId: a.id },
    { personaId: other.p.id, coreVersionId: other.p.draftVersionId },
  ])
    await expect(h.db.chatSession.update({ where: { id: chat.id }, data })).rejects.toBeDefined();
  const guest = await h.db.chatSession.create({
    data: { personaId: p.id, coreVersionId: p.draftVersionId, visitorId: a.id },
  });
  await expect(
    h.db.chatSession.update({ where: { id: guest.id }, data: { visitorId: b.id } }),
  ).rejects.toBeDefined();
  expect((await h.db.chatSession.findUniqueOrThrow({ where: { id: chat.id } })).adminId).toBe(
    h.admin.id,
  );
});
it('rejects publication pointers in generic API payloads and unverified callers', async () => {
  const { p, fields } = await draft();
  const url = `/api/v1/admin/personas/${p.id}`;
  expect(
    (
      await h.app.inject({
        method: 'PUT',
        url,
        headers: { origin: h.origin },
        payload: { ...fields, expectedRevision: 1, publishedVersionId: p.draftVersionId },
      })
    ).statusCode,
  ).toBe(401);
  for (const extra of [
    { publishedVersionId: p.draftVersionId },
    { publishedSlug: p.slug },
    { status: 'published' },
  ])
    expect(
      (
        await h.app.inject({
          method: 'PUT',
          url,
          headers,
          payload: { ...fields, expectedRevision: 1, ...extra },
        })
      ).statusCode,
    ).toBe(400);
  expect(
    (await h.db.persona.findUniqueOrThrow({ where: { id: p.id } })).publishedVersionId,
  ).toBeNull();
});
it('requires an explicit DB publication intent and does not leak it after commit or rollback', async () => {
  const { p } = await draft();
  await expect(
    h.db.persona.update({
      where: { id: p.id },
      data: { status: 'published', publishedVersionId: p.draftVersionId, publishedSlug: p.slug },
    }),
  ).rejects.toBeDefined();
  expect((await publish(p)).statusCode).toBe(200);
  await expect(
    h.db.persona.update({ where: { id: p.id }, data: { status: 'draft' } }),
  ).rejects.toBeDefined();
  await expect(
    h.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('personaverse.publication_action', 'unpublish', true)`;
      await tx.persona.update({ where: { id: p.id }, data: { status: 'draft' } });
      throw new Error('TEST ROLLBACK');
    }),
  ).rejects.toThrow('TEST ROLLBACK');
  expect((await h.db.persona.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('published');
  await expect(
    h.db.persona.update({ where: { id: p.id }, data: { status: 'draft' } }),
  ).rejects.toBeDefined();
  expect(
    (
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/personas/${p.id}/unpublish`,
        headers,
        payload: { expectedRevision: 2 },
      })
    ).statusCode,
  ).toBe(200);
});
it('rejects mismatched slugs, null pointers and cross-persona versions even with trusted DB intent', async () => {
  const { p } = await draft(),
    other = await draft();
  for (const data of [
    { status: 'published', publishedVersionId: p.draftVersionId, publishedSlug: 'wrong-slug' },
    { status: 'published', publishedVersionId: p.draftVersionId, publishedSlug: null },
    { status: 'published', publishedVersionId: null, publishedSlug: p.slug },
    { status: 'published', publishedVersionId: other.p.draftVersionId, publishedSlug: p.slug },
  ])
    await expect(
      h.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('personaverse.publication_action', 'publish', true)`;
        await tx.persona.update({ where: { id: p.id }, data });
      }),
    ).rejects.toBeDefined();
  expect((await h.db.persona.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('draft');
});
it('rejects malformed published snapshots without changing author source', async () => {
  const { p } = await draft();
  for (const [index, extra] of [
    { slug: 12 },
    { categoryIds: ['not-a-uuid'] },
    { tags: [12] },
    { avatarUrl: null },
  ].entries()) {
    const snapshot = {
      name: 'TEST',
      slug: p.slug,
      summary: 'TEST',
      background: 'TEST',
      avatarUrl: '',
      tags: [],
      categoryIds: [randomUUID()],
      ...extra,
    };
    const version = await h.db.personaCoreVersion.create({
      data: {
        personaId: p.id,
        versionNumber: index + 2,
        coreText: '  ORIGINAL  ',
        openingMessage: 'TEST',
        profileSnapshot: snapshot,
        createdBy: h.admin.id,
      },
    });
    await expect(
      h.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('personaverse.publication_action', 'publish', true)`;
        await tx.persona.update({
          where: { id: p.id },
          data: { status: 'published', publishedVersionId: version.id, publishedSlug: p.slug },
        });
      }),
    ).rejects.toBeDefined();
    expect(
      (await h.db.personaCoreVersion.findUniqueOrThrow({ where: { id: version.id } })).coreText,
    ).toBe('  ORIGINAL  ');
  }
});
it('binds publishing to the confirmed version and accepts only one simultaneous publish', async () => {
  const { p } = await draft();
  const url = `/api/v1/admin/personas/${p.id}/publish`;
  const wrong = await h.app.inject({
    method: 'POST',
    url,
    headers,
    payload: { expectedRevision: p.revision, expectedVersionId: randomUUID() },
  });
  expect(wrong.statusCode).toBe(409);
  expect(wrong.json().error.code).toBe('PUBLISH_VERSION_CONFLICT');
  const responses = await Promise.all([publish(p), publish(p)]);
  expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(await h.db.adminAuditLog.count({ where: { action: 'publish', objectId: p.id } })).toBe(1);
});
it('rolls back revision, publication and audit on a published-slug conflict', async () => {
  const { p, fields } = await draft();
  expect((await publish(p)).statusCode).toBe(200);
  const changed = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/personas/${p.id}`,
    headers,
    payload: { ...fields, slug: 'new-' + randomUUID(), expectedRevision: 2 },
  });
  expect(changed.statusCode).toBe(200);
  const second = await draft();
  const saved = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/personas/${second.p.id}`,
    headers,
    payload: { ...second.fields, slug: fields.slug, expectedRevision: 1 },
  });
  expect(saved.statusCode).toBe(200);
  const result = await publish(saved.json());
  expect(result.statusCode).toBe(409);
  const after = await h.db.persona.findUniqueOrThrow({ where: { id: second.p.id } });
  expect(after.revision).toBe(2);
  expect(after.status).toBe('draft');
  expect(after.publishedVersionId).toBeNull();
  expect(
    await h.db.adminAuditLog.count({ where: { action: 'publish', objectId: second.p.id } }),
  ).toBe(0);
  expect((await h.app.inject('/api/v1/personas/' + fields.slug)).json().persona.name).toBe(
    fields.name,
  );
});
it('rejects a saved empty core at publication rather than filling or rewriting it', async () => {
  const { p, fields } = await draft();
  const res = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/personas/${p.id}`,
    headers,
    payload: { ...fields, coreText: ' \n ', expectedRevision: 1 },
  });
  expect(res.statusCode).toBe(200);
  const result = await publish(res.json());
  expect(result.statusCode).toBe(400);
  expect(result.json().error.code).toBe('PUBLISH_INCOMPLETE');
  expect(
    (await h.db.personaCoreVersion.findUniqueOrThrow({ where: { id: res.json().draftVersionId } }))
      .coreText,
  ).toBe(' \n ');
});
