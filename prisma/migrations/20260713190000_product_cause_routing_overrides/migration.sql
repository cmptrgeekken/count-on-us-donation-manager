ALTER TABLE "Product"
ADD COLUMN "donationRoutingMode" TEXT NOT NULL DEFAULT 'automatic';

ALTER TABLE "Product"
ADD CONSTRAINT "Product_donationRoutingMode_check"
CHECK ("donationRoutingMode" IN ('automatic', 'product_override'));
