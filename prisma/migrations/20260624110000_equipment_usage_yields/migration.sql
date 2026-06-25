-- AlterTable
ALTER TABLE "CostTemplateEquipmentLine" ADD COLUMN "usageMode" TEXT NOT NULL DEFAULT 'direct',
ADD COLUMN "yieldDurationMinutes" DECIMAL(10,4),
ADD COLUMN "yieldUses" DECIMAL(10,4),
ADD COLUMN "yieldQuantity" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "VariantEquipmentLine" ADD COLUMN "usageMode" TEXT NOT NULL DEFAULT 'direct',
ADD COLUMN "yieldDurationMinutes" DECIMAL(10,4),
ADD COLUMN "yieldUses" DECIMAL(10,4),
ADD COLUMN "yieldQuantity" DECIMAL(10,4);

-- AlterTable
ALTER TABLE "OrderSnapshotEquipmentLine" ADD COLUMN "usageMode" TEXT NOT NULL DEFAULT 'direct',
ADD COLUMN "yieldDurationMinutes" DECIMAL(10,2),
ADD COLUMN "yieldUses" DECIMAL(10,2),
ADD COLUMN "yieldQuantity" DECIMAL(10,2);
