import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, createHmac } from 'node:crypto';
import { FakeProvider, assertFake, NoCharge, UnknownOutcome } from './fake-provider.ts';
export class AiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
const reject = (code: string): never => {
  throw new AiError(code);
};
export const MAX_UNITS = 999_999_999_999_999_999n;
export function units(value: bigint) {
  if (value < 0n || value > MAX_UNITS) reject('AMOUNT_RANGE');
  return value;
}
export function estimateCost(
  input: number,
  output: number,
  inputPrice: bigint,
  outputPrice: bigint,
) {
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0)
    reject('TOKEN_RANGE');
  return units(BigInt(input) * units(inputPrice) + BigInt(output) * units(outputPrice));
}
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const decimal = (v: bigint) => new Prisma.Decimal(v.toString()).div(100_000_000);
const include = {
  reservation: { include: { price: true, holds: { include: { budget: true } } } },
  session: { include: { persona: true, coreVersion: true } },
} as const;
type Tx = Prisma.TransactionClient;
export type Actor = { kind: 'visitor' | 'admin'; id: string; ip: string };
export class BudgetEngine {
  constructor(
    readonly db: PrismaClient,
    readonly options: { allowFake?: boolean; clock?: () => number; timeoutMs?: number } = {},
  ) {}
  private now() {
    return new Date(this.options.clock?.() ?? Date.now());
  }
  private async lock(tx: Tx) {
    await tx.$queryRaw`SELECT id FROM "AiControl" WHERE id='global' FOR UPDATE`;
    return (await tx.aiControl.findUnique({ where: { id: 'global' } })) ?? reject('AI_DISABLED');
  }
  private enabled(control: { fakeEnabled: boolean; circuitOpen: boolean }) {
    if (!this.options.allowFake || !control.fakeEnabled || control.circuitOpen)
      reject('AI_DISABLED');
  }
  private async event(tx: Tx, requestId: string, code: string) {
    await tx.aiSafetyEvent.create({ data: { requestId, code, createdAt: this.now() } });
  }
  private async session(tx: Tx, id: string, actor: Actor) {
    await tx.$queryRaw`SELECT id FROM "ChatSession" WHERE id=${id}::uuid FOR UPDATE`;
    const s =
      (await tx.chatSession.findUnique({
        where: { id },
        include: { persona: true, coreVersion: true },
      })) ?? reject('SESSION_NOT_FOUND');
    if ((actor.kind === 'admin' ? s.adminId : s.visitorId) !== actor.id) reject('OWNER_MISMATCH');
    if (actor.kind === 'admin') {
      const a = await tx.adminAccount.findUnique({ where: { id: actor.id } });
      if (a?.status !== 'active' || a.role !== 'owner') reject('OWNER_MISMATCH');
    } else {
      const v = await tx.visitorSession.findUnique({ where: { id: actor.id } });
      if (!v || v.revokedAt || v.expiresAt <= this.now()) reject('OWNER_MISMATCH');
    }
    return s;
  }
  private async available(
    tx: Tx,
    s: { personaId: string; status: string; adminId: string | null },
  ) {
    await tx.$queryRaw`SELECT id FROM "Persona" WHERE id=${s.personaId}::uuid FOR SHARE`;
    const p = await tx.persona.findUniqueOrThrow({ where: { id: s.personaId } });
    if (s.status !== 'active') reject('CHAT_CLOSED');
    if (!s.adminId && (p.status !== 'published' || p.isTest)) reject('PERSONA_UNAVAILABLE');
    if (s.adminId && p.status === 'archived') reject('PERSONA_UNAVAILABLE');
  }
  private async rate(tx: Tx, key: string, limit: number, expiresAt: Date) {
    if (limit <= 0) reject('RATE_DISABLED');
    const rows = await tx.$queryRaw<
      { count: number }[]
    >`INSERT INTO "AiRateBucket"(key,count,"expiresAt") VALUES (${key},1,${expiresAt}) ON CONFLICT(key) DO UPDATE SET count="AiRateBucket".count+1 WHERE "AiRateBucket".count<${limit} RETURNING count`;
    if (!rows.length) reject('RATE_LIMITED');
  }
  async reserve(
    actor: Actor,
    sessionId: string,
    key: string,
    content: string,
    maxOutputTokens: number,
  ) {
    if (
      !/^[0-9a-f-]{36}$/i.test(key) ||
      !content ||
      content.length > 4000 ||
      !Number.isSafeInteger(maxOutputTokens) ||
      maxOutputTokens <= 0
    )
      reject('INVALID_INPUT');
    const fingerprint = digest(JSON.stringify([sessionId, key, content, maxOutputTokens]));
    return this.db.$transaction(
      async (tx) => {
        const control = await this.lock(tx);
        const s = await this.session(tx, sessionId, actor);
        const previous = await tx.chatRequest.findUnique({
          where: { sessionId_clientMessageId: { sessionId, clientMessageId: key } },
          include: { reservation: true },
        });
        if (previous) {
          if (previous.fingerprint !== fingerprint) reject('IDEMPOTENCY_CONFLICT');
          return previous;
        }
        this.enabled(control);
        await this.available(tx, s);
        if (
          await tx.chatRequest.count({
            where: { sessionId, status: { in: ['reserved', 'running', 'unknown'] } },
          })
        )
          reject('SESSION_BUSY');
        const price =
          (await tx.aiPrice.findUnique({ where: { version: control.priceVersion } })) ??
          reject('PRICE_MISSING');
        if (!price.simulated) reject('REAL_PROVIDER_DISABLED');
        const history = await tx.chatMessage.findMany({
          where: { sessionId },
          orderBy: { sequence: 'asc' },
        });
        if (history.length >= 1000) reject('HISTORY_LIMIT');
        const tokens =
          Buffer.byteLength(
            s.coreVersion.coreText +
              s.coreVersion.openingMessage +
              history.map((m) => m.content).join('') +
              content,
            'utf8',
          ) +
          128 +
          (history.length + 2) * 32;
        if (tokens > control.maxInputTokens || maxOutputTokens > control.maxOutputTokens)
          reject('TOKEN_LIMIT');
        const cost = estimateCost(tokens, maxOutputTokens, price.inputUnits, price.outputUnits);
        if (cost <= 0n || cost > control.maxRequestUnits) reject('REQUEST_COST_LIMIT');
        const date = this.now().toISOString(),
          day = date.slice(0, 10),
          month = date.slice(0, 7),
          minute = date.slice(0, 16);
        const scopes = [
          ['global-day', 'global', day],
          ['global-month', 'global', month],
          ...(actor.kind === 'visitor'
            ? [
                ['visitor-day', actor.id, day],
                ['visitor-life', actor.id, 'lifetime'],
              ]
            : [['admin-test', actor.id, day]]),
        ];
        const budgets = [];
        for (const [scope, subject, period] of scopes) {
          await tx.$queryRaw`SELECT id FROM "AiBudget" WHERE scope=${scope!} AND subject=${subject!} AND period=${period!} AND currency=${price.currency} FOR UPDATE`;
          const budget =
            (await tx.aiBudget.findUnique({
              where: {
                scope_subject_period_currency: {
                  scope: scope!,
                  subject: subject!,
                  period: period!,
                  currency: price.currency,
                },
              },
            })) ?? reject('BUDGET_MISSING');
          units(budget.limitUnits);
          units(budget.reservedUnits);
          units(budget.spentUnits);
          if (budget.spentUnits + budget.reservedUnits + cost > budget.limitUnits)
            reject('BUDGET_EXHAUSTED');
          budgets.push(budget);
        }
        const ip = createHmac('sha256', control.privacySalt).update(actor.ip).digest('hex');
        for (const subject of ['ip:' + ip, actor.kind + ':' + actor.id]) {
          await this.rate(
            tx,
            subject + ':minute:' + minute,
            control.ratePerMinute,
            new Date(this.now().getTime() + 86400000),
          );
          await this.rate(
            tx,
            subject + ':day:' + day,
            control.requestsPerDay,
            new Date(this.now().getTime() + 2 * 86400000),
          );
        }
        const r = await tx.chatRequest.create({
          data: {
            sessionId,
            coreVersionId: s.coreVersionId,
            clientMessageId: key,
            fingerprint,
            inputText: content,
            contextSequence: history.at(-1)?.sequence ?? 0,
            maxOutputTokens,
            estimatedInputTokens: tokens,
            status: 'pending',
            updatedAt: this.now(),
          },
        });
        const reservation = await tx.aiReservation.create({
          data: { requestId: r.id, priceVersion: price.version, amountUnits: cost },
        });
        for (const budget of budgets) {
          await tx.aiBudget.update({
            where: { id: budget.id },
            data: { reservedUnits: { increment: cost } },
          });
          await tx.aiHold.create({ data: { reservationId: reservation.id, budgetId: budget.id } });
        }
        await tx.aiLedgerEntry.create({
          data: {
            requestId: r.id,
            kind: 'reserve',
            units: cost,
            currency: price.currency,
            evidence: digest(r.id + ':reserve'),
          },
        });
        await this.event(tx, r.id, 'RESERVED_SIMULATED');
        return tx.chatRequest.update({
          where: { id: r.id },
          data: {
            status: 'reserved',
            leaseExpiresAt: new Date(this.now().getTime() + 30000),
            updatedAt: this.now(),
          },
          include: { reservation: true },
        });
      },
      { timeout: 10000 },
    );
  }
  private async terminal(
    tx: Tx,
    id: string,
    kind: 'settle' | 'release',
    amount: bigint,
    evidence: string,
    usage: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 },
  ) {
    const r = await tx.chatRequest.findUniqueOrThrow({ where: { id }, include });
    const reservation = r.reservation ?? reject('RESERVATION_MISSING');
    if (reservation.status !== 'held') reject('ALREADY_SETTLED');
    units(amount);
    if (kind === 'release' && amount !== 0n) reject('INVALID_RELEASE');
    for (const hold of reservation.holds) {
      units(hold.budget.spentUnits + amount);
      await tx.aiBudget.update({
        where: { id: hold.budgetId },
        data: {
          reservedUnits: { decrement: reservation.amountUnits },
          spentUnits: { increment: amount },
        },
      });
    }
    await tx.aiReservation.update({
      where: { id: reservation.id },
      data: { status: kind === 'settle' ? 'settled' : 'released' },
    });
    await tx.aiLedgerEntry.create({
      data: { requestId: id, kind, units: amount, currency: reservation.price.currency, evidence },
    });
    await tx.aiUsageRecord.create({
      data: {
        requestId: id,
        sessionId: r.sessionId,
        provider: 'deterministic-fake',
        model: reservation.priceVersion,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reservedCost: decimal(reservation.amountUnits),
        actualCost: decimal(amount),
        currency: reservation.price.currency,
        status: kind === 'settle' ? 'settled' : 'released',
      },
    });
    if (amount > reservation.amountUnits)
      await tx.aiControl.update({
        where: { id: 'global' },
        data: { circuitOpen: true, reason: 'SETTLEMENT_EXCEEDED_RESERVATION' },
      });
  }
  async dispatch(actor: Actor, id: string) {
    return this.db.$transaction(async (tx) => {
      const control = await this.lock(tx);
      const r = await tx.chatRequest.findUniqueOrThrow({ where: { id }, include });
      const s = await this.session(tx, r.sessionId, actor);
      if (r.status !== 'reserved') return { ...r, granted: false };
      try {
        this.enabled(control);
        await this.available(tx, s);
        if (!r.leaseExpiresAt || r.leaseExpiresAt <= this.now()) reject('RESERVATION_EXPIRED');
        if (control.priceVersion !== r.reservation?.priceVersion) reject('PRICE_CHANGED');
        if (
          !r.reservation ||
          r.reservation.amountUnits > control.maxRequestUnits ||
          r.maxOutputTokens > control.maxOutputTokens ||
          r.estimatedInputTokens > control.maxInputTokens
        )
          reject('LIMIT_CHANGED');
        for (const hold of r.reservation!.holds) {
          await tx.$queryRaw`SELECT id FROM "AiBudget" WHERE id=${hold.budgetId}::uuid FOR SHARE`;
          const budget = await tx.aiBudget.findUniqueOrThrow({ where: { id: hold.budgetId } });
          if (
            budget.limitUnits <= 0n ||
            budget.spentUnits + budget.reservedUnits > budget.limitUnits
          )
            reject('BUDGET_CHANGED');
        }
        if (
          (await tx.chatRequest.count({ where: { status: { in: ['running', 'unknown'] } } })) >=
          control.maxRunning
        )
          reject('GLOBAL_BUSY');
      } catch (e) {
        await this.terminal(tx, id, 'release', 0n, digest(id + ':release'));
        return {
          ...(await tx.chatRequest.update({
            where: { id },
            data: {
              status: 'failed',
              errorCode: e instanceof AiError ? e.code : 'DISPATCH_REJECTED',
              updatedAt: this.now(),
            },
          })),
          granted: false,
        };
      }
      await this.event(tx, id, 'DISPATCH_GRANTED_SIMULATED');
      return {
        ...(await tx.chatRequest.update({
          where: { id },
          data: {
            status: 'running',
            fencingToken: { increment: 1 },
            leaseExpiresAt: new Date(this.now().getTime() + 5000),
            updatedAt: this.now(),
          },
        })),
        granted: true,
      };
    });
  }
  async finish(
    id: string,
    fence: bigint,
    result: { content: string; inputTokens: number; outputTokens: number },
  ) {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx);
      const r = await tx.chatRequest.findUniqueOrThrow({ where: { id }, include });
      if (r.status !== 'running' || r.fencingToken !== fence) reject('FENCE_CONFLICT');
      if (result.inputTokens > r.estimatedInputTokens || result.outputTokens > r.maxOutputTokens)
        reject('PROVIDER_USAGE_INVALID');
      const price = r.reservation!.price;
      const amount = estimateCost(
        result.inputTokens,
        result.outputTokens,
        price.inputUnits,
        price.outputUnits,
      );
      await this.terminal(tx, id, 'settle', amount, digest(id + ':settle'), result);
      await tx.$queryRaw`SELECT id FROM "ChatSession" WHERE id=${r.sessionId}::uuid FOR UPDATE`;
      const last = await tx.chatMessage.aggregate({
        where: { sessionId: r.sessionId },
        _max: { sequence: true },
      });
      const seq = last._max.sequence ?? 0;
      await tx.chatMessage.createMany({
        data: [
          {
            sessionId: r.sessionId,
            sequence: seq + 1,
            clientMessageId: r.clientMessageId,
            role: 'user',
            content: r.inputText,
          },
          {
            sessionId: r.sessionId,
            sequence: seq + 2,
            clientMessageId: r.clientMessageId,
            role: 'assistant',
            content: result.content,
          },
        ],
      });
      await this.event(tx, id, 'SUCCEEDED_SIMULATED');
      return tx.chatRequest.update({
        where: { id },
        data: {
          status: 'succeeded',
          response: { ...result, simulated: true },
          updatedAt: this.now(),
        },
      });
    });
  }
  private async failure(id: string, fence: bigint, known: boolean) {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx);
      const r = await tx.chatRequest.findUniqueOrThrow({ where: { id } });
      if (r.status !== 'running' || r.fencingToken !== fence) return r;
      if (known) await this.terminal(tx, id, 'release', 0n, digest(id + ':release'));
      await this.event(tx, id, known ? 'PROVIDER_NO_CHARGE' : 'OUTCOME_UNKNOWN_HOLD_RETAINED');
      if (
        !known ||
        (await tx.aiSafetyEvent.count({
          where: {
            code: 'PROVIDER_NO_CHARGE',
            createdAt: { gte: new Date(this.now().getTime() - 300000) },
          },
        })) >= 3
      )
        await tx.aiControl.update({
          where: { id: 'global' },
          data: { circuitOpen: true, reason: known ? 'PROVIDER_FAILURE_BURST' : 'UNKNOWN_OUTCOME' },
        });
      return tx.chatRequest.update({
        where: { id },
        data: {
          status: known ? 'failed' : 'unknown',
          errorCode: known ? 'FAKE_REJECTED_NO_CHARGE' : 'UNKNOWN_OUTCOME',
          updatedAt: this.now(),
        },
      });
    });
  }
  async runFake(
    actor: Actor,
    sessionId: string,
    key: string,
    content: string,
    maxOutputTokens: number,
    provider: FakeProvider,
  ) {
    assertFake(provider);
    const reserved = await this.reserve(actor, sessionId, key, content, maxOutputTokens);
    if (reserved.status !== 'reserved') return reserved;
    const started = await this.dispatch(actor, reserved.id);
    if (started.status !== 'running' || !started.granted) return started;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        provider.complete(started),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new UnknownOutcome('TIMEOUT')),
            this.options.timeoutMs ?? 2000,
          );
        }),
      ]);
      return await this.finish(started.id, started.fencingToken, value);
    } catch (e) {
      // DB failure after provider acceptance must not become a free failure. If persistence also fails,
      // the durable running lease is left for recovery, which classifies it as unknown.
      return this.failure(started.id, started.fencingToken, e instanceof NoCharge);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async recover() {
    return this.db.$transaction(async (tx) => {
      await this.lock(tx);
      const rows = await tx.chatRequest.findMany({
        where: { status: { in: ['reserved', 'running'] }, leaseExpiresAt: { lte: this.now() } },
        take: 100,
        orderBy: { id: 'asc' },
      });
      for (const r of rows) {
        if (r.status === 'reserved')
          await this.terminal(tx, r.id, 'release', 0n, digest(r.id + ':release'));
        await tx.chatRequest.update({
          where: { id: r.id },
          data: {
            status: r.status === 'reserved' ? 'failed' : 'unknown',
            fencingToken: { increment: 1 },
            errorCode:
              r.status === 'reserved' ? 'EXPIRED_BEFORE_DISPATCH' : 'LEASE_EXPIRED_UNKNOWN',
            updatedAt: this.now(),
          },
        });
        if (r.status === 'running')
          await tx.aiControl.update({
            where: { id: 'global' },
            data: { circuitOpen: true, reason: 'LEASE_EXPIRED_UNKNOWN' },
          });
        await this.event(tx, r.id, 'LEASE_RECOVERY');
      }
      await tx.aiRateBucket.deleteMany({ where: { expiresAt: { lte: this.now() } } });
      return rows.length;
    });
  }
  async reconcile(
    id: string,
    decision: 'settle' | 'release',
    amount: bigint,
    evidenceHash: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(evidenceHash)) reject('EVIDENCE_REQUIRED');
    return this.db.$transaction(async (tx) => {
      await this.lock(tx);
      const r = await tx.chatRequest.findUniqueOrThrow({ where: { id } });
      const prior = await tx.aiLedgerEntry.findUnique({ where: { evidence: evidenceHash } });
      if (prior) {
        if (prior.requestId !== id || prior.kind !== decision || prior.units !== amount)
          reject('EVIDENCE_CONFLICT');
        return r;
      }
      if (r.status !== 'unknown') reject('NOT_UNKNOWN');
      await this.terminal(tx, id, decision, amount, evidenceHash);
      await this.event(tx, id, 'MANUAL_EVIDENCE_RECONCILIATION');
      return tx.chatRequest.update({
        where: { id },
        data: {
          status: decision === 'settle' ? 'succeeded' : 'failed',
          errorCode: 'RECONCILED_SIMULATED',
          updatedAt: this.now(),
        },
      });
    });
  }
  async adjust(id: string, delta: bigint, evidence: string) {
    if (!/^[a-f0-9]{64}$/.test(evidence) || delta > MAX_UNITS || delta < -MAX_UNITS)
      reject('INVALID_ADJUSTMENT');
    return this.db.$transaction(async (tx) => {
      await this.lock(tx);
      const prior = await tx.aiLedgerEntry.findUnique({ where: { evidence } });
      if (prior) {
        if (prior.requestId !== id || prior.kind !== 'adjust' || prior.units !== delta)
          reject('EVIDENCE_CONFLICT');
        return prior;
      }
      const r = await tx.chatRequest.findUniqueOrThrow({ where: { id }, include });
      if (!['succeeded', 'failed'].includes(r.status)) reject('NOT_TERMINAL');
      for (const hold of r.reservation!.holds) {
        units(hold.budget.spentUnits + delta);
        await tx.aiBudget.update({
          where: { id: hold.budgetId },
          data: { spentUnits: { increment: delta } },
        });
      }
      if (delta > 0n)
        await tx.aiControl.update({
          where: { id: 'global' },
          data: { circuitOpen: true, reason: 'POSITIVE_RECONCILIATION_ADJUSTMENT' },
        });
      return tx.aiLedgerEntry.create({
        data: {
          requestId: id,
          kind: 'adjust',
          units: delta,
          currency: r.reservation!.price.currency,
          evidence,
        },
      });
    });
  }
}
