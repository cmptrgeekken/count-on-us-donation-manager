-- ADR-029: stable logical orders, immutable snapshot revisions, and lifecycle evidence.

ALTER TABLE "ReportingPeriod"
    ADD COLUMN "rebuildRequired" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "rebuildRequestedAt" TIMESTAMP(3);

CREATE TABLE "OrderRecord" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "currentSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderRecord_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OrderSnapshot"
    ADD COLUMN "orderRecordId" TEXT,
    ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "replacementSource" TEXT,
    ADD COLUMN "replacementReason" TEXT;

INSERT INTO "OrderRecord" ("id", "shopId", "shopifyOrderId", "createdAt", "updatedAt")
SELECT
    CONCAT('ord_', MD5("shopId" || ':' || "shopifyOrderId")),
    "shopId",
    "shopifyOrderId",
    MIN("createdAt"),
    CURRENT_TIMESTAMP
FROM "OrderSnapshot"
GROUP BY "shopId", "shopifyOrderId";

UPDATE "OrderSnapshot" AS snapshot
SET "orderRecordId" = record."id"
FROM "OrderRecord" AS record
WHERE record."shopId" = snapshot."shopId"
  AND record."shopifyOrderId" = snapshot."shopifyOrderId";

ALTER TABLE "OrderSnapshot" ALTER COLUMN "orderRecordId" SET NOT NULL;

UPDATE "OrderRecord" AS record
SET "currentSnapshotId" = snapshot."id"
FROM "OrderSnapshot" AS snapshot
WHERE snapshot."orderRecordId" = record."id";

DROP INDEX "OrderSnapshot_shopId_shopifyOrderId_key";

CREATE UNIQUE INDEX "OrderRecord_shopId_shopifyOrderId_key" ON "OrderRecord"("shopId", "shopifyOrderId");
CREATE UNIQUE INDEX "OrderRecord_currentSnapshotId_key" ON "OrderRecord"("currentSnapshotId");
CREATE INDEX "OrderRecord_shopId_idx" ON "OrderRecord"("shopId");
CREATE UNIQUE INDEX "OrderSnapshot_orderRecordId_revision_key" ON "OrderSnapshot"("orderRecordId", "revision");
CREATE INDEX "OrderSnapshot_shopId_shopifyOrderId_idx" ON "OrderSnapshot"("shopId", "shopifyOrderId");

ALTER TABLE "OrderSnapshot"
    ADD CONSTRAINT "OrderSnapshot_orderRecordId_fkey"
    FOREIGN KEY ("orderRecordId") REFERENCES "OrderRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderRecord"
    ADD CONSTRAINT "OrderRecord_currentSnapshotId_fkey"
    FOREIGN KEY ("currentSnapshotId") REFERENCES "OrderSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OrderLifecycle" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderRecordId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'unknown',
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'unknown',
    "sourceUpdatedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderLifecycle_pkey" PRIMARY KEY ("id")
);

INSERT INTO "OrderLifecycle" (
    "id", "shopId", "orderRecordId", "state", "source", "reviewReason", "createdAt", "updatedAt"
)
SELECT
    CONCAT('life_', MD5(record."id")),
    record."shopId",
    record."id",
    'unknown',
    'migration',
    'Lifecycle evidence requires reconciliation',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "OrderRecord" AS record;

CREATE UNIQUE INDEX "OrderLifecycle_orderRecordId_key" ON "OrderLifecycle"("orderRecordId");
CREATE INDEX "OrderLifecycle_shopId_state_idx" ON "OrderLifecycle"("shopId", "state");
ALTER TABLE "OrderLifecycle"
    ADD CONSTRAINT "OrderLifecycle_orderRecordId_fkey"
    FOREIGN KEY ("orderRecordId") REFERENCES "OrderRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrderRefundEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderRecordId" TEXT NOT NULL,
    "shopifyRefundId" TEXT NOT NULL,
    "refundedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'webhook',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderRefundEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderRefundEvent_shopId_shopifyRefundId_key" ON "OrderRefundEvent"("shopId", "shopifyRefundId");
CREATE INDEX "OrderRefundEvent_shopId_orderRecordId_idx" ON "OrderRefundEvent"("shopId", "orderRecordId");
ALTER TABLE "OrderRefundEvent"
    ADD CONSTRAINT "OrderRefundEvent_orderRecordId_fkey"
    FOREIGN KEY ("orderRecordId") REFERENCES "OrderRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrderRefundLine" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "refundEventId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "quantity" DECIMAL(10,4) NOT NULL,
    "refundedSubtotalAmount" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderRefundLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderRefundLine_refundEventId_shopifyLineItemId_key" ON "OrderRefundLine"("refundEventId", "shopifyLineItemId");
CREATE INDEX "OrderRefundLine_shopId_shopifyLineItemId_idx" ON "OrderRefundLine"("shopId", "shopifyLineItemId");
ALTER TABLE "OrderRefundLine"
    ADD CONSTRAINT "OrderRefundLine_refundEventId_fkey"
    FOREIGN KEY ("refundEventId") REFERENCES "OrderRefundEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OrderAdjustmentEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderRecordId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "replacementPolicy" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "reason" TEXT,
    "laborAdj" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "materialAdj" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "packagingAdj" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "equipmentAdj" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "netContribAdj" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderAdjustmentEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Adjustment" ADD COLUMN "adjustmentEventId" TEXT;

INSERT INTO "OrderAdjustmentEvent" (
    "id", "shopId", "orderRecordId", "shopifyLineItemId", "sourceType", "sourceKey",
    "replacementPolicy", "actor", "reason", "laborAdj", "materialAdj", "packagingAdj",
    "equipmentAdj", "netContribAdj", "createdAt"
)
SELECT
    CONCAT('ae_', MD5(adjustment."id")),
    adjustment."shopId",
    snapshot."orderRecordId",
    line."shopifyLineItemId",
    adjustment."type",
    CONCAT('legacy:', adjustment."id"),
    CASE
        WHEN adjustment."type" IN ('refund', 'cancellation') THEN 'regenerate'
        WHEN adjustment."type" = 'manual' THEN 'reapply'
        WHEN adjustment."type" = 'packaging_reconciliation' THEN 'recompute'
        WHEN adjustment."reason" = 'orders/updated webhook' THEN 'order_update_delta'
        ELSE 'review_required'
    END,
    adjustment."actor",
    adjustment."reason",
    adjustment."laborAdj",
    adjustment."materialAdj",
    adjustment."packagingAdj",
    adjustment."equipmentAdj",
    adjustment."netContribAdj",
    adjustment."createdAt"
FROM "Adjustment" AS adjustment
JOIN "OrderSnapshotLine" AS line ON line."id" = adjustment."snapshotLineId"
JOIN "OrderSnapshot" AS snapshot ON snapshot."id" = line."snapshotId";

UPDATE "Adjustment" AS adjustment
SET "adjustmentEventId" = event."id"
FROM "OrderAdjustmentEvent" AS event
WHERE event."sourceKey" = CONCAT('legacy:', adjustment."id")
  AND event."shopId" = adjustment."shopId";

CREATE UNIQUE INDEX "OrderAdjustmentEvent_shopId_sourceKey_key" ON "OrderAdjustmentEvent"("shopId", "sourceKey");
CREATE INDEX "OrderAdjustmentEvent_shopId_orderRecordId_idx" ON "OrderAdjustmentEvent"("shopId", "orderRecordId");
CREATE INDEX "Adjustment_adjustmentEventId_idx" ON "Adjustment"("adjustmentEventId");
CREATE UNIQUE INDEX "Adjustment_shopId_snapshotLineId_adjustmentEventId_key" ON "Adjustment"("shopId", "snapshotLineId", "adjustmentEventId");

ALTER TABLE "OrderAdjustmentEvent"
    ADD CONSTRAINT "OrderAdjustmentEvent_orderRecordId_fkey"
    FOREIGN KEY ("orderRecordId") REFERENCES "OrderRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Adjustment"
    ADD CONSTRAINT "Adjustment_adjustmentEventId_fkey"
    FOREIGN KEY ("adjustmentEventId") REFERENCES "OrderAdjustmentEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
