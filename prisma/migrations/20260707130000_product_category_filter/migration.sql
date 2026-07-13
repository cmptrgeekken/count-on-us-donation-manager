ALTER TABLE "Product"
ADD COLUMN "productCategoryId" TEXT,
ADD COLUMN "productCategoryName" TEXT,
ADD COLUMN "productCategoryPath" TEXT;

CREATE INDEX "Product_shopId_productCategoryPath_idx" ON "Product"("shopId", "productCategoryPath");
