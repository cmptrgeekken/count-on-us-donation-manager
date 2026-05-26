CREATE TABLE "ArtistSubmission" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "submitterName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "artistName" TEXT,
  "publicLinks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "localConnection" TEXT,
  "artworkIdea" TEXT NOT NULL,
  "interestedFormats" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "formatRestrictions" TEXT,
  "salesChannelRestrictions" TEXT,
  "causeInterests" TEXT,
  "artistSharePreference" TEXT,
  "proofApprovalPreference" TEXT,
  "artworkSampleLinks" TEXT,
  "notes" TEXT,
  "termsAcknowledgedAt" TIMESTAMP(3) NOT NULL,
  "termsVersion" TEXT,
  "termsText" TEXT,
  "paymentAcknowledgedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'new',
  "source" TEXT NOT NULL DEFAULT 'storefront_widget',
  "submitterIpHash" TEXT,
  "userAgent" TEXT,
  "internalNotes" TEXT,
  "convertedArtistId" TEXT,
  "convertedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ArtistSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArtistSubmissionFile" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "scanStatus" TEXT NOT NULL DEFAULT 'pending',
  "scanResult" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "ArtistSubmissionFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ArtistSubmission_shopId_status_createdAt_idx" ON "ArtistSubmission"("shopId", "status", "createdAt");
CREATE INDEX "ArtistSubmission_shopId_email_idx" ON "ArtistSubmission"("shopId", "email");
CREATE INDEX "ArtistSubmission_shopId_convertedArtistId_idx" ON "ArtistSubmission"("shopId", "convertedArtistId");

CREATE UNIQUE INDEX "ArtistSubmissionFile_shopId_storageKey_key" ON "ArtistSubmissionFile"("shopId", "storageKey");
CREATE INDEX "ArtistSubmissionFile_shopId_submissionId_idx" ON "ArtistSubmissionFile"("shopId", "submissionId");
CREATE INDEX "ArtistSubmissionFile_shopId_scanStatus_idx" ON "ArtistSubmissionFile"("shopId", "scanStatus");

ALTER TABLE "ArtistSubmission"
  ADD CONSTRAINT "ArtistSubmission_convertedArtistId_fkey"
  FOREIGN KEY ("convertedArtistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ArtistSubmissionFile"
  ADD CONSTRAINT "ArtistSubmissionFile_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "ArtistSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
