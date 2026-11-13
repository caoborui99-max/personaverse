import { createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { fail } from '../errors.ts';
// Technical mock resource protection, separate from future business/financial limits.
export async function resourceGate(
  tx: Prisma.TransactionClient,
  identity: string,
  ip: string | undefined,
  kind: 'session' | 'message',
  admin: boolean,
) {
  const control = await tx.aiControl.findUniqueOrThrow({ where: { id: 'global' } });
  const hashed = createHmac('sha256', control.privacySalt)
    .update(ip ?? 'unavailable')
    .digest('hex');
  const minute = new Date().toISOString().slice(0, 16);
  const limit = kind === 'session' ? 30 : admin ? 240 : 120;
  for (const subject of ['identity:' + identity, 'ip:' + hashed]) {
    const key = `mock:${kind}:${subject}:${minute}`;
    const r = await tx.$queryRaw<
      { count: number }[]
    >`INSERT INTO "AiRateBucket"(key,count,"expiresAt") VALUES (${key},1,${new Date(Date.now() + 86400000)}) ON CONFLICT(key) DO UPDATE SET count="AiRateBucket".count+1 WHERE "AiRateBucket".count<${limit} RETURNING count`;
    if (!r.length) fail(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试。', true);
  }
}
