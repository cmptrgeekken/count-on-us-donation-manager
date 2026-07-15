-- Canonicalize legacy numeric Shopify order IDs and merge logical orders that were
-- split between a numeric ID (historical JSON import) and a Shopify Order GID
-- (reconciliation/webhooks). Snapshot revisions remain immutable.

CREATE TEMP TABLE "DuplicateOrderRecordMerge" AS
SELECT
  numeric_record."id" AS "duplicateId",
  gid_record."id" AS "survivorId"
FROM "OrderRecord" AS numeric_record
JOIN "OrderRecord" AS gid_record
  ON gid_record."shopId" = numeric_record."shopId"
 AND gid_record."shopifyOrderId" = CONCAT('gid://shopify/Order/', numeric_record."shopifyOrderId")
WHERE numeric_record."shopifyOrderId" ~ '^[0-9]+$';

-- Break the current-snapshot links while snapshots and lifecycle evidence move.
UPDATE "OrderRecord"
SET "currentSnapshotId" = NULL
WHERE "id" IN (
  SELECT "duplicateId" FROM "DuplicateOrderRecordMerge"
  UNION
  SELECT "survivorId" FROM "DuplicateOrderRecordMerge"
);

-- Preserve the most useful lifecycle evidence on the surviving logical order.
UPDATE "OrderLifecycle" AS survivor
SET
  "state" = duplicate."state",
  "financialStatus" = duplicate."financialStatus",
  "fulfillmentStatus" = duplicate."fulfillmentStatus",
  "cancelledAt" = duplicate."cancelledAt",
  "source" = duplicate."source",
  "sourceUpdatedAt" = duplicate."sourceUpdatedAt",
  "reviewReason" = duplicate."reviewReason",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "DuplicateOrderRecordMerge" AS merge
JOIN "OrderLifecycle" AS duplicate ON duplicate."orderRecordId" = merge."duplicateId"
WHERE survivor."orderRecordId" = merge."survivorId"
  AND survivor."state" IN ('unknown', 'review_required')
  AND duplicate."state" NOT IN ('unknown', 'review_required');

UPDATE "OrderRefundEvent" AS event
SET "orderRecordId" = merge."survivorId"
FROM "DuplicateOrderRecordMerge" AS merge
WHERE event."orderRecordId" = merge."duplicateId";

UPDATE "OrderAdjustmentEvent" AS event
SET "orderRecordId" = merge."survivorId"
FROM "DuplicateOrderRecordMerge" AS merge
WHERE event."orderRecordId" = merge."duplicateId";

-- Temporary negative revisions avoid collisions with the survivor's revisions.
WITH ranked AS (
  SELECT snapshot."id", ROW_NUMBER() OVER (
    PARTITION BY merge."survivorId"
    ORDER BY snapshot."recordedAt", snapshot."createdAt", snapshot."id"
  ) AS position
  FROM "OrderSnapshot" AS snapshot
  JOIN "DuplicateOrderRecordMerge" AS merge ON merge."duplicateId" = snapshot."orderRecordId"
)
UPDATE "OrderSnapshot" AS snapshot
SET "revision" = -ranked.position
FROM ranked
WHERE snapshot."id" = ranked."id";

UPDATE "OrderSnapshot" AS snapshot
SET
  "orderRecordId" = merge."survivorId",
  "shopifyOrderId" = CONCAT('gid://shopify/Order/', duplicate_record."shopifyOrderId")
FROM "DuplicateOrderRecordMerge" AS merge
JOIN "OrderRecord" AS duplicate_record ON duplicate_record."id" = merge."duplicateId"
WHERE snapshot."orderRecordId" = merge."duplicateId";

WITH ranked AS (
  SELECT snapshot."id", ROW_NUMBER() OVER (
    PARTITION BY snapshot."orderRecordId"
    ORDER BY snapshot."recordedAt", snapshot."createdAt", snapshot."id"
  ) AS revision
  FROM "OrderSnapshot" AS snapshot
  WHERE snapshot."orderRecordId" IN (SELECT "survivorId" FROM "DuplicateOrderRecordMerge")
)
UPDATE "OrderSnapshot" AS snapshot
SET "revision" = ranked.revision
FROM ranked
WHERE snapshot."id" = ranked."id";

-- Historical imports carry the richer merchant-supplied order data and supersede
-- reconciliation snapshots; otherwise select the newest immutable revision.
WITH preferred AS (
  SELECT DISTINCT ON (snapshot."orderRecordId")
    snapshot."orderRecordId", snapshot."id"
  FROM "OrderSnapshot" AS snapshot
  WHERE snapshot."orderRecordId" IN (SELECT "survivorId" FROM "DuplicateOrderRecordMerge")
  ORDER BY
    snapshot."orderRecordId",
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
FROM preferred
WHERE record."id" = preferred."orderRecordId";

UPDATE "ReportingPeriod" AS period
SET "rebuildRequired" = true, "rebuildRequestedAt" = CURRENT_TIMESTAMP
WHERE period."id" IN (
  SELECT DISTINCT snapshot."periodId"
  FROM "OrderSnapshot" AS snapshot
  WHERE snapshot."orderRecordId" IN (SELECT "survivorId" FROM "DuplicateOrderRecordMerge")
    AND snapshot."periodId" IS NOT NULL
);

INSERT INTO "AuditLog" ("id", "shopId", "entity", "entityId", "action", "actor", "payload", "createdAt")
SELECT
  CONCAT('audit_', MD5(merge."survivorId" || ':duplicate-order-repair')),
  survivor."shopId",
  'OrderRecord',
  merge."survivorId",
  'DUPLICATE_ORDER_IDENTITY_REPAIRED',
  'system',
  JSONB_BUILD_OBJECT('duplicateOrderRecordId', merge."duplicateId"),
  CURRENT_TIMESTAMP
FROM "DuplicateOrderRecordMerge" AS merge
JOIN "OrderRecord" AS survivor ON survivor."id" = merge."survivorId";

DELETE FROM "OrderLifecycle"
WHERE "orderRecordId" IN (SELECT "duplicateId" FROM "DuplicateOrderRecordMerge");

DELETE FROM "OrderRecord"
WHERE "id" IN (SELECT "duplicateId" FROM "DuplicateOrderRecordMerge");

-- Canonicalize numeric-only records that did not have a second GID identity.
UPDATE "OrderSnapshot"
SET "shopifyOrderId" = CONCAT('gid://shopify/Order/', "shopifyOrderId")
WHERE "shopifyOrderId" ~ '^[0-9]+$';

UPDATE "OrderRecord"
SET "shopifyOrderId" = CONCAT('gid://shopify/Order/', "shopifyOrderId"), "updatedAt" = CURRENT_TIMESTAMP
WHERE "shopifyOrderId" ~ '^[0-9]+$';

DROP TABLE "DuplicateOrderRecordMerge";
