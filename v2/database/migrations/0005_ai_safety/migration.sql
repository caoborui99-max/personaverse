BEGIN;
-- Legacy financial/request rows require explicit reconciliation, never silent backfill.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM "ChatRequest") OR EXISTS(SELECT 1 FROM "AiUsageRecord") THEN
  RAISE EXCEPTION 'Legacy AI requests/usage require owner reconciliation before 0005';
 END IF;
END; $$;
-- DropForeignKey
ALTER TABLE "ChatRequest" DROP CONSTRAINT "ChatRequest_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "AiUsageRecord" DROP CONSTRAINT "usage_request";

-- AlterTable
ALTER TABLE "ChatRequest" ADD COLUMN     "contextSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "coreVersionId" UUID NOT NULL,
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "estimatedInputTokens" INTEGER NOT NULL,
ADD COLUMN     "fencingToken" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "inputText" TEXT NOT NULL,
ADD COLUMN     "maxOutputTokens" INTEGER NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "AiControl" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "privacySalt" TEXT NOT NULL DEFAULT (gen_random_uuid()::text || gen_random_uuid()::text),
    "fakeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "circuitOpen" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL DEFAULT '',
    "priceVersion" TEXT NOT NULL DEFAULT '',
    "maxRequestUnits" BIGINT NOT NULL DEFAULT 0,
    "maxInputTokens" INTEGER NOT NULL DEFAULT 0,
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "maxRunning" INTEGER NOT NULL DEFAULT 0,
    "ratePerMinute" INTEGER NOT NULL DEFAULT 0,
    "requestsPerDay" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPrice" (
    "version" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "inputUnits" BIGINT NOT NULL,
    "outputUnits" BIGINT NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AiPrice_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "AiBudget" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "limitUnits" BIGINT NOT NULL DEFAULT 0,
    "reservedUnits" BIGINT NOT NULL DEFAULT 0,
    "spentUnits" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "AiBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReservation" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "priceVersion" TEXT NOT NULL,
    "amountUnits" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'held',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiHold" (
    "reservationId" UUID NOT NULL,
    "budgetId" UUID NOT NULL,

    CONSTRAINT "AiHold_pkey" PRIMARY KEY ("reservationId","budgetId")
);

-- CreateTable
CREATE TABLE "AiLedgerEntry" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "units" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "evidence" TEXT NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRateBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AiRateBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AiSafetyEvent" (
    "id" UUID NOT NULL,
    "requestId" TEXT,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSafetyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiBudget_scope_subject_period_currency_key" ON "AiBudget"("scope", "subject", "period", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "AiReservation_requestId_key" ON "AiReservation"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AiLedgerEntry_evidence_key" ON "AiLedgerEntry"("evidence");

-- CreateIndex
CREATE INDEX "AiLedgerEntry_requestId_createdAt_idx" ON "AiLedgerEntry"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_id_coreVersionId_key" ON "ChatSession"("id", "coreVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRequest_sessionId_id_key" ON "ChatRequest"("sessionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageRecord_sessionId_requestId_key" ON "AiUsageRecord"("sessionId", "requestId");

-- AddForeignKey
ALTER TABLE "ChatRequest" ADD CONSTRAINT "ChatRequest_sessionId_fkey" FOREIGN KEY ("sessionId", "coreVersionId") REFERENCES "ChatSession"("id", "coreVersionId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AiUsageRecord" ADD CONSTRAINT "usage_request" FOREIGN KEY ("sessionId", "requestId") REFERENCES "ChatRequest"("sessionId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AiReservation" ADD CONSTRAINT "AiReservation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ChatRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReservation" ADD CONSTRAINT "AiReservation_priceVersion_fkey" FOREIGN KEY ("priceVersion") REFERENCES "AiPrice"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiHold" ADD CONSTRAINT "AiHold_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "AiReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiHold" ADD CONSTRAINT "AiHold_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "AiBudget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiLedgerEntry" ADD CONSTRAINT "AiLedgerEntry_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ChatRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "ChatRequest" DROP CONSTRAINT "request_status";
ALTER TABLE "ChatRequest" ADD CONSTRAINT "request_status" CHECK (status IN ('pending','reserved','running','succeeded','failed','unknown'));
ALTER TABLE "ChatRequest" ADD CONSTRAINT "request_limits" CHECK ("estimatedInputTokens">=0 AND "maxOutputTokens">0 AND "contextSequence">=0 AND "fencingToken">=0);
CREATE UNIQUE INDEX "one_active_ai_request_per_session" ON "ChatRequest"("sessionId") WHERE status IN ('reserved','running','unknown');
ALTER TABLE "AiControl" ADD CONSTRAINT "control_limits" CHECK (id='global' AND "maxRequestUnits">=0 AND "maxInputTokens">=0 AND "maxOutputTokens">=0 AND "maxRunning">=0 AND "ratePerMinute">=0 AND "requestsPerDay">=0);
ALTER TABLE "AiPrice" ADD CONSTRAINT "price_nonnegative_simulated" CHECK ("inputUnits">=0 AND "outputUnits">=0 AND simulated AND currency ~ '^[A-Z]{3}$');
ALTER TABLE "AiBudget" ADD CONSTRAINT "budget_nonnegative" CHECK ("limitUnits">=0 AND "reservedUnits">=0 AND "spentUnits">=0);
ALTER TABLE "AiReservation" ADD CONSTRAINT "reservation_state" CHECK ("amountUnits">=0 AND status IN ('held','settled','released'));
ALTER TABLE "AiLedgerEntry" ADD CONSTRAINT "ledger_values" CHECK (simulated AND kind IN ('reserve','settle','release','adjust') AND (kind='adjust' OR units>=0));
ALTER TABLE "AiRateBucket" ADD CONSTRAINT "rate_nonnegative" CHECK (count>=0);
CREATE UNIQUE INDEX "one_terminal_ai_settlement" ON "AiLedgerEntry"("requestId") WHERE kind IN ('settle','release');
CREATE UNIQUE INDEX "one_ai_reservation_entry" ON "AiLedgerEntry"("requestId") WHERE kind='reserve';
CREATE TRIGGER immutable_ai_price BEFORE UPDATE OR DELETE ON "AiPrice" FOR EACH ROW EXECUTE FUNCTION pv_reject_immutable_change();
CREATE TRIGGER immutable_ai_ledger BEFORE UPDATE OR DELETE ON "AiLedgerEntry" FOR EACH ROW EXECUTE FUNCTION pv_reject_immutable_change();
CREATE TRIGGER immutable_ai_usage BEFORE UPDATE OR DELETE ON "AiUsageRecord" FOR EACH ROW EXECUTE FUNCTION pv_reject_immutable_change();
CREATE TRIGGER immutable_ai_event BEFORE UPDATE OR DELETE ON "AiSafetyEvent" FOR EACH ROW EXECUTE FUNCTION pv_reject_immutable_change();
CREATE FUNCTION pv_guard_ai_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."sessionId",NEW."coreVersionId",NEW."clientMessageId",NEW.fingerprint,NEW."inputText",NEW."contextSequence",NEW."maxOutputTokens",NEW."estimatedInputTokens") IS DISTINCT FROM ROW(OLD."sessionId",OLD."coreVersionId",OLD."clientMessageId",OLD.fingerprint,OLD."inputText",OLD."contextSequence",OLD."maxOutputTokens",OLD."estimatedInputTokens") THEN
  RAISE EXCEPTION 'AI request identity/input is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.status IN ('succeeded','failed') THEN RAISE EXCEPTION 'Terminal request immutable' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND NOT (
  (OLD.status='pending' AND NEW.status IN ('reserved','failed')) OR
  (OLD.status='reserved' AND NEW.status IN ('running','failed')) OR
  (OLD.status='running' AND NEW.status IN ('succeeded','failed','unknown')) OR
  (OLD.status='unknown' AND NEW.status IN ('succeeded','failed'))
 ) THEN RAISE EXCEPTION 'Illegal AI transition' USING ERRCODE='23514'; END IF;
 IF NEW."fencingToken"<OLD."fencingToken" THEN RAISE EXCEPTION 'Fence cannot decrease' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_ai_request BEFORE UPDATE ON "ChatRequest" FOR EACH ROW EXECUTE FUNCTION pv_guard_ai_request();
CREATE FUNCTION pv_guard_ai_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."requestId",NEW."priceVersion",NEW."amountUnits") IS DISTINCT FROM ROW(OLD."requestId",OLD."priceVersion",OLD."amountUnits") OR OLD.status<>'held' OR NEW.status NOT IN ('settled','released') THEN
  RAISE EXCEPTION 'Reservation immutable except one terminal decision' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER guard_ai_reservation BEFORE UPDATE ON "AiReservation" FOR EACH ROW EXECUTE FUNCTION pv_guard_ai_reservation();
CREATE FUNCTION pv_guard_ai_hold_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "AiBudget" b JOIN "AiReservation" r ON r.id=NEW."reservationId" JOIN "AiPrice" p ON p.version=r."priceVersion" WHERE b.id=NEW."budgetId" AND b.currency=p.currency) THEN
  RAISE EXCEPTION 'Budget currency mismatch' USING ERRCODE='23514';
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER guard_ai_hold_currency BEFORE INSERT ON "AiHold" FOR EACH ROW EXECUTE FUNCTION pv_guard_ai_hold_currency();
INSERT INTO "AiControl"(id) VALUES ('global');
COMMIT;
