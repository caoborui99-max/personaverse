import type { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { fail } from './errors.ts';
type Tx = Prisma.TransactionClient;
export const CHAT_DAY_MS = 3600000;
export const CHAT_DAY_TOKENS = 100000;
export const CHAT_IDLE_MS = 300000;
export const CHAT_LEASE_MS = 30000;
const DAY = 86400000,
  OFFSET = 8 * 3600000;
export const beijingDay = (time: number) => new Date(time + OFFSET).toISOString().slice(0, 10);
export const nextBeijingDay = (time: number) =>
  Math.floor((time + OFFSET) / DAY) * DAY + DAY - OFFSET;
export function chatAllowance(clock: () => number = Date.now, mode: 'mock' | 'deepseek' = 'mock') {
  async function day(tx: Tx, userId: string, at: number) {
    return tx.userChatDay.upsert({
      where: { userId_day: { userId, day: beijingDay(at) } },
      create: { userId, day: beijingDay(at) },
      update: {},
    });
  }
  async function settle(tx: Tx, userId: string) {
    // All callers take the same User lock. Clock, day counters and messages commit together.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId}::uuid FOR UPDATE`;
    const c = await tx.userChatClock.upsert({ where: { userId }, create: { userId }, update: {} });
    const now = Math.max(clock(), c.settledAt?.getTime() ?? 0);
    if (c.settledAt && c.leaseUntil && c.activityAt) {
      const owner = c.ownerSessionId
        ? await tx.userSession.findUnique({ where: { id: c.ownerSessionId } })
        : null;
      const end = Math.max(
        c.settledAt.getTime(),
        Math.min(
          now,
          c.leaseUntil.getTime(),
          c.activityAt.getTime() + CHAT_IDLE_MS,
          owner?.revokedAt?.getTime() ?? Infinity,
          owner?.expiresAt.getTime() ?? now,
        ),
      );
      let from = c.settledAt.getTime();
      while (from < end) {
        const until = Math.min(end, nextBeijingDay(from));
        const d = await day(tx, userId, from);
        await tx.userChatDay.update({
          where: { userId_day: { userId, day: d.day } },
          data: { usedMs: Math.min(CHAT_DAY_MS, d.usedMs + until - from) },
        });
        from = until;
      }
      await tx.userChatClock.update({ where: { userId }, data: { settledAt: new Date(end) } });
    }
    return now;
  }
  async function status(tx: Tx, userId: string, ownerSessionId: string) {
    const now = await settle(tx, userId),
      d = await day(tx, userId, now);
    const c = await tx.userChatClock.findUniqueOrThrow({ where: { userId } });
    const owner = c.ownerSessionId
      ? await tx.userSession.findUnique({ where: { id: c.ownerSessionId } })
      : null;
    const active = !!(
      owner &&
      !owner.revokedAt &&
      owner.expiresAt.getTime() > now &&
      c.leaseUntil &&
      c.activityAt &&
      now < c.leaseUntil.getTime() &&
      now < c.activityAt.getTime() + CHAT_IDLE_MS &&
      d.usedMs < CHAT_DAY_MS &&
      d.usedTokens < CHAT_DAY_TOKENS
    );
    return {
      mode,
      day: d.day,
      timezone: 'Asia/Shanghai',
      serverNow: new Date(now).toISOString(),
      resetsAt: new Date(nextBeijingDay(now)).toISOString(),
      dailyMs: CHAT_DAY_MS,
      remainingMs: CHAT_DAY_MS - d.usedMs,
      dailyTokens: CHAT_DAY_TOKENS,
      remainingTokens: CHAT_DAY_TOKENS - d.usedTokens,
      tokenAccounting:
        mode === 'deepseek'
          ? ('reserved-utf8-upper-bound' as const)
          : ('mock-utf8-upper-bound' as const),
      active,
      canControl: active && c.ownerSessionId === ownerSessionId,
      leaseId: active ? c.leaseId : null,
      chatId: active ? c.chatId : null,
      canSend: d.usedMs < CHAT_DAY_MS && d.usedTokens < CHAT_DAY_TOKENS,
    };
  }
  async function activity(
    tx: Tx,
    userId: string,
    ownerSessionId: string,
    chatId: string,
    action: 'message' | 'start' | 'activity' | 'heartbeat' | 'pause',
    leaseId?: string,
  ) {
    let s = await status(tx, userId, ownerSessionId);
    const now = Date.parse(s.serverNow);
    const c = await tx.userChatClock.findUniqueOrThrow({ where: { userId } });
    if (action !== 'message' && s.active && c.ownerSessionId !== ownerSessionId)
      fail(409, 'CHAT_ACTIVE_ELSEWHERE', '另一台设备正在计时，请先暂停或等待30秒租约结束。');
    if (
      !['message', 'start'].includes(action) &&
      (!leaseId ||
        leaseId !== c.leaseId ||
        c.ownerSessionId !== ownerSessionId ||
        c.chatId !== chatId)
    )
      fail(409, 'CHAT_LEASE_STALE', '计时租约已变化，请刷新额度。');
    if (action === 'pause') {
      if (c.leaseUntil)
        await tx.userChatClock.update({ where: { userId }, data: { leaseUntil: c.settledAt } });
    } else if (action === 'message' || action === 'start' || action === 'activity' || s.active) {
      if (!s.canSend)
        fail(
          429,
          'CHAT_ALLOWANCE_EXHAUSTED',
          '今日聊天时长或Token保护额度已用完，北京时间零点恢复。',
        );
      const isActivity = action !== 'heartbeat';
      await tx.userChatClock.update({
        where: { userId },
        data: {
          ownerSessionId,
          chatId,
          leaseId:
            s.active && c.chatId === chatId && c.ownerSessionId === ownerSessionId
              ? c.leaseId
              : randomUUID(),
          settledAt: new Date(now),
          leaseUntil: new Date(now + CHAT_LEASE_MS),
          activityAt: isActivity ? new Date(now) : c.activityAt,
        },
      });
    }
    s = await status(tx, userId, ownerSessionId);
    return s;
  }
  async function consume(
    tx: Tx,
    userId: string,
    ownerSessionId: string,
    chatId: string,
    estimatedTokens: number,
  ) {
    if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens < 1)
      fail(400, 'INVALID_TOKEN_ESTIMATE', 'Token估算无效。');
    const s = await status(tx, userId, ownerSessionId);
    if (estimatedTokens > s.remainingTokens)
      fail(429, 'PERSONAL_TOKEN_LIMIT', '当前上下文超过今日剩余Token保护额度。');
    await activity(tx, userId, ownerSessionId, chatId, 'message');
    await tx.userChatDay.update({
      where: { userId_day: { userId, day: s.day } },
      data: { usedTokens: { increment: estimatedTokens } },
    });
  }
  return { status, activity, consume };
}
export const activityFingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
