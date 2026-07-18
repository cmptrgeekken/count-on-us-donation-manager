CREATE TABLE "CauseAllocationAdjustment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "causeAllocationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CauseAllocationAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CauseAllocationAdjustment_shopId_idx" ON "CauseAllocationAdjustment"("shopId");
CREATE INDEX "CauseAllocationAdjustment_causeAllocationId_effectiveAt_idx" ON "CauseAllocationAdjustment"("causeAllocationId", "effectiveAt");
CREATE UNIQUE INDEX "CauseAllocationAdjustment_causeAllocationId_type_sourceKey_key" ON "CauseAllocationAdjustment"("causeAllocationId", "type", "sourceKey");

ALTER TABLE "CauseAllocationAdjustment"
ADD CONSTRAINT "CauseAllocationAdjustment_causeAllocationId_fkey"
FOREIGN KEY ("causeAllocationId") REFERENCES "CauseAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
