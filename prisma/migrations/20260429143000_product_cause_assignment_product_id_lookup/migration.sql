UPDATE "ProductCauseAssignment" AS pca
SET "productId" = p."id"
FROM "Product" AS p
WHERE pca."productId" IS NULL
  AND pca."shopId" = p."shopId"
  AND pca."shopifyProductId" = p."shopifyId";

CREATE UNIQUE INDEX "ProductCauseAssignment_shopId_productId_causeId_key"
ON "ProductCauseAssignment"("shopId", "productId", "causeId");

CREATE INDEX "ProductCauseAssignment_shopId_productId_idx"
ON "ProductCauseAssignment"("shopId", "productId");
