CREATE TABLE "DisbursementApplication" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "disbursementId" TEXT NOT NULL,
    "causeAllocationId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisbursementApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DisbursementApplication_disbursementId_causeAllocationId_key"
ON "DisbursementApplication"("disbursementId", "causeAllocationId");

CREATE INDEX "DisbursementApplication_shopId_idx"
ON "DisbursementApplication"("shopId");

CREATE INDEX "DisbursementApplication_causeAllocationId_idx"
ON "DisbursementApplication"("causeAllocationId");

ALTER TABLE "DisbursementApplication"
ADD CONSTRAINT "DisbursementApplication_disbursementId_fkey"
FOREIGN KEY ("disbursementId") REFERENCES "Disbursement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DisbursementApplication"
ADD CONSTRAINT "DisbursementApplication_causeAllocationId_fkey"
FOREIGN KEY ("causeAllocationId") REFERENCES "CauseAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
