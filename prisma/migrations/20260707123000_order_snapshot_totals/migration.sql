ALTER TABLE "OrderSnapshot"
  ADD COLUMN "customerDisplayName" TEXT,
  ADD COLUMN "subtotalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "shippingAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "OrderSnapshotLine"
  ADD COLUMN "shopifyProductId" TEXT;
