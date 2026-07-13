-- Store the Shopify File/MediaImage created from Count On Us public icon uploads.
ALTER TABLE "Cause" ADD COLUMN "shopifyIconMediaImageId" TEXT;
ALTER TABLE "Cause" ADD COLUMN "shopifyIconStorageKey" TEXT;

ALTER TABLE "Artist" ADD COLUMN "shopifyIconMediaImageId" TEXT;
ALTER TABLE "Artist" ADD COLUMN "shopifyIconStorageKey" TEXT;
