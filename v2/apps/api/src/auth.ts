import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseConfig } from './config.ts';
import { fail } from './errors.ts';
export const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const passwordHash = (password: string) =>
  hash(password, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const passwordValid = (encoded: string, password: string) => verify(encoded, password);
export const Password = z.string().min(12).max(256);
export const Email = z.string().trim().toLowerCase().email().max(254);
const token = () => randomBytes(32).toString('hex');
const match = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function authService(db: PrismaClient, config: DatabaseConfig, clock: () => number) {
  const cookieName = config.secure ? '__Host-pv_v2_admin' : 'pv_v2_admin_local';
  const preName = config.secure ? '__Host-pv_v2_login' : 'pv_v2_login_local';
  function cookie(req: FastifyRequest, name: string) {
    const value = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + '='))
      ?.slice(name.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
  }
  function set(reply: FastifyReply, name: string, value: string, age: number) {
    reply.header(
      'Set-Cookie',
      `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${config.secure ? '; Secure' : ''}`,
    );
  }
  async function session(req: FastifyRequest) {
    const raw = cookie(req, cookieName);
    // DB outage must remain 503 even when there is no cookie.
    await db.$queryRaw`SELECT 1`;
    if (!raw) fail(401, 'ADMIN_REQUIRED', '请先登录管理员账户。');
    const value = await db.adminSession.findUnique({
      where: { tokenHash: secretHash(raw) },
      include: { admin: true },
    });
    const now = clock();
    if (
      !value ||
      value.revokedAt ||
      value.expiresAt.getTime() <= now ||
      value.lastSeenAt.getTime() + 30 * 60000 <= now ||
      value.admin.status !== 'active' ||
      value.authVersion !== value.admin.authVersion
    )
      fail(401, 'SESSION_EXPIRED', '管理员会话已失效，请重新登录。');
    await db.adminSession.update({ where: { id: value.id }, data: { lastSeenAt: new Date(now) } });
    return { ...value, raw, csrfToken: secretHash('session-csrf:' + raw) };
  }
  async function requireAdmin(req: FastifyRequest, write = false, owner = write) {
    const s = await session(req);
    if (owner && s.admin.role !== 'owner') fail(403, 'PERMISSION_DENIED', '当前账户没有修改权限。');
    if (
      write &&
      (typeof req.headers['x-csrf-token'] !== 'string' ||
        !match(req.headers['x-csrf-token'], s.csrfToken))
    )
      fail(403, 'CSRF_REJECTED', '安全令牌已失效，请刷新页面。');
    return s;
  }
  async function audit(adminId: string, action: string, requestId: string, objectId?: string) {
    await db.adminAuditLog.create({
      data: {
        adminId,
        action,
        objectType: 'authentication',
        objectId,
        requestId,
        changeSummary: {},
      },
    });
  }
  function routes(app: FastifyInstance) {
    app.get('/api/v1/admin/auth/csrf', async (req, reply) => {
      const raw = token();
      set(reply, preName, raw, 600);
      return { csrfToken: secretHash('login-csrf:' + raw) };
    });
    app.post('/api/v1/admin/auth/login', async (req, reply) => {
      const pre = cookie(req, preName),
        csrf = req.headers['x-csrf-token'];
      if (!pre || typeof csrf !== 'string' || !match(csrf, secretHash('login-csrf:' + pre)))
        fail(403, 'CSRF_REJECTED', '登录安全令牌无效，请重试。');
      const input = z
        .object({ email: Email, password: z.string().min(1).max(256) })
        .strict()
        .parse(req.body);
      const now = new Date(clock());
      const bucket = new Date(Math.floor(clock() / (15 * 60000)) * 15 * 60000);
      for (const subject of ['ip:' + req.ip, 'account:' + input.email]) {
        const key = secretHash(subject);
        const [r] = await db.$queryRaw<
          { count: number }[]
        >`INSERT INTO "LoginAttempt"("key","windowStart","count") VALUES (${key},${bucket},1) ON CONFLICT ("key") DO UPDATE SET "windowStart"=EXCLUDED."windowStart","count"=CASE WHEN "LoginAttempt"."windowStart"=EXCLUDED."windowStart" THEN "LoginAttempt"."count"+1 ELSE 1 END RETURNING "count"`;
        if ((r?.count ?? 0) > (subject.startsWith('ip:') ? 30 : 10)) {
          reply.header('Retry-After', '900');
          fail(429, 'LOGIN_RATE_LIMITED', '登录尝试过于频繁，请稍后再试。', true);
        }
      }
      const admin = await db.adminAccount.findUnique({ where: { email: input.email } });
      // Unknown accounts still perform Argon2id work to reduce account enumeration.
      const valid = admin
        ? await passwordValid(admin.passwordHash, input.password)
        : (await passwordHash(input.password), false);
      if (!admin || !valid || admin.status !== 'active')
        fail(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确。');
      const raw = token();
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "AdminAccount" WHERE id=${admin.id}::uuid FOR UPDATE`;
        const current = await tx.adminAccount.findUniqueOrThrow({ where: { id: admin.id } });
        if (current.passwordHash !== admin.passwordHash || current.status !== 'active')
          fail(401, 'INVALID_CREDENTIALS', '凭据已变化，请重新登录。');
        await tx.adminSession.create({
          data: {
            adminId: admin.id,
            tokenHash: secretHash(raw),
            authVersion: current.authVersion,
            createdAt: now,
            lastSeenAt: now,
            expiresAt: new Date(clock() + 12 * 3600000),
          },
        });
        await tx.adminAuditLog.create({
          data: {
            adminId: admin.id,
            action: 'login',
            objectType: 'authentication',
            requestId: req.id,
            changeSummary: {},
          },
        });
      });
      set(reply, cookieName, raw, 43200);
      return { authenticated: true };
    });
    app.get('/api/v1/admin/auth/session', async (req) => {
      const s = await session(req);
      return {
        admin: { id: s.admin.id, email: s.admin.email, role: s.admin.role },
        csrfToken: s.csrfToken,
      };
    });
    app.post('/api/v1/admin/auth/logout', async (req, reply) => {
      const s = await requireAdmin(req, true, false);
      await db.$transaction([
        db.adminSession.update({ where: { id: s.id }, data: { revokedAt: new Date(clock()) } }),
        db.adminAuditLog.create({
          data: {
            adminId: s.adminId,
            action: 'logout',
            objectType: 'authentication',
            requestId: req.id,
            changeSummary: {},
          },
        }),
      ]);
      set(reply, cookieName, '', 0);
      return { revoked: true };
    });
    app.post('/api/v1/admin/auth/password', async (req) => {
      const s = await requireAdmin(req, true, false);
      const body = z
        .object({ currentPassword: z.string().min(1).max(256), newPassword: Password })
        .strict()
        .parse(req.body);
      if (!(await passwordValid(s.admin.passwordHash, body.currentPassword)))
        fail(401, 'INVALID_CREDENTIALS', '当前密码不正确。');
      const encoded = await passwordHash(body.newPassword);
      await db.$transaction(async (tx) => {
        const changed = await tx.adminAccount.updateMany({
          where: { id: s.adminId, authVersion: s.admin.authVersion },
          data: { passwordHash: encoded, authVersion: { increment: 1 } },
        });
        if (changed.count !== 1) fail(409, 'CREDENTIAL_CONFLICT', '凭据已变化，请重新登录。');
        await tx.adminSession.updateMany({
          where: { adminId: s.adminId, revokedAt: null },
          data: { revokedAt: new Date(clock()) },
        });
        await tx.adminAuditLog.create({
          data: {
            adminId: s.adminId,
            action: 'password-change',
            objectType: 'authentication',
            requestId: req.id,
            changeSummary: {},
          },
        });
      });
      return { revoked: true };
    });
  }
  return { requireAdmin, session, routes, audit };
}
