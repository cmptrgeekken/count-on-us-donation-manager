import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs() {
  const result = {
    shopId: null,
    out: null,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--shop=")) result.shopId = arg.slice("--shop=".length).trim();
    if (arg.startsWith("--out=")) result.out = arg.slice("--out=".length).trim();
  }

  if (!result.shopId) {
    throw new Error("Pass --shop=your-store.myshopify.com");
  }

  result.out ??= `seed-imports/catalog-${result.shopId.replace(/[^a-z0-9.-]+/gi, "-")}.json`;
  return result;
}

function decimalString(value) {
  if (value === null || value === undefined) return null;
  return value.toString();
}

function omitUndefined(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

async function exportCatalog({ shopId, out }) {
  const [
    shop,
    materialLibraryItems,
    equipmentLibraryItems,
    costTemplates,
    costTemplateMaterialLines,
    costTemplateEquipmentLines,
    causes,
    products,
    variants,
    variantCostConfigs,
    variantMaterialLines,
    variantEquipmentLines,
    productCauseAssignments,
  ] = await Promise.all([
    prisma.shop.findUnique({
      where: { shopId },
      select: { shopId: true, shopifyDomain: true, currency: true },
    }),
    prisma.materialLibraryItem.findMany({
      where: { shopId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.equipmentLibraryItem.findMany({
      where: { shopId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.costTemplate.findMany({
      where: { shopId },
      include: {
        defaultShippingTemplate: { select: { id: true } },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }, { id: "asc" }],
    }),
    prisma.costTemplateMaterialLine.findMany({
      where: { template: { shopId } },
      include: {
        template: { select: { id: true } },
        material: { select: { id: true } },
      },
      orderBy: [{ id: "asc" }],
    }),
    prisma.costTemplateEquipmentLine.findMany({
      where: { template: { shopId } },
      include: {
        template: { select: { id: true } },
        equipment: { select: { id: true } },
      },
      orderBy: [{ id: "asc" }],
    }),
    prisma.cause.findMany({
      where: { shopId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.product.findMany({
      where: { shopId },
      orderBy: [{ title: "asc" }, { shopifyId: "asc" }],
    }),
    prisma.variant.findMany({
      where: { shopId },
      include: { product: { select: { shopifyId: true } } },
      orderBy: [{ shopifyId: "asc" }],
    }),
    prisma.variantCostConfig.findMany({
      where: { shopId },
      include: { variant: { select: { shopifyId: true } } },
      orderBy: [{ id: "asc" }],
    }),
    prisma.variantMaterialLine.findMany({
      where: { shopId },
      include: {
        config: { include: { variant: { select: { shopifyId: true } } } },
        material: { select: { id: true } },
      },
      orderBy: [{ id: "asc" }],
    }),
    prisma.variantEquipmentLine.findMany({
      where: { shopId },
      include: {
        config: { include: { variant: { select: { shopifyId: true } } } },
        equipment: { select: { id: true } },
      },
      orderBy: [{ id: "asc" }],
    }),
    prisma.productCauseAssignment.findMany({
      where: { shopId },
      include: {
        product: { select: { shopifyId: true } },
        cause: { select: { id: true } },
      },
      orderBy: [{ shopifyProductId: "asc" }, { causeId: "asc" }],
    }),
  ]);

  if (!shop) {
    throw new Error(`Shop not found: ${shopId}`);
  }

  const payload = {
    meta: {
      exportFormat: "count-on-us-catalog-v2",
      exportedAt: new Date().toISOString(),
      shopId: shop.shopId,
      shopifyDomain: shop.shopifyDomain,
      currency: shop.currency,
      notes: [
        "Cost templates and template lines are exported as source-keyed records and recreated by the importer.",
        "Historical order CSV imports still derive snapshots from the imported catalog/configuration.",
      ],
    },
    materialLibraryItems: materialLibraryItems.map((row) => omitUndefined({
      _dedupeKey: row.id,
      shopId: row.shopId,
      name: row.name,
      type: row.type,
      costingModel: row.costingModel,
      purchasePrice: decimalString(row.purchasePrice),
      purchaseQty: decimalString(row.purchaseQty),
      perUnitCost: decimalString(row.perUnitCost),
      totalUsesPerUnit: decimalString(row.totalUsesPerUnit),
      purchaseLink: row.purchaseLink,
      weightGrams: decimalString(row.weightGrams),
      unitDescription: row.unitDescription,
      status: row.status,
      notes: row.notes,
    })),
    equipmentLibraryItems: equipmentLibraryItems.map((row) => omitUndefined({
      _dedupeKey: row.id,
      shopId: row.shopId,
      name: row.name,
      hourlyRate: decimalString(row.hourlyRate),
      perUseCost: decimalString(row.perUseCost),
      purchaseLink: row.purchaseLink,
      equipmentCost: decimalString(row.equipmentCost),
      status: row.status,
      notes: row.notes,
    })),
    costTemplates: costTemplates.map((row) => omitUndefined({
      _dedupeKey: row.id,
      shopId: row.shopId,
      name: row.name,
      type: row.type,
      defaultShippingTemplateDedupeKey: row.defaultShippingTemplate?.id ?? null,
      description: row.description,
      status: row.status,
    })),
    costTemplateMaterialLines: costTemplateMaterialLines.map((row) => omitUndefined({
      _dedupeKey: row.id,
      templateDedupeKey: row.template.id,
      materialDedupeKey: row.material.id,
      yield: decimalString(row.yield),
      quantity: decimalString(row.quantity),
      usesPerVariant: decimalString(row.usesPerVariant),
    })),
    costTemplateEquipmentLines: costTemplateEquipmentLines.map((row) => omitUndefined({
      _dedupeKey: row.id,
      templateDedupeKey: row.template.id,
      equipmentDedupeKey: row.equipment.id,
      minutes: decimalString(row.minutes),
      uses: decimalString(row.uses),
    })),
    causes: causes.map((row) => omitUndefined({
      _dedupeKey: row.id,
      shopId: row.shopId,
      shopifyMetaobjectId: row.shopifyMetaobjectId,
      name: row.name,
      legalName: row.legalName,
      is501c3: row.is501c3,
      description: row.description,
      iconUrl: row.iconUrl,
      donationLink: row.donationLink,
      websiteUrl: row.websiteUrl,
      instagramUrl: row.instagramUrl,
      status: row.status,
    })),
    products: products.map((row) => omitUndefined({
      shopId: row.shopId,
      shopifyId: row.shopifyId,
      title: row.title,
      handle: row.handle,
      status: row.status,
      syncedAt: row.syncedAt.toISOString(),
    })),
    variants: variants.map((row) => omitUndefined({
      shopId: row.shopId,
      shopifyId: row.shopifyId,
      productShopifyId: row.product.shopifyId,
      title: row.title,
      sku: row.sku,
      price: decimalString(row.price),
      syncedAt: row.syncedAt.toISOString(),
    })),
    variantCostConfigs: variantCostConfigs.map((row) => omitUndefined({
      variantShopifyId: row.variant.shopifyId,
      productionTemplateDedupeKey: row.productionTemplateId,
      shippingTemplateDedupeKey: row.shippingTemplateId,
      laborMinutes: decimalString(row.laborMinutes),
      lineItemCount: row.lineItemCount,
    })),
    variantMaterialLines: variantMaterialLines.map((row) => omitUndefined({
      _dedupeKey: row.id,
      variantShopifyId: row.config.variant.shopifyId,
      materialDedupeKey: row.material.id,
      templateLineDedupeKey: row.templateLineId,
      yield: decimalString(row.yield),
      quantity: decimalString(row.quantity),
      usesPerVariant: decimalString(row.usesPerVariant),
    })),
    variantEquipmentLines: variantEquipmentLines.map((row) => omitUndefined({
      _dedupeKey: row.id,
      variantShopifyId: row.config.variant.shopifyId,
      equipmentDedupeKey: row.equipment.id,
      templateLineDedupeKey: row.templateLineId,
      minutes: decimalString(row.minutes),
      uses: decimalString(row.uses),
    })),
    productCauseAssignments: productCauseAssignments.map((row) => omitUndefined({
      _dedupeKey: row.id,
      shopId: row.shopId,
      productShopifyId: row.product?.shopifyId ?? row.shopifyProductId,
      shopifyProductId: row.shopifyProductId,
      causeDedupeKey: row.cause.id,
      percentage: decimalString(row.percentage),
    })),
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const templateConfigCount = variantCostConfigs.filter((row) => row.productionTemplateId || row.shippingTemplateId).length;
  const templateMaterialLineCount = variantMaterialLines.filter((row) => row.templateLineId).length;
  const templateEquipmentLineCount = variantEquipmentLines.filter((row) => row.templateLineId).length;

  console.log(`Wrote catalog export to ${out}`);
  console.log(`Materials: ${materialLibraryItems.length}`);
  console.log(`Equipment: ${equipmentLibraryItems.length}`);
  console.log(`Cost templates: ${costTemplates.length}`);
  console.log(`Cost template material lines: ${costTemplateMaterialLines.length}`);
  console.log(`Cost template equipment lines: ${costTemplateEquipmentLines.length}`);
  console.log(`Causes: ${causes.length}`);
  console.log(`Products: ${products.length}`);
  console.log(`Variants: ${variants.length}`);
  console.log(`Variant cost configs: ${variantCostConfigs.length}`);
  console.log(`Variant material lines: ${variantMaterialLines.length}`);
  console.log(`Variant equipment lines: ${variantEquipmentLines.length}`);
  console.log(`Product-cause assignments: ${productCauseAssignments.length}`);
  console.log(
    `Template references exported: ${templateConfigCount} variant config(s), ${templateMaterialLineCount} material line(s), and ${templateEquipmentLineCount} equipment line(s).`,
  );
}

const options = parseArgs();
exportCatalog(options)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
