CREATE UNIQUE INDEX "ChatSession_userId_id_key" ON "ChatSession"("userId",id);
CREATE TABLE "UserChatDay" (
 "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 day CHAR(10) NOT NULL CHECK (day ~ '^\d{4}-\d{2}-\d{2}$'),
 "usedMs" INTEGER NOT NULL DEFAULT 0 CHECK ("usedMs" BETWEEN 0 AND 3600000),
 "usedTokens" INTEGER NOT NULL DEFAULT 0 CHECK ("usedTokens" BETWEEN 0 AND 100000),
 PRIMARY KEY ("userId",day)
);
CREATE TABLE "UserChatClock" (
 "userId" UUID PRIMARY KEY REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 "ownerSessionId" UUID, "chatId" UUID, "leaseId" UUID,
 "settledAt" TIMESTAMPTZ, "leaseUntil" TIMESTAMPTZ, "activityAt" TIMESTAMPTZ,
 FOREIGN KEY ("userId","ownerSessionId") REFERENCES "UserSession"("userId",id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 FOREIGN KEY ("userId","chatId") REFERENCES "ChatSession"("userId",id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 CHECK (("leaseId" IS NULL AND "ownerSessionId" IS NULL AND "chatId" IS NULL AND "settledAt" IS NULL AND "leaseUntil" IS NULL AND "activityAt" IS NULL)
 OR ("leaseId" IS NOT NULL AND "ownerSessionId" IS NOT NULL AND "chatId" IS NOT NULL AND "settledAt" IS NOT NULL AND "leaseUntil" IS NOT NULL AND "activityAt" IS NOT NULL AND "leaseUntil" >= "settledAt"))
);
CREATE TABLE "ChatActivityEvent" (
 "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 "eventId" UUID NOT NULL, fingerprint CHAR(64) NOT NULL, response JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("userId","eventId")
);
CREATE INDEX "ChatActivityEvent_createdAt_idx" ON "ChatActivityEvent"("createdAt");
