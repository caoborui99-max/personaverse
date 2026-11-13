-- Blank drafts and exact source text are permitted. Publication validation is transactional.
ALTER TABLE "PersonaCoreVersion" DROP CONSTRAINT "nonempty_core";
ALTER TABLE "AdminAccount" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'owner', ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AdminAccount" ADD CONSTRAINT "admin_role" CHECK ("role" IN ('owner','viewer'));
ALTER TABLE "AdminSession" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Persona" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Persona" ADD CONSTRAINT "positive_revision" CHECK ("revision" >= 0);
ALTER TABLE "Persona" ADD CONSTRAINT "test_not_published" CHECK (NOT "isTest" OR "status" <> 'published');
CREATE TABLE "LoginAttempt" ("key" CHAR(64) PRIMARY KEY, "windowStart" TIMESTAMPTZ NOT NULL, "count" INTEGER NOT NULL DEFAULT 0 CHECK ("count" >= 0));
