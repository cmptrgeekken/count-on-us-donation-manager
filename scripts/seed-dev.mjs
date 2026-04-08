import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    shopId: null,
    reset: false,
  };

  for (const arg of args) {
    if (arg === "--reset") result.reset = true;
    if (arg.startsWith("--shop=")) result.shopId = arg.slice("--shop=".length).trim();
  }

  return result;
}

function decimal(value) {
  return new Prisma.Decimal(value);
}

async function resolveShopId(explicitShopId) {
  if (explicitShopId) return explicitShopId;
  if (process.env.SEED_SHOP_ID) return process.env.SEED_SHOP_ID;

  const existing = await prisma.shop.findFirst({ select: { shopId: true } });
  return existing?.shopId ?? null;
}

async function resetShopData(shopId) {
  const deleteByShop = (model) => model.deleteMany({ where: { shopId } });

  await prisma.$transaction([
    deleteByShop(prisma.adjustment),
    deleteByShop(prisma.lineCauseAllocation),
    deleteByShop(prisma.orderSnapshotMaterialLine),
    deleteByShop(prisma.orderSnapshotEquipmentLine),
    deleteByShop(prisma.orderSnapshotPODLine),
    deleteByShop(prisma.orderSnapshotLine),
    deleteByShop(prisma.orderSnapshot),
    deleteByShop(prisma.causeAllocation),
    deleteByShop(prisma.disbursement),
    deleteByShop(prisma.taxTrueUp),
    deleteByShop(prisma.shopifyChargeTransaction),
    deleteByShop(prisma.reportingPeriod),
    deleteByShop(prisma.businessExpense),
    deleteByShop(prisma.productCauseAssignment),
    deleteByShop(prisma.variantMaterialLine),
    deleteByShop(prisma.variantEquipmentLine),
    deleteByShop(prisma.variantCostConfig),
    deleteByShop(prisma.variant),
    deleteByShop(prisma.product),
    deleteByShop(prisma.costTemplateMaterialLine),
    deleteByShop(prisma.costTemplateEquipmentLine),
    deleteByShop(prisma.costTemplate),
    deleteByShop(prisma.materialLibraryItem),
    deleteByShop(prisma.equipmentLibraryItem),
    deleteByShop(prisma.cause),
    deleteByShop(prisma.taxOffsetCache),
  ]);
}

async function seed(shopId) {
  const shopifyDomain = shopId;
  const now = new Date("2026-04-01T12:00:00.000Z");

  await prisma.shop.upsert({
    where: { shopId },
    update: {
      shopifyDomain,
      currency: "USD",
      mistakeBuffer: decimal("0.05"),
      defaultLaborRate: decimal("24.00"),
      catalogSynced: true,
    },
    create: {
      shopId,
      shopifyDomain,
      currency: "USD",
      mistakeBuffer: decimal("0.05"),
      defaultLaborRate: decimal("24.00"),
      catalogSynced: true,
    },
  });

  const [causeA, causeB] = await prisma.$transaction([
    prisma.cause.create({
      data: {
        shopId,
        name: "Community Relief",
        legalName: "Community Relief Fund",
        is501c3: true,
        donationLink: "https://example.org/relief",
        status: "active",
      },
    }),
    prisma.cause.create({
      data: {
        shopId,
        name: "Neighborhood Arts",
        legalName: "Neighborhood Arts Collective",
        is501c3: false,
        donationLink: "https://example.org/arts",
        status: "active",
      },
    }),
  ]);

  const [materialYield, materialUses, materialShip, equipmentPress, equipmentCutter] = await prisma.$transaction([
    prisma.materialLibraryItem.create({
      data: {
        shopId,
        name: "Premium Cotton",
        type: "production",
        costingModel: "yield",
        purchasePrice: decimal("25.00"),
        purchaseQty: decimal("5.00"),
        perUnitCost: decimal("5.000000"),
        status: "active",
        unitDescription: "yards",
      },
    }),
    prisma.materialLibraryItem.create({
      data: {
        shopId,
        name: "Ink Cartridge",
        type: "production",
        costingModel: "uses",
        purchasePrice: decimal("60.00"),
        purchaseQty: decimal("1.00"),
        perUnitCost: decimal("60.000000"),
        totalUsesPerUnit: decimal("120.00"),
        status: "active",
        unitDescription: "cartridge",
      },
    }),
    prisma.materialLibraryItem.create({
      data: {
        shopId,
        name: "Shipping Mailer",
        type: "shipping",
        costingModel: "yield",
        purchasePrice: decimal("12.00"),
        purchaseQty: decimal("20.00"),
        perUnitCost: decimal("0.600000"),
        status: "active",
        unitDescription: "pack",
      },
    }),
    prisma.equipmentLibraryItem.create({
      data: {
        shopId,
        name: "Heat Press",
        hourlyRate: decimal("18.00"),
        perUseCost: decimal("0.40"),
        equipmentCost: decimal("950.00"),
        status: "active",
      },
    }),
    prisma.equipmentLibraryItem.create({
      data: {
        shopId,
        name: "Cutter",
        hourlyRate: decimal("14.00"),
        perUseCost: null,
        equipmentCost: decimal("250.00"),
        status: "active",
      },
    }),
  ]);

  const shippingTemplate = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Standard Shipping",
      type: "shipping",
      status: "active",
      materialLines: {
        create: {
          materialId: materialShip.id,
          quantity: decimal("1.00"),
          yield: decimal("1.00"),
        },
      },
    },
  });

  const productionTemplate = await prisma.costTemplate.create({
    data: {
      shopId,
      name: "Core Production",
      type: "production",
      status: "active",
      defaultShippingTemplateId: shippingTemplate.id,
      materialLines: {
        create: [
          {
            materialId: materialYield.id,
            quantity: decimal("1.00"),
            yield: decimal("1.00"),
          },
          {
            materialId: materialUses.id,
            quantity: decimal("1.00"),
            usesPerVariant: decimal("2.00"),
          },
        ],
      },
      equipmentLines: {
        create: [
          {
            equipmentId: equipmentPress.id,
            minutes: decimal("6.00"),
          },
          {
            equipmentId: equipmentCutter.id,
            minutes: decimal("4.00"),
          },
        ],
      },
    },
  });

  const product = await prisma.product.create({
    data: {
      shopId,
      shopifyId: "gid://shopify/Product/900000100001",
      title: "Donation Tee",
      handle: "donation-tee",
      status: "active",
      syncedAt: now,
    },
  });

  const [variantA, variantB] = await prisma.$transaction([
    prisma.variant.create({
      data: {
        shopId,
        shopifyId: "gid://shopify/ProductVariant/900000100011",
        productId: product.id,
        title: "Donation Tee / Small",
        sku: "TEE-S",
        price: decimal("32.00"),
        syncedAt: now,
      },
    }),
    prisma.variant.create({
      data: {
        shopId,
        shopifyId: "gid://shopify/ProductVariant/900000100012",
        productId: product.id,
        title: "Donation Tee / Large",
        sku: "TEE-L",
        price: decimal("34.00"),
        syncedAt: now,
      },
    }),
  ]);

  await prisma.productCauseAssignment.createMany({
    data: [
      {
        shopId,
        shopifyProductId: product.shopifyId,
        productId: product.id,
        causeId: causeA.id,
        percentage: decimal("70.00"),
      },
      {
        shopId,
        shopifyProductId: product.shopifyId,
        productId: product.id,
        causeId: causeB.id,
        percentage: decimal("30.00"),
      },
    ],
  });

  const config = await prisma.variantCostConfig.create({
    data: {
      shopId,
      variantId: variantA.id,
      productionTemplateId: productionTemplate.id,
      shippingTemplateId: shippingTemplate.id,
      laborMinutes: decimal("8.00"),
      laborRate: decimal("22.00"),
      mistakeBuffer: decimal("0.03"),
      materialLines: {
        create: {
          shopId,
          materialId: materialYield.id,
          quantity: decimal("0.25"),
          yield: decimal("1.00"),
        },
      },
      equipmentLines: {
        create: {
          shopId,
          equipmentId: equipmentPress.id,
          minutes: decimal("2.00"),
        },
      },
    },
  });

  await prisma.variantMaterialLine.create({
    data: {
      shopId,
      configId: config.id,
      materialId: materialShip.id,
      quantity: decimal("1.00"),
      yield: decimal("1.00"),
    },
  });

  const periodStart = new Date("2026-03-01T00:00:00.000Z");
  const periodEnd = new Date("2026-03-15T00:00:00.000Z");

  const reportingPeriod = await prisma.reportingPeriod.create({
    data: {
      shopId,
      status: "OPEN",
      source: "payout",
      startDate: periodStart,
      endDate: periodEnd,
      shopifyPayoutId: "dev_payout_fixture_001",
    },
  });

  const snapshot = await prisma.orderSnapshot.create({
    data: {
      shopId,
      shopifyOrderId: "gid://shopify/Order/900000200001",
      orderNumber: "#2001",
      origin: "webhook",
      createdAt: new Date("2026-03-05T12:00:00.000Z"),
      periodId: reportingPeriod.id,
    },
  });

  const snapshotLine = await prisma.orderSnapshotLine.create({
    data: {
      shopId,
      snapshotId: snapshot.id,
      shopifyLineItemId: "gid://shopify/LineItem/900000200011",
      shopifyVariantId: variantA.shopifyId,
      variantTitle: variantA.title,
      productTitle: product.title,
      quantity: 1,
      salePrice: decimal("32.00"),
      subtotal: decimal("32.00"),
      laborCost: decimal("6.00"),
      materialCost: decimal("9.00"),
      packagingCost: decimal("1.50"),
      equipmentCost: decimal("1.25"),
      mistakeBufferAmount: decimal("0.96"),
      totalCost: decimal("18.71"),
      netContribution: decimal("13.29"),
    },
  });

  await prisma.lineCauseAllocation.create({
    data: {
      shopId,
      snapshotLineId: snapshotLine.id,
      causeId: causeA.id,
      causeName: causeA.name,
      is501c3: causeA.is501c3,
      percentage: decimal("70.00"),
      amount: decimal("9.30"),
    },
  });

  await prisma.lineCauseAllocation.create({
    data: {
      shopId,
      snapshotLineId: snapshotLine.id,
      causeId: causeB.id,
      causeName: causeB.name,
      is501c3: causeB.is501c3,
      percentage: decimal("30.00"),
      amount: decimal("3.99"),
    },
  });

  await prisma.adjustment.create({
    data: {
      shopId,
      snapshotLineId: snapshotLine.id,
      type: "refund",
      reason: "Customer refund",
      netContribAdj: decimal("-1.50"),
      laborAdj: decimal("0.00"),
      materialAdj: decimal("0.00"),
      packagingAdj: decimal("0.00"),
      equipmentAdj: decimal("0.00"),
      actor: "system",
    },
  });

  await prisma.businessExpense.create({
    data: {
      shopId,
      category: "inventory_materials",
      subType: "material_purchase",
      name: "Bulk cotton rolls",
      amount: decimal("120.00"),
      expenseDate: new Date("2026-03-06T00:00:00.000Z"),
    },
  });

  await prisma.shopifyChargeTransaction.create({
    data: {
      shopId,
      shopifyTransactionId: "gid://shopify/BalanceTransaction/900000200001",
      shopifyPayoutId: "dev_payout_fixture_001",
      periodId: reportingPeriod.id,
      amount: decimal("12.50"),
      currency: "USD",
      description: "Shopify processing fee",
      processedAt: new Date("2026-03-07T00:00:00.000Z"),
    },
  });

  await prisma.disbursement.create({
    data: {
      shopId,
      periodId: reportingPeriod.id,
      causeId: causeA.id,
      amount: decimal("40.00"),
      paidAt: new Date("2026-03-12T00:00:00.000Z"),
      paymentMethod: "ach",
      referenceId: "DISB-1001",
    },
  });

  await prisma.taxTrueUp.create({
    data: {
      shopId,
      periodId: reportingPeriod.id,
      estimatedTax: decimal("8.00"),
      actualTax: decimal("7.50"),
      delta: decimal("-0.50"),
      filedAt: new Date("2026-03-10T00:00:00.000Z"),
      redistributionNotes: "Rounded down after final filing.",
    },
  });

  const reconciliationSnapshot = await prisma.orderSnapshot.create({
    data: {
      shopId,
      shopifyOrderId: "gid://shopify/Order/900000200002",
      orderNumber: "#2002",
      origin: "reconciliation",
      createdAt: new Date("2026-03-08T14:00:00.000Z"),
      periodId: reportingPeriod.id,
    },
  });

  const reconciliationLine = await prisma.orderSnapshotLine.create({
    data: {
      shopId,
      snapshotId: reconciliationSnapshot.id,
      shopifyLineItemId: "gid://shopify/LineItem/900000200012",
      shopifyVariantId: variantB.shopifyId,
      variantTitle: variantB.title,
      productTitle: product.title,
      quantity: 2,
      salePrice: decimal("34.00"),
      subtotal: decimal("68.00"),
      laborCost: decimal("12.00"),
      materialCost: decimal("15.00"),
      packagingCost: decimal("3.50"),
      equipmentCost: decimal("2.75"),
      mistakeBufferAmount: decimal("2.04"),
      totalCost: decimal("35.29"),
      netContribution: decimal("32.71"),
    },
  });

  await prisma.lineCauseAllocation.create({
    data: {
      shopId,
      snapshotLineId: reconciliationLine.id,
      causeId: causeA.id,
      causeName: causeA.name,
      is501c3: causeA.is501c3,
      percentage: decimal("70.00"),
      amount: decimal("22.90"),
    },
  });
}

async function main() {
  const { shopId: shopArg, reset } = parseArgs();
  const shopId = await resolveShopId(shopArg);

  if (!shopId) {
    throw new Error("No shop found. Pass --shop=your-shop.myshopify.com or set SEED_SHOP_ID.");
  }

  if (reset) {
    await resetShopData(shopId);
  }

  await seed(shopId);
  console.log(`Seeded dev data for ${shopId}${reset ? " (reset)" : ""}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
