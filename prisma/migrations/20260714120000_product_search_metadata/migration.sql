CREATE TABLE "ProductTag" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ProductTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShopifyCollection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyCollection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductCollection" (
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,

    CONSTRAINT "ProductCollection_pkey" PRIMARY KEY ("productId", "collectionId")
);

CREATE UNIQUE INDEX "ProductTag_productId_value_key" ON "ProductTag"("productId", "value");
CREATE INDEX "ProductTag_shopId_value_idx" ON "ProductTag"("shopId", "value");
CREATE INDEX "ProductTag_shopId_productId_idx" ON "ProductTag"("shopId", "productId");
CREATE UNIQUE INDEX "ShopifyCollection_shopId_shopifyId_key" ON "ShopifyCollection"("shopId", "shopifyId");
CREATE INDEX "ShopifyCollection_shopId_title_idx" ON "ShopifyCollection"("shopId", "title");
CREATE INDEX "ShopifyCollection_shopId_handle_idx" ON "ShopifyCollection"("shopId", "handle");
CREATE INDEX "ProductCollection_shopId_productId_idx" ON "ProductCollection"("shopId", "productId");
CREATE INDEX "ProductCollection_shopId_collectionId_idx" ON "ProductCollection"("shopId", "collectionId");

ALTER TABLE "ProductTag" ADD CONSTRAINT "ProductTag_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "ShopifyCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
