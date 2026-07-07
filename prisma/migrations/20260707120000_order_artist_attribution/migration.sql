-- Add minimized customer identity to order snapshots for artist self-purchase exclusion.
ALTER TABLE "OrderSnapshot"
  ADD COLUMN "shopifyCustomerId" TEXT,
  ADD COLUMN "normalizedCustomerEmailHash" TEXT;

-- Durable one-artist association for a Shopify customer identity.
CREATE TABLE "CustomerArtistAssociation" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "shopifyCustomerId" TEXT,
  "normalizedCustomerEmailHash" TEXT,
  "artistId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CustomerArtistAssociation_pkey" PRIMARY KEY ("id")
);

-- Manual or inferred attribution of an imported order to a single artist/customer.
CREATE TABLE "OrderArtistAttribution" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "artistId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrderArtistAttribution_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LineArtistAllocation"
  ADD COLUMN "payoutExclusionReason" TEXT;

CREATE INDEX "OrderSnapshot_shopId_shopifyCustomerId_idx"
  ON "OrderSnapshot"("shopId", "shopifyCustomerId");

CREATE INDEX "OrderSnapshot_shopId_normalizedCustomerEmailHash_idx"
  ON "OrderSnapshot"("shopId", "normalizedCustomerEmailHash");

CREATE INDEX "CustomerArtistAssociation_shopId_artistId_idx"
  ON "CustomerArtistAssociation"("shopId", "artistId");

CREATE INDEX "CustomerArtistAssociation_shopId_shopifyCustomerId_idx"
  ON "CustomerArtistAssociation"("shopId", "shopifyCustomerId");

CREATE INDEX "CustomerArtistAssociation_shopId_normalizedCustomerEmailHash_idx"
  ON "CustomerArtistAssociation"("shopId", "normalizedCustomerEmailHash");

CREATE UNIQUE INDEX "CustomerArtistAssociation_shopId_shopifyCustomerId_key"
  ON "CustomerArtistAssociation"("shopId", "shopifyCustomerId")
  WHERE "shopifyCustomerId" IS NOT NULL;

CREATE UNIQUE INDEX "CustomerArtistAssociation_shopId_normalizedCustomerEmailHash_key"
  ON "CustomerArtistAssociation"("shopId", "normalizedCustomerEmailHash")
  WHERE "normalizedCustomerEmailHash" IS NOT NULL;

CREATE UNIQUE INDEX "OrderArtistAttribution_snapshotId_key"
  ON "OrderArtistAttribution"("snapshotId");

CREATE INDEX "OrderArtistAttribution_shopId_artistId_idx"
  ON "OrderArtistAttribution"("shopId", "artistId");

CREATE INDEX "OrderArtistAttribution_shopId_source_idx"
  ON "OrderArtistAttribution"("shopId", "source");

ALTER TABLE "CustomerArtistAssociation"
  ADD CONSTRAINT "CustomerArtistAssociation_artistId_fkey"
  FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderArtistAttribution"
  ADD CONSTRAINT "OrderArtistAttribution_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "OrderSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderArtistAttribution"
  ADD CONSTRAINT "OrderArtistAttribution_artistId_fkey"
  FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
