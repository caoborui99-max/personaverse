import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { authService } from '../auth.ts';
import { secretHash } from '../auth.ts';
import { fail } from '../errors.ts';
import { BudgetEngine, AiError } from './engine.ts';
import { FakeProvider } from './fake-provider.ts';
export function budgetRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  auth: ReturnType<typeof authService>,
  allowFake = false,
  secure = false,
) {
  const engine = new BudgetEngine(db, { allowFake });
  for (const admin of [false, true]) {
    const prefix = admin ? '/api/v1/admin/test/sessions' : '/api/v1/chat/sessions';
    app.post(prefix + '/:id/ai-requests', async (req: FastifyRequest) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      let actor;
      if (admin) {
        const s = await auth.requireAdmin(req, true);
        actor = { kind: 'admin' as const, id: s.adminId, ip: req.ip };
      } else {
        const raw = req.headers.cookie
          ?.split(';')
          .map((s) => s.trim())
          .find((s) =>
            s.startsWith((secure ? '__Host-pv_v2_visitor' : 'pv_v2_visitor_local') + '='),
          )
          ?.split('=')[1];
        const v = raw
          ? await db.visitorSession.findUnique({ where: { tokenHash: secretHash(raw) } })
          : null;
        if (!v || v.revokedAt || v.expiresAt.getTime() <= Date.now())
          fail(401, 'VISITOR_SESSION_REQUIRED', '访客会话无效。');
        actor = { kind: 'visitor' as const, id: v.id, ip: req.ip };
      }
      const body = z
        .object({
          clientMessageId: z.string().uuid(),
          content: z.string().min(1).max(4000),
          maxOutputTokens: z.number().int().min(1).max(4096),
        })
        .strict()
        .parse(req.body);
      try {
        const r = await engine.runFake(
          actor,
          id,
          body.clientMessageId,
          body.content,
          body.maxOutputTokens,
          new FakeProvider(),
        );
        return { requestId: r.id, status: r.status, result: r.response, simulated: true };
      } catch (e) {
        if (e instanceof AiError)
          fail(e.code === 'AI_DISABLED' ? 503 : 409, e.code, '模拟费用安全策略拒绝请求。');
        throw e;
      }
    });
  }
}
