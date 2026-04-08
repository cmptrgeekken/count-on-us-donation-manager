ALTER TABLE "Disbursement"
ADD COLUMN "allocatedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN "extraContributionAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN "feesCoveredAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

UPDATE "Disbursement"
SET "allocatedAmount" = "amount"
WHERE "allocatedAmount" = 0
  AND "extraContributionAmount" = 0
  AND "feesCoveredAmount" = 0;
