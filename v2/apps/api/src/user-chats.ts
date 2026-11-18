import { BudgetEngine, AiError } from './ai/engine.ts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fail } from './errors.ts';
import type { userAuthService } from './user-auth.ts';
import { resourceGate } from './ai/resources.ts';
import { chatAllowance, activityFingerprint } from './chat-allowance.ts';
type Tx = Prisma.TransactionClient;
const pageInput = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
const messageInput = z
  .object({
    clientMessageId: z.string().uuid(),
    content: z
      .string()
      .min(1)
      .max(4000)
      .refine((s) => !!s.trim()),
  })
  .strict();
const profile = z.object({
  name: z.string().default('历史人格'),
  slug: z.string().default('unavailable'),
});
const idOf = (req: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(req.params).id;
// Delete bodies, not the financial identity graph. Requires the narrow 0007 privacy guard.
export async function eraseChat(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "ChatSession" WHERE id=${id}::uuid FOR UPDATE`;
  await tx.chatSession.update({ where: { id }, data: { status: 'closed', deletedAt: new Date() } });
  await tx.$executeRaw`SELECT set_config('personaverse.privacy_action','erase',true)`;
  await tx.chatRequest.updateMany({
    where: {
      sessionId: id,
      OR: [{ inputText: { not: '' } }, { response: { not: Prisma.DbNull } }],
    },
    data: { inputText: '', response: Prisma.DbNull },
  });
  await tx.chatMessage.deleteMany({ where: { sessionId: id } });
}
export function userChatRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  auth: ReturnType<typeof userAuthService>,
  clock: () => number = Date.now,
  engine?: BudgetEngine,
  requireRealChat = false,
) {
  const allowance = chatAllowance(clock, engine ? 'deepseek' : 'mock');
  const base = '/api/v1/me';
  async function owned(tx: Tx, userId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM "ChatSession" WHERE id=${id}::uuid AND "userId"=${userId}::uuid FOR UPDATE`;
    return (
      (await tx.chatSession.findFirst({
        where: { id, userId, deletedAt: null },
        include: {
          persona: { select: { status: true, isTest: true } },
          coreVersion: { select: { profileSnapshot: true } },
        },
      })) ?? fail(404, 'CHAT_NOT_FOUND', '会话不存在。')
    );
  }
  async function dto(tx: Tx, userId: string, id: string, before?: number, limit = 100) {
    const c = await owned(tx, userId, id);
    const info = profile.parse(c.coreVersion.profileSnapshot);
    const rows = await tx.chatMessage.findMany({
      where: { sessionId: id, ...(before ? { sequence: { lt: before } } : {}) },
      orderBy: { sequence: 'desc' },
      take: limit + 1,
    });
    const more = rows.length > limit;
    const selected = rows.slice(0, limit).reverse();
    return {
      id: c.id,
      personaSlug: info.slug,
      personaName: info.name,
      coreVersionId: c.coreVersionId,
      mode: engine ? ('deepseek' as const) : ('mock' as const),
      canSend: c.status === 'active' && c.persona.status === 'published' && !c.persona.isTest,
      messages: selected.map((m) => ({
        id: m.id,
        clientMessageId: m.clientMessageId,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
      pagination: { hasMore: more, nextBefore: more ? selected[0]!.sequence : null },
    };
  }
  app.get(base + '/chats', async (req) => {
    const s = await auth.requireUser(req);
    const q = pageInput.parse(req.query);
    return db.$transaction(async (tx) => {
      await auth.lockCurrent(tx, s);
      const where = { userId: s.userId, deletedAt: null };
      const [total, rows] = await Promise.all([
        tx.chatSession.count({ where }),
        tx.chatSession.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.limit,
          take: q.limit,
          select: {
            id: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            coreVersion: { select: { profileSnapshot: true } },
          },
        }),
      ]);
      return {
        page: q.page,
        limit: q.limit,
        total,
        items: rows.map((r) => {
          const p = profile.parse(r.coreVersion.profileSnapshot);
          return {
            id: r.id,
            personaSlug: p.slug,
            personaName: p.name,
            status: r.status,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          };
        }),
      };
    });
  });
  app.get(base + '/chat-allowance', async (req) => {
    const s = await auth.requireUser(req);
    return db.$transaction(async (tx) => {
      await auth.lockCurrent(tx, s);
      return allowance.status(tx, s.userId, s.id);
    });
  });
  app.post(base + '/chats/:id/activity', async (req) => {
    const s = await auth.requireUser(req, true),
      id = idOf(req);
    const body = z
      .object({
        eventId: z.string().uuid(),
        action: z.enum(['start', 'activity', 'heartbeat', 'pause']),
        leaseId: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);
    return db.$transaction(async (tx) => {
      await auth.lockCurrent(tx, s);
      const c = await owned(tx, s.userId, id);
      const fingerprint = activityFingerprint([s.id, id, body.action, body.leaseId]);
      const prior = await tx.chatActivityEvent.findUnique({
        where: { userId_eventId: { userId: s.userId, eventId: body.eventId } },
      });
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          fail(409, 'IDEMPOTENCY_CONFLICT', '活动请求ID已用于其他操作。');
        return prior.response;
      }
      if (
        body.action !== 'pause' &&
        (c.status !== 'active' || c.persona.status !== 'published' || c.persona.isTest)
      )
        fail(409, 'PERSONA_UNAVAILABLE', '会话已关闭或人格已下架。');
      await resourceGate(tx, 'user:' + s.userId, req.ip, 'message', false);
      const response = await allowance.activity(tx, s.userId, s.id, id, body.action, body.leaseId);
      await tx.chatActivityEvent.create({
        data: { userId: s.userId, eventId: body.eventId, fingerprint, response },
      });
      return response;
    });
  });
  app.post(base + '/chats', async (req) => {
    const s = await auth.requireUser(req, true);
    const body = z
      .object({ personaSlug: z.string().min(1).max(80), clientRequestId: z.string().uuid() })
      .strict()
      .parse(req.body);
    return db.$transaction(async (tx) => {
      await auth.lockCurrent(tx, s);
      const prior = await tx.chatSession.findUnique({
        where: { userId_creationKey: { userId: s.userId, creationKey: body.clientRequestId } },
        include: { coreVersion: { select: { profileSnapshot: true } } },
      });
      if (prior) {
        if (prior.deletedAt) fail(409, 'CHAT_DELETED', '该请求对应的记录已删除，请新建会话。');
        if (profile.parse(prior.coreVersion.profileSnapshot).slug !== body.personaSlug)
          fail(409, 'IDEMPOTENCY_CONFLICT', '请求 ID 已用于其他人格。');
        return dto(tx, s.userId, prior.id);
      }
      const p =
        (await tx.persona.findFirst({
          where: { publishedSlug: body.personaSlug, status: 'published', isTest: false },
        })) ?? fail(404, 'PERSONA_NOT_FOUND', '人格不可用。');
      await tx.$queryRaw`SELECT id FROM "Persona" WHERE id=${p.id}::uuid FOR SHARE`;
      const current = await tx.persona.findUniqueOrThrow({ where: { id: p.id } });
      if (
        current.publishedSlug !== body.personaSlug ||
        current.status !== 'published' ||
        current.isTest ||
        !current.publishedVersionId
      )
        fail(404, 'PERSONA_NOT_FOUND', '人格不可用。');
      if (
        (await tx.chatSession.count({
          where: { userId: s.userId, deletedAt: null, status: 'active' },
        })) >= 500
      )
        fail(429, 'SESSION_LIMIT', '活动会话已达安全上限。');
      await resourceGate(tx, 'user:' + s.userId, req.ip, 'session', false);
      const c = await tx.chatSession.create({
        data: {
          userId: s.userId,
          personaId: current.id,
          coreVersionId: current.publishedVersionId,
          creationKey: body.clientRequestId,
        },
      });
      return dto(tx, s.userId, c.id);
    });
  });
  app.get(base + '/chats/:id', async (req) => {
    const s = await auth.requireUser(req);
    const q = z
      .object({
        before: z.coerce.number().int().positive().max(2147483647).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(100),
      })
      .strict()
      .parse(req.query);
    return db.$transaction(async (tx) => {
      await auth.lockCurrent(tx, s);
      return dto(tx, s.userId, idOf(req), q.before, q.limit);
    });
  });
  app.post(base + '/chats/:id/messages', async (req) => {
    const s = await auth.requireUser(req, true);
    const id = idOf(req),
      body = messageInput.parse(req.body);
    if (engine) {
      let result;
      try {
        result = await engine.runDeepSeek(
          { kind: 'user', id: s.userId, sessionId: s.id, authVersion: s.authVersion, ip: req.ip },
          id,
          body.clientMessageId,
          body.content,
        );
      } catch (e) {
        if (e instanceof AiError)
          fail(
            e.code.includes('LIMIT') || e.code.includes('EXHAUSTED') ? 429 : 409,
            e.code,
            'AI请求被安全策略拒绝，请检查额度或稍后查看记录。',
          );
        throw e;
      }
      if (result.status !== 'succeeded')
        fail(
          409,
          result.status === 'unknown'
            ? 'AI_OUTCOME_UNKNOWN'
            : 'AI_REQUEST_' + result.status.toUpperCase(),
          '请求尚未完成或结果待核对，请勿更换消息ID重复发送。',
        );
      return db.$transaction(async (tx) => {
        await auth.lockCurrent(tx, s);
        return dto(tx, s.userId, id);
      });
    }
    if (requireRealChat) fail(503, 'AI_DISABLED', 'AI服务尚未配置。');
    if (body.content === '/fail-once') {
      const c =
        (await db.chatSession.findFirst({ where: { id, userId: s.userId, deletedAt: null } })) ??
        fail(404, 'CHAT_NOT_FOUND', '会话不存在。');
      const key = 'user-fail-once:' + c.id + ':' + body.clientMessageId;
      const created = await db.$queryRaw<
        { count: number }[]
      >`INSERT INTO "AiRateBucket"(key,count,"expiresAt") VALUES (${key},1,${new Date(Date.now() + 86400000)}) ON CONFLICT(key) DO NOTHING RETURNING count`;
      if (created.length) fail(503, 'MOCK_TEMPORARY_FAILURE', '模拟请求失败，可以重试。', true);
    }
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AiControl" WHERE id='global' FOR UPDATE`;
      await auth.lockCurrent(tx, s);
      const c = await owned(tx, s.userId, id);
      if (c.status !== 'active') fail(409, 'CHAT_CLOSED', '会话已关闭。');
      await tx.$queryRaw`SELECT id FROM "Persona" WHERE id=${c.personaId}::uuid FOR SHARE`;
      const p = await tx.persona.findUniqueOrThrow({ where: { id: c.personaId } });
      if (p.status !== 'published' || p.isTest)
        fail(409, 'PERSONA_UNAVAILABLE', '人格已下架，历史仍可查看。');
      const prior = await tx.chatMessage.findFirst({
        where: { sessionId: id, clientMessageId: body.clientMessageId, role: 'user' },
      });
      if (prior) {
        if (prior.content !== body.content)
          fail(409, 'IDEMPOTENCY_CONFLICT', '消息 ID 已用于不同内容。');
        return dto(tx, s.userId, id);
      }
      if (
        await tx.chatRequest.count({
          where: { sessionId: id, status: { in: ['reserved', 'running', 'unknown'] } },
        })
      )
        fail(409, 'SESSION_BUSY', '会话有待处理请求。');
      await resourceGate(tx, 'user:' + s.userId, req.ip, 'message', false);
      const control = await tx.aiControl.findUniqueOrThrow({ where: { id: 'global' } });
      if (control.circuitOpen) fail(503, 'AI_CIRCUIT_OPEN', '全站费用安全熔断已开启。');
      const last = await tx.chatMessage.aggregate({
        where: { sessionId: id },
        _max: { sequence: true },
        _count: true,
      });
      if (last._count >= 1000) fail(429, 'HISTORY_LIMIT', '当前会话已达安全上限，请新建会话。');
      const sequence = last._max.sequence ?? 0;
      const core = await tx.personaCoreVersion.findUniqueOrThrow({
        where: { id: c.coreVersionId },
      });
      const history = await tx.chatMessage.findMany({
        where: { sessionId: id },
        select: { content: true },
      });
      const reply = '模拟回复 · 尚未接入真实 AI。本条仅验证个人记录持久化。';
      const tokenEstimate =
        Buffer.byteLength(
          core.coreText +
            core.openingMessage +
            history.map((m) => m.content).join('') +
            body.content +
            reply,
          'utf8',
        ) +
        128 +
        (history.length + 2) * 32;
      await allowance.consume(tx, s.userId, s.id, id, tokenEstimate);
      await tx.chatMessage.createMany({
        data: [
          {
            sessionId: id,
            sequence: sequence + 1,
            clientMessageId: body.clientMessageId,
            role: 'user',
            content: body.content,
          },
          {
            sessionId: id,
            sequence: sequence + 2,
            clientMessageId: body.clientMessageId,
            role: 'assistant',
            content: reply,
          },
        ],
      });
      await tx.chatSession.update({ where: { id }, data: { updatedAt: new Date() } });
      return dto(tx, s.userId, id);
    });
  });
  app.post(base + '/chats/:id/ai-requests', async (req) => {
    const s = await auth.requireUser(req, true);
    await db.$transaction(async (tx) => {
      await auth.lockCurrent(tx, s);
      await owned(tx, s.userId, idOf(req));
    });
    fail(503, 'AI_DISABLED', '真实 AI 未接入，费用功能默认关闭。');
  });
  app.post(base + '/chats/:id/close', async (req) => {
    const s = await auth.requireUser(req, true);
    return db.$transaction(async (tx) => {
      await auth.lockCurrent(tx, s);
      const c = await owned(tx, s.userId, idOf(req));
      await tx.chatSession.update({ where: { id: c.id }, data: { status: 'closed' } });
      return { closed: true };
    });
  });
  app.delete(base + '/chats/:id', async (req) => {
    const s = await auth.requireUser(req, true);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AiControl" WHERE id='global' FOR UPDATE`;
      await auth.lockCurrent(tx, s);
      const c = await owned(tx, s.userId, idOf(req));
      await eraseChat(tx, c.id);
      return { deleted: true };
    });
  });
  const favoritePersona = async (slug: string) =>
    (await db.persona.findFirst({
      where: { publishedSlug: slug, status: 'published', isTest: false },
      include: { publishedVersion: { select: { profileSnapshot: true } } },
    })) ?? fail(404, 'PERSONA_NOT_FOUND', '人格不可用。');
  app.get(base + '/favorites', async (req) => {
    const s = await auth.requireUser(req),
      q = pageInput.parse(req.query);
    const where = { userId: s.userId, persona: { status: 'published', isTest: false } };
    const [total, rows, cats] = await Promise.all([
      db.userFavorite.count({ where }),
      db.userFavorite.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { personaId: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          persona: { include: { publishedVersion: { select: { profileSnapshot: true } } } },
        },
      }),
      db.category.findMany(),
    ]);
    return {
      page: q.page,
      limit: q.limit,
      total,
      items: rows.map((r) => {
        const p = z
          .object({
            name: z.string(),
            slug: z.string(),
            summary: z.string(),
            background: z.string(),
            avatarUrl: z.string(),
            tags: z.array(z.string()),
            categoryIds: z.array(z.string()),
          })
          .parse(r.persona.publishedVersion?.profileSnapshot);
        return {
          id: r.personaId,
          slug: p.slug,
          name: p.name,
          summary: p.summary,
          background: p.background,
          avatarUrl: p.avatarUrl,
          tags: p.tags,
          mock: false,
          category: cats.find((c) => p.categoryIds.includes(c.id))?.name ?? '',
        };
      }),
    };
  });
  for (const method of ['get', 'put', 'delete'] as const)
    app[method](base + '/favorites/:slug', async (req) => {
      const s = await auth.requireUser(req, method !== 'get');
      const slug = z.object({ slug: z.string().max(80) }).parse(req.params).slug;
      const p = await favoritePersona(slug);
      if (method === 'get')
        return {
          saved: !!(await db.userFavorite.findUnique({
            where: { userId_personaId: { userId: s.userId, personaId: p.id } },
          })),
        };
      return db.$transaction(async (tx) => {
        await auth.lockCurrent(tx, s);
        if (method === 'put')
          await tx.userFavorite.upsert({
            where: { userId_personaId: { userId: s.userId, personaId: p.id } },
            create: { userId: s.userId, personaId: p.id },
            update: {},
          });
        else await tx.userFavorite.deleteMany({ where: { userId: s.userId, personaId: p.id } });
        return { saved: method === 'put' };
      });
    });
  app.delete(base, async (req, reply) => {
    const s = await auth.requireUser(req, true);
    const body = z
      .object({ password: z.string().min(1).max(256) })
      .strict()
      .parse(req.body);
    const u = await db.user.findUniqueOrThrow({ where: { id: s.userId } });
    await auth.confirmPassword(req, s, body.password);
    const result = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "AiControl" WHERE id='global' FOR UPDATE`;
        await auth.lockCurrent(tx, s);
        const current = await tx.user.findUniqueOrThrow({ where: { id: s.userId } });
        if (current.passwordHash !== u.passwordHash)
          fail(409, 'CREDENTIAL_CONFLICT', '凭据已变化。');
        const chats = await tx.chatSession.findMany({
          where: { userId: s.userId, deletedAt: null },
          orderBy: { id: 'asc' },
          select: { id: true },
        });
        for (const c of chats) await eraseChat(tx, c.id);
        await tx.userFavorite.deleteMany({ where: { userId: s.userId } });
        await tx.userSession.updateMany({
          where: { userId: s.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.emailVerification.updateMany({
          where: { userId: s.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.passwordReset.updateMany({
          where: { userId: s.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.user.update({
          where: { id: s.userId },
          data: {
            email: 'deleted-' + randomUUID() + '@deleted.invalid',
            displayName: '',
            emailVerifiedAt: null,
            passwordHash: '!deleted',
            status: 'deleted',
            authVersion: { increment: 1 },
          },
        });
        return { deleted: true };
      },
      { timeout: 20000 },
    );
    auth.clearCookie(reply);
    return result;
  });
}
