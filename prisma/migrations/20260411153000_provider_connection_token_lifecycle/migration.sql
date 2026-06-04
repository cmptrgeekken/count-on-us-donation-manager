-- AlterTable
ALTER TABLE "ProviderConnection"
ADD COLUMN "credentialUpdatedAt" TIMESTAMP(3),
ADD COLUMN "credentialExpiresAt" TIMESTAMP(3);
