import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { SendMessage } from '../../../packages/shared/src/index.ts';
import { fail } from './errors.ts';
import { secretHash, type authService } from './auth.ts';
import type { DatabaseConfig } from './config.ts';
export function chatRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  auth: ReturnType<typeof authService>,
  config: DatabaseConfig,
) {
  const visitorCookie = config.secure ? '__Host-pv_v2_visitor' : 'pv_v2_visitor_local';
  const once = new Set<string>();
  async function visitor(req: FastifyRequest) {
    const raw = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(visitorCookie + '='))
      ?.slice(visitorCookie.length + 1);
    const v =
      raw && /^[a-f0-9]{64}$/.test(raw)
        ? await db.visitorSession.findUnique({ where: { tokenHash: secretHash(raw) } })
        : null;
    if (!v || v.revokedAt || v.expiresAt.getTime() <= Date.now())
      fail(401, 'VISITOR_SESSION_REQUIRED', '访客会话已失效。');
    return v;
  }
  const id = (req: FastifyRequest) => z.object({ id: z.string().uuid() }).parse(req.params).id;
  const dto = async (sessionId: string) => {
    const s = await db.chatSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { persona: true, messages: { orderBy: { sequence: 'asc' } } },
    });
    return {
      id: s.id,
      personaSlug: s.persona.publishedSlug ?? s.persona.slug,
      coreVersionId: s.coreVersionId,
      mode: 'mock',
      messages: s.messages.map((m) => ({
        id: m.id,
        clientMessageId: m.clientMessageId,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  };
  async function owned(req: FastifyRequest, admin: boolean) {
    const owner = admin
      ? (await auth.requireAdmin(req, req.method === 'POST')).adminId
      : (await visitor(req)).id;
    const s =
      (await db.chatSession.findFirst({
        where: { id: id(req), ...(admin ? { adminId: owner } : { visitorId: owner }) },
        include: { persona: true },
      })) ?? fail(404, 'CHAT_NOT_FOUND', '会话不存在。');
    if (!admin && (s.persona.status !== 'published' || s.persona.isTest))
      fail(404, 'PERSONA_NOT_FOUND', '人格未发布。');
    return s;
  }
  app.post('/api/v1/visitor/session', async (req, reply) => {
    z.object({}).strict().parse(req.body);
    try {
      await visitor(req);
      return { mode: 'mock', ready: true };
    } catch (e) {
      if (!(e instanceof Error && 'status' in e && e.status === 401)) throw e;
    }
    const raw = randomBytes(32).toString('hex');
    await db.visitorSession.create({
      data: { tokenHash: secretHash(raw), expiresAt: new Date(Date.now() + 86400000) },
    });
    reply.header(
      'Set-Cookie',
      `${visitorCookie}=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${config.secure ? '; Secure' : ''}`,
    );
    return { mode: 'mock', ready: true };
  });
  app.post('/api/v1/chat/sessions', async (req) => {
    const v = await visitor(req),
      body = z
        .object({ personaSlug: z.string().max(80) })
        .strict()
        .parse(req.body);
    const p =
      (await db.persona.findFirst({
        where: { publishedSlug: body.personaSlug, status: 'published', isTest: false },
      })) ?? fail(404, 'PERSONA_NOT_FOUND', '人格未发布。');
    if (!p.publishedVersionId) fail(404, 'PERSONA_NOT_FOUND', '人格未发布。');
    if ((await db.chatSession.count({ where: { visitorId: v.id } })) >= 50)
      fail(429, 'SESSION_LIMIT', '请清除旧会话。');
    const s = await db.chatSession.create({
      data: { personaId: p.id, coreVersionId: p.publishedVersionId, visitorId: v.id },
    });
    return dto(s.id);
  });
  app.post('/api/v1/admin/test/sessions', async (req) => {
    const s = await auth.requireAdmin(req, true);
    const body = z
      .object({ personaId: z.string().uuid(), versionId: z.string().uuid() })
      .strict()
      .parse(req.body);
    if (
      !(await db.personaCoreVersion.findFirst({
        where: { id: body.versionId, personaId: body.personaId },
      }))
    )
      fail(404, 'VERSION_NOT_FOUND', '测试版本不存在。');
    const chat = await db.$transaction(async (tx) => {
      const c = await tx.chatSession.create({
        data: { personaId: body.personaId, coreVersionId: body.versionId, adminId: s.adminId },
      });
      await tx.adminAuditLog.create({
        data: {
          adminId: s.adminId,
          action: 'test-version',
          objectType: 'persona',
          objectId: body.personaId,
          requestId: req.id,
          changeSummary: { versionId: body.versionId, chatId: c.id },
        },
      });
      return c;
    });
    return dto(chat.id);
  });
  for (const admin of [false, true]) {
    const prefix = admin ? '/api/v1/admin/test/sessions' : '/api/v1/chat/sessions';
    app.get(prefix + '/:id/messages', async (req) => dto((await owned(req, admin)).id));
    app.post(prefix + '/:id/messages', async (req) => {
      const session = await owned(req, admin),
        body = SendMessage.parse(req.body);
      const failureKey = session.id + body.clientMessageId;
      if (body.content === '/fail-once' && !once.has(failureKey)) {
        if (once.size > 10000) once.clear();
        once.add(failureKey);
        fail(503, 'MOCK_TEMPORARY_FAILURE', '模拟请求失败，可重试。', true);
      }
      await db.$transaction(
        async (tx) => {
          // NOWAIT rejects concurrent work instead of leaving stuck locks. Transaction releases on failure.
          await tx.$queryRaw`SELECT id FROM "ChatSession" WHERE id=${session.id}::uuid FOR UPDATE NOWAIT`;
          const prior = await tx.chatMessage.findFirst({
            where: { sessionId: session.id, clientMessageId: body.clientMessageId, role: 'user' },
          });
          if (prior) {
            if (prior.content !== body.content)
              fail(409, 'IDEMPOTENCY_CONFLICT', '消息 ID 已用于不同内容。');
            return;
          }
          const count = await tx.chatMessage.count({ where: { sessionId: session.id } });
          if (!admin && count >= 1000) fail(429, 'HISTORY_LIMIT', '演示记录已满。');
          await tx.chatMessage.createMany({
            data: [
              {
                sessionId: session.id,
                sequence: count + 1,
                clientMessageId: body.clientMessageId,
                role: 'user',
                content: body.content,
              },
              {
                sessionId: session.id,
                sequence: count + 2,
                clientMessageId: body.clientMessageId,
                role: 'assistant',
                content: '模拟回复 · 未接入真实 AI。会话固定绑定所选内核版本，不调用收费模型。',
              },
            ],
          });
        },
        { timeout: 10000 },
      );
      return dto(session.id);
    });
  }
  app.delete('/api/v1/chat/sessions', async (req) => {
    const v = await visitor(req);
    await db.chatSession.deleteMany({ where: { visitorId: v.id } });
    return { mode: 'mock', cleared: true };
  });
}
