BEGIN;
-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "creationKey" UUID,
ADD COLUMN     "deletedAt" TIMESTAMPTZ,
ADD COLUMN     "userId" UUID;

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" VARCHAR(80) NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "emailVerifiedAt" TIMESTAMPTZ,
    "authVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "authVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "authVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "deliveredAt" TIMESTAMPTZ,
    "usedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,

    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "authVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "deliveredAt" TIMESTAMPTZ,
    "usedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFavorite" (
    "userId" UUID NOT NULL,
    "personaId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFavorite_pkey" PRIMARY KEY ("userId","personaId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_expiresAt_idx" ON "UserSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerification_tokenHash_key" ON "EmailVerification"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerification_userId_expiresAt_idx" ON "EmailVerification"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "EmailVerification_expiresAt_idx" ON "EmailVerification"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_expiresAt_idx" ON "PasswordReset"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");

-- CreateIndex
CREATE INDEX "UserFavorite_userId_createdAt_personaId_idx" ON "UserFavorite"("userId", "createdAt", "personaId");

-- CreateIndex
CREATE INDEX "ChatSession_userId_deletedAt_updatedAt_id_idx" ON "ChatSession"("userId", "deletedAt", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_userId_creationKey_key" ON "ChatSession"("userId", "creationKey");

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UserFavorite" ADD CONSTRAINT "UserFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UserFavorite" ADD CONSTRAINT "UserFavorite_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;


-- Account/session/token constraints are independent of administrator authentication.
ALTER TABLE "User" ADD CONSTRAINT "user_email_normalized"
 CHECK (email=lower(btrim(email)) AND length(email)>3 AND email !~ '[[:space:]]');
ALTER TABLE "User" ADD CONSTRAINT "user_status" CHECK (status IN ('active','deleted'));
ALTER TABLE "User" ADD CONSTRAINT "user_auth_version" CHECK ("authVersion">0);
ALTER TABLE "User" ADD CONSTRAINT "user_active_password" CHECK (status='deleted' OR length("passwordHash")>0);
ALTER TABLE "User" ADD CONSTRAINT "user_deleted_profile" CHECK (status<>'deleted' OR ("displayName"='' AND "emailVerifiedAt" IS NULL));
ALTER TABLE "UserSession" ADD CONSTRAINT "user_session_expiry" CHECK ("expiresAt">"createdAt");
ALTER TABLE "UserSession" ADD CONSTRAINT "user_session_hash" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "UserSession" ADD CONSTRAINT "user_session_version" CHECK ("authVersion">0);
ALTER TABLE "EmailVerification" ADD CONSTRAINT "verification_expiry" CHECK ("expiresAt">"createdAt");
ALTER TABLE "EmailVerification" ADD CONSTRAINT "verification_hash" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "EmailVerification" ADD CONSTRAINT "verification_version" CHECK ("authVersion">0);
ALTER TABLE "PasswordReset" ADD CONSTRAINT "password_reset_expiry" CHECK ("expiresAt">"createdAt");
ALTER TABLE "PasswordReset" ADD CONSTRAINT "password_reset_hash" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "PasswordReset" ADD CONSTRAINT "password_reset_version" CHECK ("authVersion">0);
ALTER TABLE "EmailVerification" ADD CONSTRAINT "verification_delivery" CHECK ("deliveredAt" IS NULL OR "deliveredAt">="createdAt");
ALTER TABLE "EmailVerification" ADD CONSTRAINT "verification_consumption" CHECK ("usedAt" IS NULL OR ("deliveredAt" IS NOT NULL AND "usedAt">="deliveredAt"));
ALTER TABLE "PasswordReset" ADD CONSTRAINT "password_reset_delivery" CHECK ("deliveredAt" IS NULL OR "deliveredAt">="createdAt");
ALTER TABLE "PasswordReset" ADD CONSTRAINT "password_reset_consumption" CHECK ("usedAt" IS NULL OR ("deliveredAt" IS NOT NULL AND "usedAt">="deliveredAt"));

-- Existing visitor/admin rows remain exactly where they were. No anonymous ownership backfill/claim.
ALTER TABLE "ChatSession" DROP CONSTRAINT "exactly_one_owner";
ALTER TABLE "ChatSession" ADD CONSTRAINT "exactly_one_owner"
 CHECK (("adminId" IS NOT NULL)::int+("visitorId" IS NOT NULL)::int+("userId" IS NOT NULL)::int=1);
ALTER TABLE "ChatSession" ADD CONSTRAINT "user_creation_key" CHECK ("creationKey" IS NULL OR "userId" IS NOT NULL);
ALTER TABLE "ChatSession" ADD CONSTRAINT "deleted_chat_closed" CHECK ("deletedAt" IS NULL OR status='closed');
CREATE OR REPLACE FUNCTION pv_reject_chat_rebinding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."personaId",NEW."coreVersionId",NEW."adminId",NEW."visitorId",NEW."userId",NEW."creationKey")
    IS DISTINCT FROM ROW(OLD."personaId",OLD."coreVersionId",OLD."adminId",OLD."visitorId",OLD."userId",OLD."creationKey") THEN
  RAISE EXCEPTION 'Chat identity and ownership are immutable' USING ERRCODE='23514';
 END IF;
 IF OLD."deletedAt" IS NOT NULL AND NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" THEN
  RAISE EXCEPTION 'Chat deletion cannot be reversed or redated' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION pv_guard_user_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='deleted' AND NEW.status<>'deleted' THEN
  RAISE EXCEPTION 'Deleted accounts cannot be reactivated' USING ERRCODE='23514';
 END IF;
 IF NEW."authVersion"<OLD."authVersion" THEN
  RAISE EXCEPTION 'Account auth version cannot decrease' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "guard_user_account" BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION pv_guard_user_account();

CREATE FUNCTION pv_guard_user_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW."userId",NEW."tokenHash",NEW."authVersion",NEW."createdAt",NEW."expiresAt")
    IS DISTINCT FROM ROW(OLD.id,OLD."userId",OLD."tokenHash",OLD."authVersion",OLD."createdAt",OLD."expiresAt") THEN
  RAISE EXCEPTION 'Session identity and absolute expiry are immutable' USING ERRCODE='23514';
 END IF;
 IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
  RAISE EXCEPTION 'Session revocation cannot be reversed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "guard_user_session" BEFORE UPDATE ON "UserSession" FOR EACH ROW EXECUTE FUNCTION pv_guard_user_session();

CREATE FUNCTION pv_guard_user_token() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW."userId",NEW."tokenHash",NEW."authVersion",NEW."createdAt",NEW."expiresAt")
    IS DISTINCT FROM ROW(OLD.id,OLD."userId",OLD."tokenHash",OLD."authVersion",OLD."createdAt",OLD."expiresAt") THEN
  RAISE EXCEPTION 'Token identity and absolute expiry are immutable' USING ERRCODE='23514';
 END IF;
 IF OLD."deliveredAt" IS NOT NULL AND NEW."deliveredAt" IS DISTINCT FROM OLD."deliveredAt" THEN
  RAISE EXCEPTION 'Delivered token activation cannot be reversed or redated' USING ERRCODE='23514';
 END IF;
 IF OLD."usedAt" IS NOT NULL AND NEW."usedAt" IS DISTINCT FROM OLD."usedAt" THEN
  RAISE EXCEPTION 'Consumed tokens cannot be reused' USING ERRCODE='23514';
 END IF;
 IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
  RAISE EXCEPTION 'Revoked tokens cannot be restored' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "guard_email_verification" BEFORE UPDATE ON "EmailVerification" FOR EACH ROW EXECUTE FUNCTION pv_guard_user_token();
CREATE TRIGGER "guard_password_reset" BEFORE UPDATE ON "PasswordReset" FOR EACH ROW EXECUTE FUNCTION pv_guard_user_token();

-- Hold a shared session lock so deletion cannot interleave between this check and the write.
-- Closed sessions may still receive an already-admitted response; newly-started sends are checked by API.
CREATE FUNCTION pv_guard_chat_message_privacy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE erased timestamptz;
BEGIN
 IF TG_OP='UPDATE' AND NEW."sessionId" IS DISTINCT FROM OLD."sessionId" THEN
  RAISE EXCEPTION 'Message session is immutable' USING ERRCODE='23514';
 END IF;
 SELECT "deletedAt" INTO erased FROM "ChatSession" WHERE id=NEW."sessionId" FOR SHARE;
 IF erased IS NOT NULL THEN
  RAISE EXCEPTION 'Deleted chats cannot receive or restore messages' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "guard_chat_message_privacy" BEFORE INSERT OR UPDATE ON "ChatMessage" FOR EACH ROW EXECUTE FUNCTION pv_guard_chat_message_privacy();

CREATE FUNCTION pv_guard_new_request_privacy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE erased timestamptz;
BEGIN
 SELECT "deletedAt" INTO erased FROM "ChatSession" WHERE id=NEW."sessionId" FOR SHARE;
 IF erased IS NOT NULL THEN
  RAISE EXCEPTION 'Deleted chats cannot start requests' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "guard_new_request_privacy" BEFORE INSERT ON "ChatRequest" FOR EACH ROW EXECUTE FUNCTION pv_guard_new_request_privacy();

-- Privacy payload and immutable financial facts have different retention needs.
-- A trusted transaction may irreversibly empty request text/result AFTER deleting the owning chat.
-- The intent setting is NOT user authentication; authenticated ownership checks remain mandatory in API.
-- Every other request field, financial record, core version and owner remains unchanged.
CREATE OR REPLACE FUNCTION pv_guard_ai_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE erased boolean;
BEGIN
 SELECT "deletedAt" IS NOT NULL INTO erased FROM "ChatSession" WHERE id=NEW."sessionId" FOR SHARE;
 IF COALESCE(erased,false) AND current_setting('personaverse.privacy_action',true)='erase'
    AND NEW."inputText"='' AND NEW.response IS NULL
    AND (to_jsonb(NEW)-'inputText'-'response')=(to_jsonb(OLD)-'inputText'-'response') THEN
  RETURN NEW;
 END IF;
 IF COALESCE(erased,false) AND (NEW."inputText"<>'' OR NEW.response IS NOT NULL) THEN
  RAISE EXCEPTION 'Deleted request payload cannot be restored' USING ERRCODE='23514';
 END IF;
 IF ROW(NEW."sessionId",NEW."coreVersionId",NEW."clientMessageId",NEW.fingerprint,NEW."inputText",NEW."contextSequence",NEW."maxOutputTokens",NEW."estimatedInputTokens")
    IS DISTINCT FROM ROW(OLD."sessionId",OLD."coreVersionId",OLD."clientMessageId",OLD.fingerprint,OLD."inputText",OLD."contextSequence",OLD."maxOutputTokens",OLD."estimatedInputTokens") THEN
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
COMMIT;
