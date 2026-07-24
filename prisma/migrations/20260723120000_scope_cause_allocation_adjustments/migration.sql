DROP INDEX "CauseAllocationAdjustment_causeAllocationId_type_sourceKey_key";

CREATE UNIQUE INDEX "CauseAllocationAdjustment_shopId_causeAllocationId_type_sourceKey_key"
ON "CauseAllocationAdjustment"("shopId", "causeAllocationId", "type", "sourceKey");
