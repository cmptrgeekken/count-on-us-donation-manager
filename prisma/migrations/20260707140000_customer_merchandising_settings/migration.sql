ALTER TABLE "Shop"
ADD COLUMN "artistOverlayEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "productDescriptionDonationSummaryEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Artist"
ADD COLUMN "shopifyMetaobjectId" TEXT;
