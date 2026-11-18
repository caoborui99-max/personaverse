BEGIN;
-- Keep integer units representable by existing Decimal(18,8) usage columns.
-- Invalid data fails the migration transaction; never backfill or rewrite financial history.
ALTER TABLE "AiBudget" ADD CONSTRAINT budget_precision CHECK ("limitUnits"<=999999999999999999 AND "reservedUnits"<=999999999999999999 AND "spentUnits"<=999999999999999999);
ALTER TABLE "AiReservation" ADD CONSTRAINT reservation_precision CHECK ("amountUnits"<=999999999999999999);
ALTER TABLE "AiLedgerEntry" ADD CONSTRAINT ledger_precision CHECK (units BETWEEN -999999999999999999 AND 999999999999999999);
CREATE TRIGGER immutable_ai_hold BEFORE UPDATE OR DELETE ON "AiHold" FOR EACH ROW EXECUTE FUNCTION pv_reject_immutable_change();
COMMIT;
