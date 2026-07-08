-- Store app-owned icon assets for artist and cause directory cards.
ALTER TABLE "Cause" ADD COLUMN "iconStorageKey" TEXT;
ALTER TABLE "Artist" ADD COLUMN "iconStorageKey" TEXT;
