-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "AdminAccount" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "background" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "draftVersionId" UUID,
    "publishedVersionId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaCoreVersion" (
    "id" UUID NOT NULL,
    "personaId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "coreText" TEXT NOT NULL,
    "openingMessage" TEXT NOT NULL,
    "profileSnapshot" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "restoredFromId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaCoreVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaCategory" (
    "personaId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "PersonaCategory_pkey" PRIMARY KEY ("personaId","categoryId")
);

-- CreateTable
CREATE TABLE "VisitorSession" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,

    CONSTRAINT "VisitorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" UUID NOT NULL,
    "personaId" UUID NOT NULL,
    "coreVersionId" UUID NOT NULL,
    "adminId" UUID,
    "visitorId" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "clientMessageId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'complete',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatRequest" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "clientMessageId" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "status" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMPTZ,
    "response" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageRecord" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "reservedCost" DECIMAL(18,8) NOT NULL,
    "actualCost" DECIMAL(18,8),
    "currency" CHAR(3) NOT NULL DEFAULT 'CNY',
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaBucket" (
    "scope" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bucketStart" TIMESTAMPTZ NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "reservedCost" DECIMAL(18,8) NOT NULL DEFAULT 0,

    CONSTRAINT "QuotaBucket_pkey" PRIMARY KEY ("scope","subject","bucketStart")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "requestId" TEXT NOT NULL,
    "changeSummary" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminAccount_email_key" ON "AdminAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_adminId_expiresAt_idx" ON "AdminSession"("adminId", "expiresAt");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Persona_slug_key" ON "Persona"("slug");

-- CreateIndex
CREATE INDEX "Persona_status_updatedAt_id_idx" ON "Persona"("status", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaCoreVersion_personaId_versionNumber_key" ON "PersonaCoreVersion"("personaId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaCoreVersion_personaId_id_key" ON "PersonaCoreVersion"("personaId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "PersonaCategory_categoryId_personaId_idx" ON "PersonaCategory"("categoryId", "personaId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorSession_tokenHash_key" ON "VisitorSession"("tokenHash");

-- CreateIndex
CREATE INDEX "VisitorSession_expiresAt_idx" ON "VisitorSession"("expiresAt");

-- CreateIndex
CREATE INDEX "ChatSession_adminId_updatedAt_idx" ON "ChatSession"("adminId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatSession_visitorId_updatedAt_idx" ON "ChatSession"("visitorId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_sessionId_sequence_key" ON "ChatMessage"("sessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_sessionId_clientMessageId_role_key" ON "ChatMessage"("sessionId", "clientMessageId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ChatRequest_sessionId_clientMessageId_key" ON "ChatRequest"("sessionId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageRecord_requestId_key" ON "AiUsageRecord"("requestId");

-- CreateIndex
CREATE INDEX "AiUsageRecord_createdAt_status_idx" ON "AiUsageRecord"("createdAt", "status");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_objectType_objectId_createdAt_idx" ON "AdminAuditLog"("objectType", "objectId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaCoreVersion" ADD CONSTRAINT "PersonaCoreVersion_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaCoreVersion" ADD CONSTRAINT "PersonaCoreVersion_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "AdminAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaCategory" ADD CONSTRAINT "PersonaCategory_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaCategory" ADD CONSTRAINT "PersonaCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_personaId_coreVersionId_fkey" FOREIGN KEY ("personaId", "coreVersionId") REFERENCES "PersonaCoreVersion"("personaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "VisitorSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatRequest" ADD CONSTRAINT "ChatRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageRecord" ADD CONSTRAINT "AiUsageRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Additional invariants intentionally maintained in SQL (Prisma cannot express CHECK/trigger).
ALTER TABLE "AdminAccount" ADD CONSTRAINT "admin_email_normalized" CHECK ("email" = lower(trim("email")));
ALTER TABLE "AdminAccount" ADD CONSTRAINT "admin_status" CHECK ("status" IN ('active','disabled'));
ALTER TABLE "Persona" ADD CONSTRAINT "persona_status" CHECK ("status" IN ('draft','published','archived'));
ALTER TABLE "Persona" ADD CONSTRAINT "published_requires_version" CHECK ("status" <> 'published' OR "publishedVersionId" IS NOT NULL);
ALTER TABLE "Persona" ADD CONSTRAINT "persona_draft_version_owner" FOREIGN KEY ("id", "draftVersionId") REFERENCES "PersonaCoreVersion"("personaId", "id") ON DELETE RESTRICT;
ALTER TABLE "Persona" ADD CONSTRAINT "persona_published_version_owner" FOREIGN KEY ("id", "publishedVersionId") REFERENCES "PersonaCoreVersion"("personaId", "id") ON DELETE RESTRICT;
ALTER TABLE "PersonaCoreVersion" ADD CONSTRAINT "positive_version" CHECK ("versionNumber" > 0);
ALTER TABLE "PersonaCoreVersion" ADD CONSTRAINT "nonempty_core" CHECK (length(trim("coreText")) > 0);
ALTER TABLE "PersonaCoreVersion" ADD CONSTRAINT "restored_version_owner" FOREIGN KEY ("personaId", "restoredFromId") REFERENCES "PersonaCoreVersion"("personaId", "id") ON DELETE RESTRICT;
ALTER TABLE "ChatSession" ADD CONSTRAINT "exactly_one_owner" CHECK (("adminId" IS NOT NULL)::int + ("visitorId" IS NOT NULL)::int = 1);
ALTER TABLE "ChatSession" ADD CONSTRAINT "chat_status" CHECK ("status" IN ('active','closed'));
ALTER TABLE "ChatMessage" ADD CONSTRAINT "valid_message_role" CHECK ("role" IN ('user','assistant'));
ALTER TABLE "ChatMessage" ADD CONSTRAINT "positive_sequence" CHECK ("sequence" > 0);
ALTER TABLE "ChatMessage" ADD CONSTRAINT "message_status" CHECK ("status" IN ('pending','complete','failed'));
ALTER TABLE "ChatRequest" ADD CONSTRAINT "request_status" CHECK ("status" IN ('pending','complete','failed','unknown'));
ALTER TABLE "AiUsageRecord" ADD CONSTRAINT "nonnegative_usage" CHECK ("inputTokens" >= 0 AND "outputTokens" >= 0 AND "reservedCost" >= 0 AND ("actualCost" IS NULL OR "actualCost" >= 0));
ALTER TABLE "AiUsageRecord" ADD CONSTRAINT "usage_request" FOREIGN KEY ("requestId") REFERENCES "ChatRequest"("id") ON DELETE RESTRICT;
ALTER TABLE "QuotaBucket" ADD CONSTRAINT "nonnegative_quota" CHECK ("calls" >= 0 AND "reservedCost" >= 0);
ALTER TABLE "AdminSession" ADD CONSTRAINT "admin_session_expiry" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "VisitorSession" ADD CONSTRAINT "visitor_session_expiry" CHECK ("expiresAt" > "createdAt");
CREATE FUNCTION pv_reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable record: append a new version or audit entry instead';
END;
$$;
CREATE TRIGGER "immutable_persona_core_version" BEFORE UPDATE OR DELETE ON "PersonaCoreVersion" FOR EACH ROW EXECUTE FUNCTION pv_reject_immutable_change();
CREATE TRIGGER "immutable_admin_audit" BEFORE UPDATE OR DELETE ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION pv_reject_immutable_change();
