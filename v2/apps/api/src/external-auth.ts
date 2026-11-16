import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { secretHash } from './auth.ts';
import { fail } from './errors.ts';
import type { userAuthService } from './user-auth.ts';
import type { DatabaseConfig } from './config.ts';
import type { RengineProvider } from './auth-providers/rengine.ts';
export function externalAuthRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  auth: ReturnType<typeof userAuthService>,
  config: DatabaseConfig,
  provider?: RengineProvider,
  clock: () => number = Date.now,
) {
  if (provider && config.environment === 'production')
    throw new Error('EXTERNAL_AUTH_REAL_VALIDATION_REQUIRED');
  const name = config.secure ? '__Host-pv_rengine_flow' : 'pv_rengine_flow_local';
  const cookie = (value: string, age: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.secure ? '; Secure' : ''}`;
  const enabled = () => {
    if (!provider) fail(503, 'EXTERNAL_AUTH_DISABLED', '热土绑定尚未启用。');
    return provider!;
  };
  app.get('/api/v1/auth/rengine', async (req) => {
    const s = await auth.requireUser(req);
    const identities = await db.externalIdentity.findMany({
      where: { userId: s.userId },
      select: { id: true, status: true, createdAt: true },
    });
    return { enabled: !!provider, mode: provider ? 'mock' : 'disabled', identities };
  });
  app.post('/api/v1/auth/rengine/start', async (req, reply) => {
    const p = enabled(),
      s = await auth.requireUser(req, true);
    const input = z
      .object({ password: z.string().min(1).max(256) })
      .strict()
      .parse(req.body);
    await auth.confirmPassword(req, s, input.password);
    const state = randomBytes(32).toString('hex'),
      browser = randomBytes(32).toString('hex');
    await db.$transaction(async (tx) => {
      await auth.lockCurrent(tx, s);
      if (
        await tx.externalAuthTransaction.findFirst({
          where: { sessionId: s.id, status: 'exchanging', expiresAt: { gt: new Date(clock()) } },
        })
      )
        fail(409, 'EXTERNAL_IN_PROGRESS', '授权正在完成，请稍候。');
      await tx.externalAuthTransaction.updateMany({
        where: { sessionId: s.id, status: 'pending' },
        data: { status: 'failed' },
      });
      await tx.externalAuthTransaction.create({
        data: {
          userId: s.userId,
          sessionId: s.id,
          authVersion: s.authVersion,
          softwareId: p.softwareId,
          stateHash: secretHash(state),
          browserHash: secretHash(browser),
          expiresAt: new Date(clock() + 180000),
        },
      });
    });
    let url: string;
    try {
      url = await p.start(state);
    } catch {
      await db.externalAuthTransaction.updateMany({
        where: { stateHash: secretHash(state), status: 'pending' },
        data: { status: 'failed' },
      });
      fail(503, 'EXTERNAL_PROVIDER_UNAVAILABLE', '模拟授权暂时不可用，请重新发起。');
    }
    reply.header('Set-Cookie', cookie(browser, 180));
    return { url, mode: 'mock' };
  });
  app.post('/api/v1/auth/rengine/finalize', async (req, reply) => {
    const p = enabled(),
      s = await auth.requireUser(req, true);
    const input = z
      .object({ state: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().min(1).max(2048) })
      .strict()
      .parse(req.body);
    const values = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(name + '='));
    const browser = values?.length === 1 ? values[0]!.slice(name.length + 1) : '';
    if (!/^[a-f0-9]{64}$/.test(browser)) fail(403, 'EXTERNAL_STATE_REJECTED', '授权浏览器不匹配。');
    const where = {
      stateHash: secretHash(input.state),
      browserHash: secretHash(browser),
      userId: s.userId,
      sessionId: s.id,
      authVersion: s.authVersion,
      softwareId: p.softwareId,
      status: 'pending',
      expiresAt: { gt: new Date(clock()) },
    };
    const claimed = await db.$transaction(async (tx) => {
      await auth.lockCurrent(tx, s);
      return tx.externalAuthTransaction.updateMany({ where, data: { status: 'exchanging' } });
    });
    if (claimed.count !== 1) fail(409, 'EXTERNAL_STATE_REJECTED', '授权已过期、已使用或不匹配。');
    try {
      const assertion = await p.verify(input.code);
      if (
        assertion.softwareId !== p.softwareId ||
        !Number.isFinite(assertion.expiresAt.getTime()) ||
        assertion.expiresAt.getTime() <= clock() ||
        !assertion.subject ||
        assertion.subject.length > 128 ||
        !assertion.uuid ||
        assertion.uuid.length > 128
      )
        fail(403, 'EXTERNAL_IDENTITY_REJECTED', '外部身份不匹配。');
      await db.$transaction(async (tx) => {
        await auth.lockCurrent(tx, s);
        const active = await tx.externalAuthTransaction.updateMany({
          where: { ...where, status: 'exchanging', expiresAt: { gt: new Date(clock()) } },
          data: { status: 'complete' },
        });
        if (active.count !== 1) fail(409, 'EXTERNAL_STATE_REJECTED', '授权已失效。');
        const existing = await tx.externalIdentity.findUnique({
          where: {
            provider_softwareId_subject: {
              provider: 'rengine',
              softwareId: p.softwareId,
              subject: assertion.subject,
            },
          },
        });
        if (existing) {
          if (
            existing.userId !== s.userId ||
            existing.subjectUuid !== assertion.uuid ||
            existing.status !== 'active'
          )
            fail(409, 'EXTERNAL_IDENTITY_CONFLICT', '该身份无法绑定。');
        } else
          await tx.externalIdentity.create({
            data: {
              userId: s.userId,
              softwareId: p.softwareId,
              subject: assertion.subject,
              subjectUuid: assertion.uuid,
            },
          });
      });
    } catch (e) {
      await db.externalAuthTransaction.updateMany({
        where: { stateHash: secretHash(input.state), status: 'exchanging' },
        data: { status: 'failed' },
      });
      if (e && typeof e === 'object' && ('status' in e || 'code' in e)) throw e;
      fail(503, 'EXTERNAL_PROVIDER_UNAVAILABLE', '授权未完成，请重新发起；不会自动重试授权码。');
    }
    // Clear independent flow and pre-login cookies; both headers must survive Workers.
    reply.header('Set-Cookie', cookie('', 0));
    reply.header(
      'Set-Cookie',
      `${config.secure ? '__Host-pv_v2_user_login' : 'pv_v2_user_login_local'}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secure ? '; Secure' : ''}`,
    );
    return { bound: true, mode: 'mock' };
  });
}
