-- Historical import decisions can map a line to a product or classify it as a tip/custom line.
ALTER TABLE "HistoricalLineItemMapping"
  ADD COLUMN "lineKind" TEXT NOT NULL DEFAULT 'product',
  ALTER COLUMN "variantId" DROP NOT NULL;

ALTER TABLE "HistoricalLineItemMapping"
  DROP CONSTRAINT "HistoricalLineItemMapping_variantId_fkey";

ALTER TABLE "HistoricalLineItemMapping"
  ADD CONSTRAINT "HistoricalLineItemMapping_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Snapshot lines retain their financial source even when Shopify has no catalog variant.
ALTER TABLE "OrderSnapshotLine"
  ADD COLUMN "lineKind" TEXT NOT NULL DEFAULT 'product';
