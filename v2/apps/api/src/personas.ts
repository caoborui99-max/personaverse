import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DraftFields, SaveDraft, RevisionInput } from '../../../packages/shared/src/index.ts';
import { fail } from './errors.ts';
import type { authService } from './auth.ts';
const idOf = (req: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(req.params).id;
const listQuery = z
  .object({
    q: z.string().max(120).default(''),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    category: z.string().max(80).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(12),
  })
  .strict();
export function personaRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  auth: ReturnType<typeof authService>,
) {
  async function writable(req: FastifyRequest) {
    return auth.requireAdmin(req, true);
  }
  const include = { draftVersion: true, categories: { include: { category: true } } } as const;
  async function get(tx: Prisma.TransactionClient, id: string) {
    return (
      (await tx.persona.findUnique({ where: { id }, include })) ??
      fail(404, 'PERSONA_NOT_FOUND', '人格不存在。')
    );
  }
  async function claim(tx: Prisma.TransactionClient, id: string, revision: number) {
    const changed = await tx.persona.updateMany({
      where: { id, revision },
      data: { revision: { increment: 1 } },
    });
    if (changed.count !== 1) {
      await get(tx, id);
      fail(409, 'EDIT_CONFLICT', '内容已由其他页面修改。请重新加载后合并，当前输入未保存。');
    }
    return get(tx, id);
  }
  async function audit(
    tx: Prisma.TransactionClient,
    adminId: string,
    req: FastifyRequest,
    action: string,
    id: string,
    revision: number,
  ) {
    await tx.adminAuditLog.create({
      data: {
        adminId,
        action,
        objectType: 'persona',
        objectId: id,
        requestId: req.id,
        changeSummary: { revision },
      },
    });
  }
  async function save(
    tx: Prisma.TransactionClient,
    id: string,
    fields: DraftFields,
    revision: number,
    adminId: string,
    req: FastifyRequest,
    restoredFromId?: string,
  ) {
    const current = await claim(tx, id, revision);
    if (current.status === 'archived') fail(409, 'PERSONA_ARCHIVED', '归档人格不可编辑。');
    const categories = [...new Set(fields.categoryIds)];
    if ((await tx.category.count({ where: { id: { in: categories } } })) !== categories.length)
      fail(400, 'INVALID_CATEGORY', '分类不存在。');
    const snapshot = {
      name: fields.name,
      slug: fields.slug,
      summary: fields.summary,
      background: fields.background,
      avatarUrl: fields.avatarUrl,
      tags: fields.tags,
      categoryIds: categories,
    };
    const version = await tx.personaCoreVersion.create({
      data: {
        personaId: id,
        versionNumber: (current.draftVersion?.versionNumber ?? 0) + 1,
        coreText: fields.coreText,
        openingMessage: fields.openingMessage,
        profileSnapshot: snapshot,
        createdBy: adminId,
        restoredFromId,
      },
    });
    await tx.personaCategory.deleteMany({ where: { personaId: id } });
    if (categories.length)
      await tx.personaCategory.createMany({
        data: categories.map((categoryId) => ({ personaId: id, categoryId })),
      });
    await tx.persona.update({
      where: { id },
      data: {
        name: fields.name,
        slug: fields.slug,
        summary: fields.summary,
        background: fields.background,
        avatarUrl: fields.avatarUrl || null,
        tags: fields.tags,
        draftVersionId: version.id,
      },
    });
    await audit(
      tx,
      adminId,
      req,
      restoredFromId ? 'restore-version' : 'save-draft',
      id,
      revision + 1,
    );
    return get(tx, id);
  }
  app.get('/api/v1/admin/categories', async () => ({
    items: await db.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
  }));
  app.post('/api/v1/admin/categories', async (req) => {
    const s = await writable(req);
    const body = z
      .object({
        name: z.string().min(1).max(80),
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .max(80),
      })
      .strict()
      .parse(req.body);
    return db.$transaction(async (tx) => {
      const category = await tx.category.create({ data: body });
      await audit(tx, s.adminId, req, 'create-category', category.id, 0);
      return category;
    });
  });
  app.get('/api/v1/admin/personas', async (req) => {
    const q = listQuery.parse(req.query);
    const where: Prisma.PersonaWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { slug: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(q.category ? { categories: { some: { categoryId: q.category } } } : {}),
    };
    return {
      items: await db.persona.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          revision: true,
          isTest: true,
          updatedAt: true,
          draftVersionId: true,
          publishedVersionId: true,
        },
      }),
      total: await db.persona.count({ where }),
      page: q.page,
      limit: q.limit,
    };
  });
  app.post('/api/v1/admin/personas', async (req, reply) => {
    const s = await writable(req);
    const body = z
      .object({ isTest: z.boolean().default(false) })
      .strict()
      .parse(req.body);
    const id = randomUUID();
    const value = await db.$transaction(async (tx) => {
      const p = await tx.persona.create({
        data: { id, slug: 'draft-' + id, name: '', isTest: body.isTest },
      });
      await audit(tx, s.adminId, req, 'create-draft', p.id, 0);
      return p;
    });
    reply.code(201);
    return value;
  });
  app.get('/api/v1/admin/personas/:id', async (req) => get(db, idOf(req)));
  app.put('/api/v1/admin/personas/:id', async (req) => {
    const s = await writable(req),
      id = idOf(req),
      body = SaveDraft.parse(req.body);
    return db.$transaction((tx) => save(tx, id, body, body.expectedRevision, s.adminId, req));
  });
  app.post('/api/v1/admin/personas/:id/publish', async (req) => {
    const s = await writable(req),
      id = idOf(req),
      body = RevisionInput.parse(req.body);
    return db.$transaction(async (tx) => {
      const p = await claim(tx, id, body.expectedRevision);
      const v = p.draftVersion;
      if (p.isTest || p.status === 'archived')
        fail(400, 'PUBLISH_FORBIDDEN', '测试或归档人格不能发布。');
      if (
        !v ||
        !p.name.trim() ||
        !p.summary.trim() ||
        !p.background.trim() ||
        !v.coreText.trim() ||
        !v.openingMessage.trim() ||
        !p.categories.length
      )
        fail(
          400,
          'PUBLISH_INCOMPLETE',
          '发布前请手动填写名称、简介、背景、分类、完整内核及开场白。',
        );
      await tx.persona.update({
        where: { id },
        data: { status: 'published', publishedVersionId: v.id, publishedSlug: p.slug },
      });
      await audit(tx, s.adminId, req, 'publish', id, body.expectedRevision + 1);
      return get(tx, id);
    });
  });
  for (const [suffix, status] of [
    ['unpublish', 'draft'],
    ['archive', 'archived'],
  ] as const)
    app.post(`/api/v1/admin/personas/:id/${suffix}`, async (req) => {
      const s = await writable(req),
        id = idOf(req),
        body = RevisionInput.parse(req.body);
      return db.$transaction(async (tx) => {
        await claim(tx, id, body.expectedRevision);
        await tx.persona.update({ where: { id }, data: { status } });
        await audit(tx, s.adminId, req, suffix, id, body.expectedRevision + 1);
        return get(tx, id);
      });
    });
  app.get('/api/v1/admin/personas/:id/versions', async (req) => {
    const id = idOf(req);
    await get(db, id);
    return {
      items: await db.personaCoreVersion.findMany({
        where: { personaId: id },
        orderBy: { versionNumber: 'desc' },
        include: { author: { select: { id: true, email: true } } },
      }),
    };
  });
  app.post('/api/v1/admin/personas/:id/restore', async (req) => {
    const s = await writable(req),
      id = idOf(req),
      body = z
        .object({ versionId: z.string().uuid(), expectedRevision: z.number().int().min(0) })
        .strict()
        .parse(req.body);
    return db.$transaction(async (tx) => {
      const v =
        (await tx.personaCoreVersion.findFirst({ where: { id: body.versionId, personaId: id } })) ??
        fail(404, 'VERSION_NOT_FOUND', '版本不存在。');
      const snapshot = z
        .object({
          name: z.string(),
          slug: z.string(),
          summary: z.string(),
          background: z.string(),
          avatarUrl: z.string(),
          tags: z.array(z.string()),
          categoryIds: z.array(z.string()),
        })
        .parse(v.profileSnapshot);
      return save(
        tx,
        id,
        DraftFields.parse({ ...snapshot, coreText: v.coreText, openingMessage: v.openingMessage }),
        body.expectedRevision,
        s.adminId,
        req,
        v.id,
      );
    });
  });
  app.get('/api/v1/admin/personas/:id/compare', async (req) => {
    const id = idOf(req),
      q = z.object({ from: z.string().uuid(), to: z.string().uuid() }).strict().parse(req.query);
    const versions = await db.personaCoreVersion.findMany({
      where: { personaId: id, id: { in: [q.from, q.to] } },
    });
    const from = versions.find((v) => v.id === q.from),
      to = versions.find((v) => v.id === q.to);
    if (!from || !to) fail(404, 'VERSION_NOT_FOUND', '版本不存在。');
    const changedFields = ['coreText', 'openingMessage', 'profileSnapshot'].filter(
      (key) =>
        JSON.stringify(from[key as keyof typeof from]) !==
        JSON.stringify(to[key as keyof typeof to]),
    );
    return { from, to, changedFields };
  });
  // Public catalogue reads only the PUBLISHED snapshot. Saving a draft cannot leak updates.
  const publicRow = (p: Prisma.PersonaGetPayload<{ include: { publishedVersion: true } }>) => {
    const snapshot = z
      .object({
        name: z.string(),
        slug: z.string(),
        summary: z.string(),
        background: z.string(),
        avatarUrl: z.string(),
        tags: z.array(z.string()),
        categoryIds: z.array(z.string()),
      })
      .parse(p.publishedVersion?.profileSnapshot);
    return {
      id: p.id,
      slug: p.publishedSlug ?? snapshot.slug,
      name: snapshot.name,
      summary: snapshot.summary,
      background: snapshot.background,
      avatarUrl: snapshot.avatarUrl,
      tags: snapshot.tags,
      categoryIds: snapshot.categoryIds,
      mock: false,
    };
  };
  app.get('/api/v1/personas', async (req) => {
    const q = listQuery.omit({ status: true }).parse(req.query);
    // Snapshot filtering deliberately avoids draft metadata. Cursor/search indexing can follow at scale.
    const rows = (
      await db.persona.findMany({
        where: { status: 'published', isTest: false },
        include: { publishedVersion: true },
        orderBy: { id: 'asc' },
      })
    ).map(publicRow);
    const cats = await db.category.findMany();
    const items = rows
      .map((p) => ({ ...p, category: cats.find((c) => p.categoryIds.includes(c.id))?.name ?? '' }))
      .filter(
        (p) =>
          (!q.category || p.categoryIds.includes(q.category) || p.category === q.category) &&
          (p.name + p.summary + p.tags.join(' ')).toLowerCase().includes(q.q.toLowerCase()),
      );
    return {
      mode: 'database',
      items: items.slice((q.page - 1) * q.limit, q.page * q.limit),
      total: items.length,
      page: q.page,
      limit: q.limit,
    };
  });
  app.get('/api/v1/personas/:slug', async (req) => {
    const { slug } = z.object({ slug: z.string().max(80) }).parse(req.params);
    const p =
      (await db.persona.findFirst({
        where: { publishedSlug: slug, status: 'published', isTest: false },
        include: { publishedVersion: true },
      })) ?? fail(404, 'PERSONA_NOT_FOUND', '人格不存在或未发布。');
    const row = publicRow(p);
    const category = await db.category.findFirst({ where: { id: { in: row.categoryIds } } });
    return { mode: 'database', persona: { ...row, category: category?.name ?? '' } };
  });
  app.get('/api/v1/categories', async () => {
    const rows = (
      await db.persona.findMany({
        where: { status: 'published', isTest: false },
        include: { publishedVersion: true },
      })
    ).map(publicRow);
    return {
      mode: 'database',
      items: (
        await db.category.findMany({
          where: { id: { in: rows.flatMap((p) => p.categoryIds) } },
          orderBy: { sortOrder: 'asc' },
        })
      ).map((c) => c.name),
    };
  });
}
