-- Repair environments where the lifecycle migration was recorded as applied
-- before the reporting-period rebuild columns were created.
ALTER TABLE "ReportingPeriod"
    ADD COLUMN IF NOT EXISTS "rebuildRequired" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "rebuildRequestedAt" TIMESTAMP(3);
