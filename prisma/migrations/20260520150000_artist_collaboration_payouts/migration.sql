-- Artist collaboration product attribution and payouts (ADR-013)

ALTER TABLE "LineCauseAllocation"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'product',
ADD COLUMN "artistId" TEXT,
ADD COLUMN "artistName" TEXT;

CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "creditName" TEXT NOT NULL,
    "creditPreference" TEXT NOT NULL DEFAULT 'artist_name',
    "publicBio" TEXT,
    "websiteUrl" TEXT,
    "instagramUrl" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paymentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultPayoutRate" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "taxStatus" TEXT NOT NULL DEFAULT 'not_required',
    "paymentNotes" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "restrictedChannels" TEXT,
    "restrictedFormats" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArtistCauseAssignment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "causeId" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtistCauseAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductArtistAssignment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "attributionOrder" INTEGER NOT NULL DEFAULT 0,
    "creditOverride" TEXT,
    "collaborationShare" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "payoutEnabledOverride" BOOLEAN,
    "payoutRateOverride" DECIMAL(5,2),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductArtistAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineArtistAllocation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "snapshotLineId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "creditName" TEXT NOT NULL,
    "creditPreference" TEXT NOT NULL,
    "collaborationShare" DECIMAL(5,2) NOT NULL,
    "payoutEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutRate" DECIMAL(5,2) NOT NULL,
    "payoutBasis" DECIMAL(10,4) NOT NULL,
    "payoutAmount" DECIMAL(10,4) NOT NULL,
    "donationRoutableAmount" DECIMAL(10,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineArtistAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArtistAllocation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "creditName" TEXT NOT NULL,
    "allocated" DECIMAL(10,4) NOT NULL,
    "paid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArtistPayment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "referenceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArtistPaymentApplication" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "artistPaymentId" TEXT NOT NULL,
    "artistAllocationId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistPaymentApplication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LineCauseAllocation_shopId_artistId_idx" ON "LineCauseAllocation"("shopId", "artistId");
CREATE INDEX "Artist_shopId_status_idx" ON "Artist"("shopId", "status");
CREATE INDEX "ArtistCauseAssignment_shopId_idx" ON "ArtistCauseAssignment"("shopId");
CREATE INDEX "ArtistCauseAssignment_shopId_artistId_idx" ON "ArtistCauseAssignment"("shopId", "artistId");
CREATE UNIQUE INDEX "ArtistCauseAssignment_shopId_artistId_causeId_key" ON "ArtistCauseAssignment"("shopId", "artistId", "causeId");
CREATE INDEX "ProductArtistAssignment_shopId_idx" ON "ProductArtistAssignment"("shopId");
CREATE INDEX "ProductArtistAssignment_shopId_productId_idx" ON "ProductArtistAssignment"("shopId", "productId");
CREATE INDEX "ProductArtistAssignment_shopId_artistId_idx" ON "ProductArtistAssignment"("shopId", "artistId");
CREATE UNIQUE INDEX "ProductArtistAssignment_shopId_productId_artistId_key" ON "ProductArtistAssignment"("shopId", "productId", "artistId");
CREATE UNIQUE INDEX "ProductArtistAssignment_shopId_shopifyProductId_artistId_key" ON "ProductArtistAssignment"("shopId", "shopifyProductId", "artistId");
CREATE INDEX "LineArtistAllocation_shopId_idx" ON "LineArtistAllocation"("shopId");
CREATE INDEX "LineArtistAllocation_shopId_artistId_idx" ON "LineArtistAllocation"("shopId", "artistId");
CREATE INDEX "LineArtistAllocation_snapshotLineId_idx" ON "LineArtistAllocation"("snapshotLineId");
CREATE INDEX "ArtistAllocation_shopId_idx" ON "ArtistAllocation"("shopId");
CREATE INDEX "ArtistAllocation_shopId_artistId_idx" ON "ArtistAllocation"("shopId", "artistId");
CREATE UNIQUE INDEX "ArtistAllocation_periodId_artistId_key" ON "ArtistAllocation"("periodId", "artistId");
CREATE INDEX "ArtistPayment_shopId_idx" ON "ArtistPayment"("shopId");
CREATE INDEX "ArtistPayment_periodId_artistId_idx" ON "ArtistPayment"("periodId", "artistId");
CREATE INDEX "ArtistPayment_shopId_artistId_idx" ON "ArtistPayment"("shopId", "artistId");
CREATE INDEX "ArtistPaymentApplication_shopId_idx" ON "ArtistPaymentApplication"("shopId");
CREATE INDEX "ArtistPaymentApplication_artistAllocationId_idx" ON "ArtistPaymentApplication"("artistAllocationId");
CREATE UNIQUE INDEX "ArtistPaymentApplication_artistPaymentId_artistAllocationId_key" ON "ArtistPaymentApplication"("artistPaymentId", "artistAllocationId");

ALTER TABLE "ArtistCauseAssignment" ADD CONSTRAINT "ArtistCauseAssignment_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistCauseAssignment" ADD CONSTRAINT "ArtistCauseAssignment_causeId_fkey" FOREIGN KEY ("causeId") REFERENCES "Cause"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductArtistAssignment" ADD CONSTRAINT "ProductArtistAssignment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductArtistAssignment" ADD CONSTRAINT "ProductArtistAssignment_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LineArtistAllocation" ADD CONSTRAINT "LineArtistAllocation_snapshotLineId_fkey" FOREIGN KEY ("snapshotLineId") REFERENCES "OrderSnapshotLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LineArtistAllocation" ADD CONSTRAINT "LineArtistAllocation_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArtistAllocation" ADD CONSTRAINT "ArtistAllocation_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistAllocation" ADD CONSTRAINT "ArtistAllocation_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArtistPayment" ADD CONSTRAINT "ArtistPayment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistPayment" ADD CONSTRAINT "ArtistPayment_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArtistPaymentApplication" ADD CONSTRAINT "ArtistPaymentApplication_artistPaymentId_fkey" FOREIGN KEY ("artistPaymentId") REFERENCES "ArtistPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistPaymentApplication" ADD CONSTRAINT "ArtistPaymentApplication_artistAllocationId_fkey" FOREIGN KEY ("artistAllocationId") REFERENCES "ArtistAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
