import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Email, Password, passwordHash, passwordValid, secretHash } from './auth.ts';
import { fail } from './errors.ts';
import type { DatabaseConfig } from './config.ts';
import type { LocalMail, MailSender } from './user-mail.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
export const USER_SESSION_ABSOLUTE_MS = 7 * 24 * HOUR;
export const USER_SESSION_IDLE_MS = 24 * HOUR;
export const EMAIL_VERIFICATION_MS = 30 * MINUTE;
export const PASSWORD_RESET_MS = 15 * MINUTE;
const PRE_CSRF_MS = 10 * MINUTE;
const RawToken = z.string().regex(/^[a-f0-9]{64}$/);
const DisplayName = z.string().trim().max(80);
const token = () => randomBytes(32).toString('hex');
const same = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const ACCEPTED = {
  accepted: true,
  message:
    '请求已受理；符合条件且投递成功时请查本地模拟邮件。本响应不确认送达，正式邮件服务尚未接入。',
} as const;
type Tx = Prisma.TransactionClient;
type Ticket = {
  id: string;
  userId: string;
  authVersion: number;
  to: string;
  purpose: LocalMail['purpose'];
  raw: string;
};
type Identity = { id: string; userId: string; authVersion: number };
const userDto = (user: {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: Date | null;
}) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
});
async function verifyPassword(encoded: string, password: string) {
  // Stored hashes originate from the same fixed policy. Corrupt/extreme PHC input must not allocate arbitrary memory.
  if (!/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22,86}\$[A-Za-z0-9+/]{43}$/.test(encoded))
    return false;
  try {
    return await passwordValid(encoded, password);
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 429)
      throw error;
    return false;
  }
}

export function userAuthService(
  db: PrismaClient,
  config: DatabaseConfig,
  clock: () => number = Date.now,
  mail?: MailSender,
) {
  if (
    config.environment === 'production' &&
    (!config.secure || !config.origin.startsWith('https://'))
  )
    throw new Error('USER_AUTH_REQUIRES_PRODUCTION_HTTPS');
  const cookieName = config.secure ? '__Host-pv_v2_user' : 'pv_v2_user_local';
  const preName = config.secure ? '__Host-pv_v2_user_login' : 'pv_v2_user_login_local';
  const now = () => new Date(clock());
  function cookie(req: FastifyRequest, name: string) {
    const values = req.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(name + '='));
    if (values?.length !== 1) return null;
    const raw = values[0]!.slice(name.length + 1);
    return /^[a-f0-9]{64}$/.test(raw) ? raw : null;
  }
  function setCookie(reply: FastifyReply, name: string, value: string, age: number) {
    reply.header(
      'Set-Cookie',
      `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${config.secure ? '; Secure' : ''}`,
    );
  }
  function clearCookie(reply: FastifyReply) {
    setCookie(reply, cookieName, '', 0);
  }
  function requirePreCsrf(req: FastifyRequest) {
    const raw = cookie(req, preName);
    const csrf = req.headers['x-csrf-token'];
    const issuedAt = raw ? Number.parseInt(raw.slice(0, 12), 16) : NaN;
    if (
      !raw ||
      !Number.isSafeInteger(issuedAt) ||
      issuedAt > clock() + 30 * SECOND ||
      clock() - issuedAt > PRE_CSRF_MS ||
      typeof csrf !== 'string' ||
      !same(csrf, secretHash('user-pre-csrf:' + raw))
    )
      fail(403, 'CSRF_REJECTED', '安全令牌无效或已过期，请重新打开页面。');
  }
  function sender() {
    // A production sender is intentionally unavailable in this phase. Never pretend an email was sent.
    if (config.environment === 'production' || !mail)
      fail(503, 'MAIL_NOT_CONFIGURED', '本地模拟邮件尚未配置；正式邮件服务未接入。');
    return mail;
  }
  async function rate(
    req: FastifyRequest,
    action: string,
    limit: number,
    window: number,
    email?: string,
    accountLimit?: number,
    globalLimit?: number,
  ) {
    const control = await db.aiControl.findUnique({ where: { id: 'global' } });
    if (!control) fail(503, 'DATABASE_UNAVAILABLE', '认证保护配置暂时不可用。');
    const digest = (value: string) =>
      createHmac('sha256', control.privacySalt).update(value).digest('hex');
    const start = Math.floor(clock() / window) * window;
    const subjects: [string, number][] = [['ip:' + digest(req.ip ?? 'unavailable'), limit]];
    if (email) subjects.push(['account:' + digest(email), accountLimit ?? limit]);
    if (globalLimit) subjects.push(['global', globalLimit]);
    const allowed = await db.$transaction(async (tx) => {
      let accepted = true;
      for (const [subject, maximum] of subjects) {
        const key = `user-auth:${action}:${subject}:${start}`;
        const rows = await tx.$queryRaw<
          { count: number }[]
        >`INSERT INTO "AiRateBucket"(key,count,"expiresAt") VALUES (${key},1,${new Date(start + 2 * window)}) ON CONFLICT(key) DO UPDATE SET count="AiRateBucket".count+1 WHERE "AiRateBucket".count<${maximum} RETURNING count`;
        if (!rows.length) accepted = false;
      }
      return accepted;
    });
    if (!allowed) fail(429, 'AUTH_RATE_LIMITED', '请求过于频繁，请稍后重试。', true);
  }
  async function lockUser(tx: Tx, userId: string) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId}::uuid FOR UPDATE`;
    return tx.user.findUnique({ where: { id: userId } });
  }
  async function lockCurrent(tx: Tx, identity: Identity) {
    const user = await lockUser(tx, identity.userId);
    await tx.$queryRaw`SELECT id FROM "UserSession" WHERE id=${identity.id}::uuid FOR SHARE`;
    const current = await tx.userSession.findUnique({ where: { id: identity.id } });
    if (
      !user ||
      !current ||
      current.userId !== identity.userId ||
      user.status !== 'active' ||
      !user.emailVerifiedAt ||
      current.revokedAt ||
      current.authVersion !== user.authVersion ||
      current.authVersion !== identity.authVersion ||
      current.expiresAt.getTime() <= clock() ||
      current.lastSeenAt.getTime() + USER_SESSION_IDLE_MS <= clock()
    )
      fail(401, 'USER_SESSION_EXPIRED', '登录会话已失效，请重新登录。');
    return { user, current };
  }
  async function session(req: FastifyRequest) {
    await db.$queryRaw`SELECT 1`;
    const raw = cookie(req, cookieName);
    if (!raw) fail(401, 'USER_REQUIRED', '请先登录普通用户账户。');
    const initial = await db.userSession.findUnique({ where: { tokenHash: secretHash(raw) } });
    if (!initial) fail(401, 'USER_SESSION_EXPIRED', '登录会话已失效，请重新登录。');
    return db.$transaction(async (tx) => {
      const { user, current } = await lockCurrent(tx, initial);
      const touched = await tx.userSession.update({
        where: { id: current.id },
        data: { lastSeenAt: now() },
      });
      return { ...touched, user, raw, csrfToken: secretHash('user-session-csrf:' + raw) };
    });
  }
  async function requireUser(req: FastifyRequest, write = false) {
    const result = await session(req);
    if (
      write &&
      (typeof req.headers['x-csrf-token'] !== 'string' ||
        !same(req.headers['x-csrf-token'], result.csrfToken))
    )
      fail(403, 'CSRF_REJECTED', '安全令牌无效，请刷新页面。');
    return result;
  }
  async function createTicket(
    tx: Tx,
    user: { id: string; email: string; authVersion: number },
    purpose: Ticket['purpose'],
  ) {
    const raw = token();
    const data = {
      userId: user.id,
      authVersion: user.authVersion,
      tokenHash: secretHash(raw),
      createdAt: now(),
      expiresAt: new Date(
        clock() + (purpose === 'verify' ? EMAIL_VERIFICATION_MS : PASSWORD_RESET_MS),
      ),
    };
    // Explicit branches preserve each generated Prisma delegate's types.
    if (purpose === 'verify') {
      await tx.emailVerification.updateMany({
        where: { userId: user.id, revokedAt: null, usedAt: null },
        data: { revokedAt: now() },
      });
      const record = await tx.emailVerification.create({ data });
      return {
        id: record.id,
        userId: user.id,
        authVersion: user.authVersion,
        to: user.email,
        purpose,
        raw,
      };
    }
    await tx.passwordReset.updateMany({
      where: { userId: user.id, revokedAt: null, usedAt: null },
      data: { revokedAt: now() },
    });
    const record = await tx.passwordReset.create({ data });
    return {
      id: record.id,
      userId: user.id,
      authVersion: user.authVersion,
      to: user.email,
      purpose,
      raw,
    };
  }
  async function deliver(ticket: Ticket, delivery: MailSender) {
    try {
      await delivery.send({ to: ticket.to, purpose: ticket.purpose, token: ticket.raw });
    } catch {
      // Same public acceptance response as an ineligible address. Do not expose mail availability
      // through account-specific failures. Unactivated proof is unusable; DB errors still propagate.
      if (ticket.purpose === 'verify')
        await db.emailVerification.updateMany({
          where: { id: ticket.id, usedAt: null, revokedAt: null },
          data: { revokedAt: now() },
        });
      else
        await db.passwordReset.updateMany({
          where: { id: ticket.id, usedAt: null, revokedAt: null },
          data: { revokedAt: now() },
        });
      return;
    }
    await db.$transaction(async (tx) => {
      const current = await lockUser(tx, ticket.userId);
      if (!current || current.status !== 'active' || current.authVersion !== ticket.authVersion)
        return;
      const where = {
        id: ticket.id,
        userId: current.id,
        authVersion: current.authVersion,
        usedAt: null,
        revokedAt: null,
        deliveredAt: null,
        expiresAt: { gt: now() },
      };
      if (ticket.purpose === 'verify')
        await tx.emailVerification.updateMany({ where, data: { deliveredAt: now() } });
      else await tx.passwordReset.updateMany({ where, data: { deliveredAt: now() } });
    });
  }
  function invalidToken(): never {
    return fail(400, 'TOKEN_INVALID', '令牌无效、已使用或已过期，请重新申请。');
  }
  async function revokeCredentials(tx: Tx, userId: string) {
    await tx.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now() },
    });
    await tx.emailVerification.updateMany({
      where: { userId, revokedAt: null, usedAt: null },
      data: { revokedAt: now() },
    });
    await tx.passwordReset.updateMany({
      where: { userId, revokedAt: null, usedAt: null },
      data: { revokedAt: now() },
    });
  }
  async function confirmPassword(
    req: FastifyRequest,
    identity: Identity & { user: { passwordHash: string } },
    password: string,
  ) {
    await rate(req, 'password-confirm', 30, 15 * MINUTE, identity.userId);
    if (
      password.length < 1 ||
      password.length > 256 ||
      !(await verifyPassword(identity.user.passwordHash, password))
    )
      fail(401, 'INVALID_CREDENTIALS', '当前密码不正确。');
  }
  function routes(app: FastifyInstance) {
    app.get('/api/v1/auth/csrf', async (req, reply) => {
      await rate(req, 'csrf', 120, 15 * MINUTE);
      const raw = clock().toString(16).padStart(12, '0') + randomBytes(26).toString('hex');
      setCookie(reply, preName, raw, PRE_CSRF_MS / SECOND);
      return { csrfToken: secretHash('user-pre-csrf:' + raw) };
    });
    app.post('/api/v1/auth/register', async (req, reply) => {
      requirePreCsrf(req);
      const input = z
        .object({ email: Email, password: Password, displayName: DisplayName.default('') })
        .strict()
        .parse(req.body);
      const delivery = sender();
      await rate(req, 'register', 12, HOUR, input.email, 5, 200);
      // Same Argon2id work for new and existing addresses; duplicates never overwrite credentials.
      const encoded = await passwordHash(input.password);
      const ticket = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${secretHash('register:' + input.email)},0))`;
        const existing = await tx.user.findUnique({ where: { email: input.email } });
        if (existing) return null;
        const user = await tx.user.create({
          data: { email: input.email, passwordHash: encoded, displayName: input.displayName },
        });
        return createTicket(tx, user, 'verify');
      });
      if (ticket) await deliver(ticket, delivery);
      reply.code(202);
      return ACCEPTED;
    });
    app.post('/api/v1/auth/verify', async (req) => {
      requirePreCsrf(req);
      const input = z.object({ token: RawToken }).strict().parse(req.body);
      await rate(req, 'verify', 30, 15 * MINUTE);
      const initial = await db.emailVerification.findUnique({
        where: { tokenHash: secretHash(input.token) },
      });
      if (!initial) invalidToken();
      await db.$transaction(async (tx) => {
        const user = await lockUser(tx, initial.userId);
        const proof = await tx.emailVerification.findUnique({ where: { id: initial.id } });
        if (
          !user ||
          !proof ||
          user.status !== 'active' ||
          proof.authVersion !== user.authVersion ||
          !proof.deliveredAt ||
          proof.revokedAt ||
          proof.usedAt ||
          proof.expiresAt <= now()
        )
          invalidToken();
        await tx.emailVerification.update({ where: { id: proof.id }, data: { usedAt: now() } });
        await tx.user.update({
          where: { id: user.id },
          data: { emailVerifiedAt: user.emailVerifiedAt ?? now() },
        });
        await tx.emailVerification.updateMany({
          where: { userId: user.id, revokedAt: null, usedAt: null },
          data: { revokedAt: now() },
        });
      });
      return { verified: true };
    });
    app.post('/api/v1/auth/resend-verification', async (req, reply) => {
      requirePreCsrf(req);
      const input = z.object({ email: Email }).strict().parse(req.body);
      const delivery = sender();
      await rate(req, 'resend', 30, HOUR, input.email, 3);
      const ticket = await db.$transaction(async (tx) => {
        const initial = await tx.user.findUnique({ where: { email: input.email } });
        if (!initial) return null;
        const user = await lockUser(tx, initial.id);
        return user && user.status === 'active' && !user.emailVerifiedAt
          ? createTicket(tx, user, 'verify')
          : null;
      });
      if (ticket) await deliver(ticket, delivery);
      reply.code(202);
      return ACCEPTED;
    });
    app.post('/api/v1/auth/login', async (req, reply) => {
      requirePreCsrf(req);
      const input = z
        .object({ email: Email, password: z.string().min(1).max(256) })
        .strict()
        .parse(req.body);
      await rate(req, 'login', 50, 15 * MINUTE, input.email, 10);
      const initial = await db.user.findUnique({ where: { email: input.email } });
      const valid = initial
        ? await verifyPassword(initial.passwordHash, input.password)
        : (await passwordHash(input.password), false);
      if (!initial || !valid || initial.status !== 'active' || !initial.emailVerifiedAt)
        fail(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确，或邮箱尚未验证。');
      const raw = token();
      await db.$transaction(async (tx) => {
        const user = await lockUser(tx, initial.id);
        if (
          !user ||
          user.status !== 'active' ||
          !user.emailVerifiedAt ||
          user.passwordHash !== initial.passwordHash ||
          user.authVersion !== initial.authVersion
        )
          fail(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确，或邮箱尚未验证。');
        await tx.userSession.create({
          data: {
            userId: user.id,
            tokenHash: secretHash(raw),
            authVersion: user.authVersion,
            createdAt: now(),
            lastSeenAt: now(),
            expiresAt: new Date(clock() + USER_SESSION_ABSOLUTE_MS),
          },
        });
      });
      setCookie(reply, cookieName, raw, USER_SESSION_ABSOLUTE_MS / SECOND);
      return { authenticated: true };
    });
    app.get('/api/v1/auth/session', async (req) => {
      const value = await requireUser(req);
      return { user: userDto(value.user), csrfToken: value.csrfToken };
    });
    app.post('/api/v1/auth/logout', async (req, reply) => {
      z.object({}).strict().parse(req.body);
      const value = await requireUser(req, true);
      await db.$transaction(async (tx) => {
        await lockCurrent(tx, value);
        await tx.userSession.update({ where: { id: value.id }, data: { revokedAt: now() } });
      });
      clearCookie(reply);
      return { revoked: true };
    });
    app.post('/api/v1/auth/forgot-password', async (req, reply) => {
      requirePreCsrf(req);
      const input = z.object({ email: Email }).strict().parse(req.body);
      const delivery = sender();
      await rate(req, 'forgot', 30, HOUR, input.email, 3);
      const ticket = await db.$transaction(async (tx) => {
        const initial = await tx.user.findUnique({ where: { email: input.email } });
        if (!initial) return null;
        const user = await lockUser(tx, initial.id);
        return user && user.status === 'active' ? createTicket(tx, user, 'reset') : null;
      });
      if (ticket) await deliver(ticket, delivery);
      reply.code(202);
      return ACCEPTED;
    });
    app.post('/api/v1/auth/reset-password', async (req) => {
      requirePreCsrf(req);
      const input = z.object({ token: RawToken, newPassword: Password }).strict().parse(req.body);
      await rate(req, 'reset', 10, 15 * MINUTE);
      const encoded = await passwordHash(input.newPassword);
      const initial = await db.passwordReset.findUnique({
        where: { tokenHash: secretHash(input.token) },
      });
      if (!initial) invalidToken();
      await db.$transaction(async (tx) => {
        const user = await lockUser(tx, initial.userId);
        const proof = await tx.passwordReset.findUnique({ where: { id: initial.id } });
        if (
          !user ||
          !proof ||
          user.status !== 'active' ||
          proof.authVersion !== user.authVersion ||
          !proof.deliveredAt ||
          proof.usedAt ||
          proof.revokedAt ||
          proof.expiresAt <= now()
        )
          invalidToken();
        await tx.passwordReset.update({ where: { id: proof.id }, data: { usedAt: now() } });
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: encoded, authVersion: { increment: 1 } },
        });
        await revokeCredentials(tx, user.id);
      });
      return { reset: true, sessionsRevoked: true };
    });
    app.get('/api/v1/me', async (req) => ({ user: userDto((await requireUser(req)).user) }));
    app.put('/api/v1/me', async (req) => {
      const value = await requireUser(req, true);
      const input = z.object({ displayName: DisplayName }).strict().parse(req.body);
      const user = await db.$transaction(async (tx) => {
        await lockCurrent(tx, value);
        return tx.user.update({
          where: { id: value.userId },
          data: { displayName: input.displayName },
        });
      });
      return { user: userDto(user) };
    });
    app.post('/api/v1/auth/password', async (req, reply) => {
      const value = await requireUser(req, true);
      const input = z
        .object({ currentPassword: z.string().min(1).max(256), newPassword: Password })
        .strict()
        .parse(req.body);
      await confirmPassword(req, value, input.currentPassword);
      const encoded = await passwordHash(input.newPassword);
      await db.$transaction(async (tx) => {
        const { user } = await lockCurrent(tx, value);
        if (user.passwordHash !== value.user.passwordHash)
          fail(409, 'CREDENTIAL_CONFLICT', '凭据已变化，请重新登录。');
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: encoded, authVersion: { increment: 1 } },
        });
        await revokeCredentials(tx, user.id);
      });
      clearCookie(reply);
      return { revoked: true };
    });
    app.get('/api/v1/auth/sessions', async (req) => {
      const value = await requireUser(req);
      const query = z
        .object({
          page: z.coerce.number().int().min(1).max(10000).default(1),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
        .strict()
        .parse(req.query);
      const where = {
        userId: value.userId,
        revokedAt: null,
        expiresAt: { gt: now() },
        lastSeenAt: { gt: new Date(clock() - USER_SESSION_IDLE_MS) },
        authVersion: value.user.authVersion,
      };
      const [total, items] = await db.$transaction([
        db.userSession.count({ where }),
        db.userSession.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        }),
      ]);
      return {
        page: query.page,
        limit: query.limit,
        total,
        items: items.map((item) => ({
          id: item.id,
          createdAt: item.createdAt.toISOString(),
          lastSeenAt: item.lastSeenAt.toISOString(),
          expiresAt: item.expiresAt.toISOString(),
          current: item.id === value.id,
        })),
      };
    });
    app.post('/api/v1/auth/sessions/:id/revoke', async (req, reply) => {
      z.object({}).strict().parse(req.body);
      const value = await requireUser(req, true);
      const { id } = z.object({ id: z.string().uuid() }).strict().parse(req.params);
      await db.$transaction(async (tx) => {
        await lockCurrent(tx, value);
        const changed = await tx.userSession.updateMany({
          where: { id, userId: value.userId, revokedAt: null },
          data: { revokedAt: now() },
        });
        if (!changed.count) fail(404, 'SESSION_NOT_FOUND', '会话不存在。');
      });
      if (id === value.id) clearCookie(reply);
      return { revoked: true };
    });
  }
  return {
    routes,
    requireUser,
    session,
    lockCurrent,
    revokeCredentials,
    clearCookie,
    userDto,
    confirmPassword,
  };
}
