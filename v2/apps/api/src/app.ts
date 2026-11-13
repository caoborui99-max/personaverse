import Fastify from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ChatSession,
  CreateSession,
  SendMessage,
  fixtures,
} from '../../../packages/shared/src/index.ts';
class Failure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
type Visitor = {
  expires: number;
  sessions: Map<string, ChatSession>;
  calls: number;
  bucket: number;
};
export function buildApp(options: { origin?: string; clock?: () => number } = {}) {
  const app = Fastify({
    logger: false,
    bodyLimit: 16_384,
    requestTimeout: 20_000,
    trustProxy: false,
  });
  const origin = options.origin ?? 'http://127.0.0.1:4310';
  const clock = options.clock ?? Date.now;
  const visitors = new Map<string, Visitor>();
  const failedOnce = new Set<string>();
  function fail(status: number, code: string, message: string, retryable = false): never {
    throw new Failure(status, code, message, retryable);
  }
  function prune() {
    for (const [token, v] of visitors) if (v.expires <= clock()) visitors.delete(token);
  }
  function identity(cookie: string | undefined) {
    prune();
    const token = cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('pv_v2_mock='))
      ?.slice(11);
    const visitor = token ? visitors.get(token) : undefined;
    if (!visitor) fail(401, 'VISITOR_SESSION_REQUIRED', '演示会话已过期，请重新连接。');
    return visitor;
  }
  app.setErrorHandler((error, req, reply) => {
    const known = error instanceof Failure;
    const validation = error instanceof z.ZodError;
    const native = z.object({ statusCode: z.number().int().min(400).max(499) }).safeParse(error);
    const status = known
      ? error.status
      : validation
        ? 400
        : native.success
          ? native.data.statusCode
          : 500;
    reply.code(status).send({
      error: {
        code: known
          ? error.code
          : validation
            ? 'INVALID_INPUT'
            : status < 500
              ? 'INVALID_REQUEST'
              : 'INTERNAL_ERROR',
        message: known ? error.message : validation ? '请求参数格式错误。' : '请求暂时无法完成。',
        requestId: req.id,
        retryable: known ? error.retryable : status >= 500,
      },
    });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: '接口不存在。', requestId: req.id, retryable: false },
    }),
  );
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin !== origin) fail(403, 'ORIGIN_REJECTED', '请求来源无效。');
      if (req.headers['sec-fetch-site'] === 'cross-site')
        fail(403, 'ORIGIN_REJECTED', '请求来源无效。');
    }
    // Every admin path is denied, including unknown subroutes and forged client roles.
    const path = req.url.split('?')[0] ?? '';
    if (path === '/api/v1/admin' || path.startsWith('/api/v1/admin/')) {
      if (path === '/api/v1/admin/auth/login' && req.method === 'POST')
        fail(503, 'AUTH_NOT_IMPLEMENTED', '真实管理员认证尚未实现。');
      fail(401, 'ADMIN_REQUIRED', '需要服务端验证的管理员会话。');
    }
  });
  app.get('/api/v1/health', async () => ({
    status: 'ok',
    mode: 'mock',
    database: 'not-connected',
    ai: 'not-connected',
    auth: 'not-implemented',
  }));
  app.get('/api/v1/categories', async () => ({
    mode: 'mock',
    items: [...new Set(fixtures.map((p) => p.category))],
  }));
  app.get('/api/v1/personas', async (req) => {
    const query = z
      .object({
        q: z.string().max(120).default(''),
        category: z.string().max(80).optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
        limit: z.coerce.number().int().min(1).max(50).default(12),
      })
      .strict()
      .parse(req.query);
    const items = fixtures.filter(
      (p) =>
        (!query.category || p.category === query.category) &&
        (p.name + p.summary).toLowerCase().includes(query.q.toLowerCase()),
    );
    return {
      mode: 'mock',
      items: items.slice((query.page - 1) * query.limit, query.page * query.limit),
      total: items.length,
      page: query.page,
      limit: query.limit,
    };
  });
  app.get('/api/v1/personas/:slug', async (req) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    return {
      mode: 'mock',
      persona:
        fixtures.find((p) => p.slug === slug) ?? fail(404, 'PERSONA_NOT_FOUND', '测试人格不存在。'),
    };
  });
  app.post('/api/v1/visitor/session', async (req, reply) => {
    z.object({}).strict().parse(req.body);
    prune();
    try {
      identity(req.headers.cookie);
      return { mode: 'mock', ready: true };
    } catch (e) {
      if (!(e instanceof Failure && e.status === 401)) throw e;
    }
    if (visitors.size >= 1000) fail(503, 'MOCK_CAPACITY', '演示服务容量已满。', true);
    const token = randomBytes(32).toString('hex');
    visitors.set(token, {
      expires: clock() + 86_400_000,
      sessions: new Map(),
      calls: 0,
      bucket: 0,
    });
    reply.header(
      'Set-Cookie',
      `pv_v2_mock=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${origin.startsWith('https:') ? '; Secure' : ''}`,
    );
    return { mode: 'mock', ready: true };
  });
  app.post('/api/v1/chat/sessions', async (req, reply) => {
    const v = identity(req.headers.cookie);
    const { personaSlug } = CreateSession.parse(req.body);
    if (!fixtures.some((p) => p.slug === personaSlug))
      fail(404, 'PERSONA_NOT_FOUND', '测试人格不存在。');
    if (v.sessions.size >= 50) fail(429, 'MOCK_SESSION_LIMIT', '请先清除演示聊天记录。');
    const session: ChatSession = { id: randomUUID(), personaSlug, messages: [], mode: 'mock' };
    v.sessions.set(session.id, session);
    reply.code(201);
    return session;
  });
  function owned(cookie: string | undefined, params: unknown) {
    const v = identity(cookie);
    const { id } = z.object({ id: z.string().uuid() }).parse(params);
    const session = v.sessions.get(id) ?? fail(404, 'CHAT_NOT_FOUND', '会话不存在或已被清除。');
    return { v, session };
  }
  app.get(
    '/api/v1/chat/sessions/:id/messages',
    async (req) => owned(req.headers.cookie, req.params).session,
  );
  app.post('/api/v1/chat/sessions/:id/messages', async (req, reply) => {
    const { v, session } = owned(req.headers.cookie, req.params);
    const body = SendMessage.parse(req.body);
    const prior = session.messages.find(
      (m) => m.clientMessageId === body.clientMessageId && m.role === 'user',
    );
    if (prior) {
      if (prior.content !== body.content)
        fail(409, 'IDEMPOTENCY_CONFLICT', '消息 ID 已用于不同内容。');
      return session;
    }
    // Explicit, local mock failure scenario. No provider or paid API is involved.
    const failureKey = session.id + ':' + body.clientMessageId;
    if (body.content === '/fail-once' && !failedOnce.has(failureKey)) {
      if (failedOnce.size > 10000) failedOnce.clear();
      failedOnce.add(failureKey);
      fail(503, 'MOCK_TEMPORARY_FAILURE', '模拟请求失败。点击重试可恢复。', true);
    }
    const bucket = Math.floor(clock() / 60000);
    if (v.bucket !== bucket) {
      v.bucket = bucket;
      v.calls = 0;
    }
    if (v.calls >= 120) {
      reply.header('Retry-After', '60');
      fail(429, 'RATE_LIMITED', '演示请求过于频繁。', true);
    }
    if (session.messages.length >= 1000)
      fail(429, 'MOCK_HISTORY_LIMIT', '演示记录已满，请清除后重试。');
    v.calls++;
    const createdAt = new Date(clock()).toISOString();
    session.messages.push(
      {
        id: randomUUID(),
        clientMessageId: body.clientMessageId,
        role: 'user',
        content: body.content,
        createdAt,
      },
      {
        id: randomUUID(),
        clientMessageId: body.clientMessageId,
        role: 'assistant',
        content: `模拟回复 · 第 ${session.messages.length / 2 + 1} 轮。已接收你的消息。本阶段没有连接真实 AI。`,
        createdAt,
      },
    );
    return session;
  });
  app.delete('/api/v1/chat/sessions', async (req) => {
    identity(req.headers.cookie).sessions.clear();
    return { mode: 'mock', cleared: true };
  });
  return app;
}
