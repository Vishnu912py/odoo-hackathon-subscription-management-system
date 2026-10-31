CREATE TABLE "auth_email_jobs" (
  "id" UUID PRIMARY KEY, "encrypted_message" TEXT, "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0, "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMPTZ(6), "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "auth_email_jobs_available_at_idx" ON "auth_email_jobs"("available_at");
CREATE TABLE "auth_rate_limits" (
  "key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL DEFAULT 1, "expires_at" TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX "auth_rate_limits_expires_at_idx" ON "auth_rate_limits"("expires_at");
