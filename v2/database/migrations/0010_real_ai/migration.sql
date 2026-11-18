BEGIN;
-- Additive capability only: no prices, budgets or enabled switches are provisioned.
ALTER TABLE "AiPrice" DROP CONSTRAINT "price_nonnegative_simulated";
ALTER TABLE "AiPrice" ADD CONSTRAINT "price_nonnegative" CHECK ("inputUnits">=0 AND "outputUnits">=0 AND currency ~ '^[A-Z]{3}$');
ALTER TABLE "AiLedgerEntry" DROP CONSTRAINT "ledger_values";
ALTER TABLE "AiLedgerEntry" ADD CONSTRAINT "ledger_values" CHECK (kind IN ('reserve','settle','release','adjust') AND (kind='adjust' OR units>=0));
COMMIT;
