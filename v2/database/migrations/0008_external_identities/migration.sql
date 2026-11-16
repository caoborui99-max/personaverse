-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'rengine',
    "softwareId" VARCHAR(80) NOT NULL,
    "subject" VARCHAR(128) NOT NULL,
    "subjectUuid" VARCHAR(128) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalAuthTransaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "authVersion" INTEGER NOT NULL,
    "softwareId" VARCHAR(80) NOT NULL,
    "stateHash" CHAR(64) NOT NULL,
    "browserHash" CHAR(64) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ExternalAuthTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_provider_softwareId_subject_key" ON "ExternalIdentity"("provider", "softwareId", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_provider_softwareId_subjectUuid_key" ON "ExternalIdentity"("provider", "softwareId", "subjectUuid");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_userId_provider_softwareId_key" ON "ExternalIdentity"("userId", "provider", "softwareId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalAuthTransaction_stateHash_key" ON "ExternalAuthTransaction"("stateHash");

-- CreateIndex
CREATE INDEX "ExternalAuthTransaction_expiresAt_status_idx" ON "ExternalAuthTransaction"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_userId_id_key" ON "UserSession"("userId", "id");

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ExternalAuthTransaction" ADD CONSTRAINT "ExternalAuthTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ExternalAuthTransaction" ADD CONSTRAINT "ExternalAuthTransaction_userId_sessionId_fkey" FOREIGN KEY ("userId", "sessionId") REFERENCES "UserSession"("userId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;


ALTER TABLE "ExternalIdentity" ADD CONSTRAINT external_identity_status CHECK(status IN ('active','disabled'));
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT external_identity_provider CHECK(provider='rengine');
ALTER TABLE "ExternalAuthTransaction" ADD CONSTRAINT external_transaction_state CHECK(status IN ('pending','exchanging','complete','failed'));
ALTER TABLE "ExternalAuthTransaction" ADD CONSTRAINT external_transaction_expiry CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '3 minutes');
CREATE FUNCTION guard_external_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
IF ROW(NEW.id,NEW."userId",NEW.provider,NEW."softwareId",NEW.subject,NEW."subjectUuid",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."userId",OLD.provider,OLD."softwareId",OLD.subject,OLD."subjectUuid",OLD."createdAt") OR (OLD.status='disabled' AND NEW.status<>'disabled') THEN RAISE EXCEPTION 'External identity immutable'; END IF;
RETURN NEW; END $$;
CREATE TRIGGER external_identity_immutable BEFORE UPDATE ON "ExternalIdentity" FOR EACH ROW EXECUTE FUNCTION guard_external_identity();
CREATE FUNCTION guard_external_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
IF ROW(NEW.id,NEW."userId",NEW."sessionId",NEW."authVersion",NEW."softwareId",NEW."stateHash",NEW."browserHash",NEW."createdAt",NEW."expiresAt") IS DISTINCT FROM ROW(OLD.id,OLD."userId",OLD."sessionId",OLD."authVersion",OLD."softwareId",OLD."stateHash",OLD."browserHash",OLD."createdAt",OLD."expiresAt") OR NOT (NEW.status=OLD.status OR (OLD.status='pending' AND NEW.status IN ('exchanging','failed')) OR (OLD.status='exchanging' AND NEW.status IN ('complete','failed'))) THEN RAISE EXCEPTION 'External transaction immutable or illegal transition'; END IF;
RETURN NEW; END $$;
CREATE TRIGGER external_transaction_immutable BEFORE UPDATE ON "ExternalAuthTransaction" FOR EACH ROW EXECUTE FUNCTION guard_external_transaction();
