import Fastify from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authService } from './auth.ts';
import { personaRoutes } from './personas.ts';
import { chatRoutes } from './chat.ts';
import { ApiFailure, fail } from './errors.ts';
import { databaseConfig, type DatabaseConfig } from './config.ts';
export function buildDatabaseApp(
  options: { config?: DatabaseConfig; db?: PrismaClient; clock?: () => number } = {},
) {
  const config = options.config ?? databaseConfig();
  const db =
    options.db ??
    new PrismaClient({
      datasources: { db: { url: config.databaseUrl } },
      transactionOptions: { timeout: 10000 },
    });
  const app = Fastify({
    logger: false,
    bodyLimit: 2_200_000,
    requestTimeout: 20000,
    trustProxy: false,
  });
  const auth = authService(db, config, options.clock ?? Date.now);
  app.addHook('onClose', async () => {
    await db.$disconnect();
  });
  app.setErrorHandler((error, req, reply) => {
    let status = 500,
      code = 'INTERNAL_ERROR',
      message = '请求暂时无法完成。';
    if (error instanceof ApiFailure) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof z.ZodError) {
      status = 400;
      code = 'INVALID_INPUT';
      message = '输入格式无效，请检查字段。';
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        status = 409;
        code = 'DUPLICATE';
        message = '唯一字段已被占用。';
      } else if (error.code === 'P2004' || error.meta?.code === '23514') {
        status = 409;
        code = 'DATA_INTEGRITY';
        message = '数据完整性约束拒绝此更改。';
      } else if (error.meta?.code === '42501') {
        status = 409;
        code = 'PUBLICATION_INTENT_REQUIRED';
        message = '发布状态只能通过明确的发布管理流程修改。';
      } else if (error.code === 'P2003') {
        status = 400;
        code = 'INVALID_REFERENCE';
        message = '关联记录无效。';
      } else if (error.code === 'P2025') {
        status = 404;
        code = 'NOT_FOUND';
        message = '记录不存在。';
      } else if (error.code === 'P2034' || error.meta?.code === '55P03') {
        status = 409;
        code = 'CONCURRENT_REQUEST';
        message = '已有并发请求，请重试。';
      } else if (error.code === 'P2010' && error.meta?.code === 'P0001') {
        status = 409;
        code = 'IMMUTABLE_RECORD';
        message = '历史记录不可修改。';
      } else {
        status = 503;
        code = 'DATABASE_UNAVAILABLE';
        message = '数据库暂时不可用。';
      }
    } else if (
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      status = 503;
      code = 'DATABASE_UNAVAILABLE';
      message = '数据库暂时不可用。';
    } else if (
      typeof error === 'object' &&
      error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode < 500
    ) {
      status = error.statusCode;
      code = 'INVALID_REQUEST';
    }
    reply.code(status).send({
      error: { code, message, requestId: req.id, retryable: status >= 500 || status === 409 },
    });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: '接口不存在。', requestId: req.id, retryable: false },
    }),
  );
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (
      write &&
      (req.headers.origin !== config.origin || req.headers['sec-fetch-site'] === 'cross-site')
    )
      fail(403, 'ORIGIN_REJECTED', '请求来源不可信。');
    const path = req.url.split('?')[0] ?? '';
    if (
      (path === '/api/v1/admin' || path.startsWith('/api/v1/admin/')) &&
      !['/api/v1/admin/auth/login', '/api/v1/admin/auth/csrf'].includes(path)
    )
      await auth.requireAdmin(req, write, write && !path.startsWith('/api/v1/admin/auth/'));
  });
  app.get('/api/v1/health', async () => {
    await db.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      mode: 'database',
      database: 'connected',
      ai: 'not-connected',
      auth: 'server-session',
    };
  });
  auth.routes(app);
  personaRoutes(app, db, auth);
  chatRoutes(app, db, auth, config);
  return app;
}
