-- Repair historical CSV imports keyed by order name (for example #1278) that
-- coexist with reconciliation records keyed by Shopify's numeric Order GID.

CREATE TEMP TABLE "OrderNameDuplicateMerge" AS
SELECT noncanonical."id" AS "duplicateId", canonical."id" AS "survivorId"
FROM "OrderRecord" AS noncanonical
JOIN "OrderSnapshot" AS noncanonical_snapshot
  ON noncanonical_snapshot."id" = noncanonical."currentSnapshotId"
JOIN "OrderSnapshot" AS canonical_snapshot
  ON canonical_snapshot."shopId" = noncanonical_snapshot."shopId"
 AND canonical_snapshot."orderNumber" = noncanonical_snapshot."orderNumber"
 AND canonical_snapshot."orderNumber" IS NOT NULL
JOIN "OrderRecord" AS canonical
  ON canonical."id" = canonical_snapshot."orderRecordId"
WHERE noncanonical."shopifyOrderId" !~ '^gid://shopify/Order/[0-9]+$'
  AND canonical."shopifyOrderId" ~ '^gid://shopify/Order/[0-9]+$'
  AND canonical."currentSnapshotId" = canonical_snapshot."id"
  AND canonical."id" <> noncanonical."id";

UPDATE "OrderRecord" SET "currentSnapshotId" = NULL
WHERE "id" IN (
  SELECT "duplicateId" FROM "OrderNameDuplicateMerge"
  UNION SELECT "survivorId" FROM "OrderNameDuplicateMerge"
);

UPDATE "OrderLifecycle" AS survivor
SET "state" = duplicate."state",
    "financialStatus" = duplicate."financialStatus",
    "fulfillmentStatus" = duplicate."fulfillmentStatus",
    "cancelledAt" = duplicate."cancelledAt",
    "source" = duplicate."source",
    "sourceUpdatedAt" = duplicate."sourceUpdatedAt",
    "reviewReason" = duplicate."reviewReason",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "OrderNameDuplicateMerge" AS merge
JOIN "OrderLifecycle" AS duplicate ON duplicate."orderRecordId" = merge."duplicateId"
WHERE survivor."orderRecordId" = merge."survivorId"
  AND survivor."state" IN ('unknown', 'review_required')
  AND duplicate."state" NOT IN ('unknown', 'review_required');

UPDATE "OrderRefundEvent" AS event SET "orderRecordId" = merge."survivorId"
FROM "OrderNameDuplicateMerge" AS merge
WHERE event."orderRecordId" = merge."duplicateId";

UPDATE "OrderAdjustmentEvent" AS event SET "orderRecordId" = merge."survivorId"
FROM "OrderNameDuplicateMerge" AS merge
WHERE event."orderRecordId" = merge."duplicateId";

WITH ranked AS (
  SELECT snapshot."id", -ROW_NUMBER() OVER (
    PARTITION BY merge."survivorId"
    ORDER BY snapshot."recordedAt", snapshot."createdAt", snapshot."id"
  ) AS revision
  FROM "OrderSnapshot" AS snapshot
  JOIN "OrderNameDuplicateMerge" AS merge
    ON snapshot."orderRecordId" IN (merge."duplicateId", merge."survivorId")
)
UPDATE "OrderSnapshot" AS snapshot SET "revision" = ranked.revision
FROM ranked WHERE snapshot."id" = ranked."id";

UPDATE "OrderSnapshot" AS snapshot
SET "orderRecordId" = merge."survivorId",
    "shopifyOrderId" = survivor."shopifyOrderId"
FROM "OrderNameDuplicateMerge" AS merge
JOIN "OrderRecord" AS survivor ON survivor."id" = merge."survivorId"
WHERE snapshot."orderRecordId" = merge."duplicateId";

WITH ranked AS (
  SELECT snapshot."id", ROW_NUMBER() OVER (
    PARTITION BY snapshot."orderRecordId"
    ORDER BY snapshot."recordedAt", snapshot."createdAt", snapshot."id"
  ) AS revision
  FROM "OrderSnapshot" AS snapshot
  WHERE snapshot."orderRecordId" IN (SELECT "survivorId" FROM "OrderNameDuplicateMerge")
)
UPDATE "OrderSnapshot" AS snapshot SET "revision" = ranked.revision
FROM ranked WHERE snapshot."id" = ranked."id";

WITH preferred AS (
  SELECT DISTINCT ON (snapshot."orderRecordId") snapshot."orderRecordId", snapshot."id"
  FROM "OrderSnapshot" AS snapshot
  WHERE snapshot."orderRecordId" IN (SELECT "survivorId" FROM "OrderNameDuplicateMerge")
  ORDER BY snapshot."orderRecordId",
    CASE snapshot."origin"
      WHEN 'historical_import' THEN 3
      WHEN 'webhook' THEN 2
      WHEN 'reconciliation' THEN 1
      ELSE 0
    END DESC,
    snapshot."revision" DESC
)
UPDATE "OrderRecord" AS record
SET "currentSnapshotId" = preferred."id", "updatedAt" = CURRENT_TIMESTAMP
FROM preferred WHERE record."id" = preferred."orderRecordId";

UPDATE "ReportingPeriod" AS period
SET "rebuildRequired" = true, "rebuildRequestedAt" = CURRENT_TIMESTAMP
WHERE period."id" IN (
  SELECT DISTINCT snapshot."periodId" FROM "OrderSnapshot" AS snapshot
  WHERE snapshot."orderRecordId" IN (SELECT "survivorId" FROM "OrderNameDuplicateMerge")
    AND snapshot."periodId" IS NOT NULL
);

INSERT INTO "AuditLog" ("id", "shopId", "entity", "entityId", "action", "actor", "payload", "createdAt")
SELECT CONCAT('audit_', MD5(merge."duplicateId" || ':order-name-duplicate-repair')),
       survivor."shopId", 'OrderRecord', merge."survivorId",
       'DUPLICATE_ORDER_IDENTITY_REPAIRED', 'system',
       JSONB_BUILD_OBJECT('duplicateOrderRecordId', merge."duplicateId", 'matchMethod', 'order_number'),
       CURRENT_TIMESTAMP
FROM "OrderNameDuplicateMerge" AS merge
JOIN "OrderRecord" AS survivor ON survivor."id" = merge."survivorId";

DELETE FROM "OrderLifecycle"
WHERE "orderRecordId" IN (SELECT "duplicateId" FROM "OrderNameDuplicateMerge");

DELETE FROM "OrderRecord"
WHERE "id" IN (SELECT "duplicateId" FROM "OrderNameDuplicateMerge");

DROP TABLE "OrderNameDuplicateMerge";
