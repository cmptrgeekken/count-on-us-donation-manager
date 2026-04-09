CREATE TABLE "AnalyticalRecalculationRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "summary" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticalRecalculationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticalRecalculationRun_shopId_periodId_createdAt_idx"
ON "AnalyticalRecalculationRun"("shopId", "periodId", "createdAt");

CREATE INDEX "AnalyticalRecalculationRun_periodId_idx"
ON "AnalyticalRecalculationRun"("periodId");

ALTER TABLE "AnalyticalRecalculationRun"
ADD CONSTRAINT "AnalyticalRecalculationRun_periodId_fkey"
FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
