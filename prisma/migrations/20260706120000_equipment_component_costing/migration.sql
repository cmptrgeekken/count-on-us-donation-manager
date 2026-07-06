-- Equipment component costing (ADR-022)

ALTER TABLE "Shop"
  ADD COLUMN "defaultElectricityCostPerKwh" DECIMAL(10,6);

ALTER TABLE "EquipmentLibraryItem"
  ADD COLUMN "hourlyRateMode" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "perUseCostMode" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "acquisitionCost" DECIMAL(10,2),
  ADD COLUMN "expectedLifespanHours" DECIMAL(10,4),
  ADD COLUMN "salvageValue" DECIMAL(10,2),
  ADD COLUMN "wattsPerOperatingHour" DECIMAL(10,4),
  ADD COLUMN "electricityCostPerKwhOverride" DECIMAL(10,6);

UPDATE "EquipmentLibraryItem"
SET "acquisitionCost" = "equipmentCost"
WHERE "acquisitionCost" IS NULL
  AND "equipmentCost" IS NOT NULL;

CREATE TABLE "EquipmentConsumable" (
  "id" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "replacementCost" DECIMAL(10,2) NOT NULL,
  "lifespanQuantity" DECIMAL(10,4) NOT NULL,
  "lifespanUnit" TEXT NOT NULL,
  "sku" TEXT,
  "purchaseLink" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EquipmentConsumable_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EquipmentConsumable_shopId_equipmentId_idx" ON "EquipmentConsumable"("shopId", "equipmentId");
CREATE INDEX "EquipmentConsumable_shopId_status_idx" ON "EquipmentConsumable"("shopId", "status");

ALTER TABLE "EquipmentConsumable"
  ADD CONSTRAINT "EquipmentConsumable_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES "EquipmentLibraryItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderSnapshotEquipmentLine"
  ALTER COLUMN "hourlyRate" TYPE DECIMAL(10,4),
  ALTER COLUMN "perUseCost" TYPE DECIMAL(10,4),
  ADD COLUMN "hourlyRateMode" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "perUseCostMode" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "electricityCost" DECIMAL(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "depreciationCost" DECIMAL(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "consumablesCost" DECIMAL(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "maintenanceCost" DECIMAL(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN "manualOverrideCost" DECIMAL(10,4) NOT NULL DEFAULT 0;

CREATE TABLE "OrderSnapshotEquipmentConsumableLine" (
  "id" TEXT NOT NULL,
  "snapshotEquipmentLineId" TEXT NOT NULL,
  "consumableId" TEXT,
  "consumableName" TEXT NOT NULL,
  "lifespanUnit" TEXT NOT NULL,
  "lineCost" DECIMAL(10,4) NOT NULL,

  CONSTRAINT "OrderSnapshotEquipmentConsumableLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "OrderSnapshotEquipmentConsumableLine"
  ADD CONSTRAINT "OrderSnapshotEquipmentConsumableLine_snapshotEquipmentLineId_fkey"
  FOREIGN KEY ("snapshotEquipmentLineId") REFERENCES "OrderSnapshotEquipmentLine"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderSnapshotEquipmentConsumableLine"
  ADD CONSTRAINT "OrderSnapshotEquipmentConsumableLine_consumableId_fkey"
  FOREIGN KEY ("consumableId") REFERENCES "EquipmentConsumable"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
