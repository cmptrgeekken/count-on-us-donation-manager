ALTER TABLE "Shop"
ADD COLUMN "effectiveTaxRate" DECIMAL(5,4),
ADD COLUMN "taxDeductionMode" TEXT NOT NULL DEFAULT 'dont_deduct';

ALTER TABLE "TaxTrueUp"
ADD COLUMN "appliedPeriodId" TEXT;

CREATE TABLE "TaxTrueUpRedistribution" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "trueUpId" TEXT NOT NULL,
    "causeId" TEXT NOT NULL,
    "causeName" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxTrueUpRedistribution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaxTrueUp_appliedPeriodId_idx" ON "TaxTrueUp"("appliedPeriodId");
CREATE INDEX "TaxTrueUpRedistribution_shopId_idx" ON "TaxTrueUpRedistribution"("shopId");
CREATE INDEX "TaxTrueUpRedistribution_trueUpId_idx" ON "TaxTrueUpRedistribution"("trueUpId");

ALTER TABLE "TaxTrueUp"
ADD CONSTRAINT "TaxTrueUp_appliedPeriodId_fkey" FOREIGN KEY ("appliedPeriodId") REFERENCES "ReportingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaxTrueUpRedistribution"
ADD CONSTRAINT "TaxTrueUpRedistribution_trueUpId_fkey" FOREIGN KEY ("trueUpId") REFERENCES "TaxTrueUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaxTrueUpRedistribution"
ADD CONSTRAINT "TaxTrueUpRedistribution_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "Cause"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
