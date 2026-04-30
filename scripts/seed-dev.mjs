import { Prisma, PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";
import { applySeedPreset, DEFAULT_SEED_OPTIONS } from "./seed-options.mjs";

const prisma = new PrismaClient();
const SEED_MARKER = "Seed:";

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    shopId: null,
    reset: false,
    months: DEFAULT_SEED_OPTIONS.months,
    ordersMin: DEFAULT_SEED_OPTIONS.ordersMin,
    ordersMax: DEFAULT_SEED_OPTIONS.ordersMax,
    completeSetup: DEFAULT_SEED_OPTIONS.completeSetup,
    preset: null,
    endDate: null,
  };

  for (const arg of args) {
    if (arg === "--reset") result.reset = true;
    if (arg.startsWith("--shop=")) result.shopId = arg.slice("--shop=".length).trim();
    if (arg.startsWith("--preset=")) result.preset = arg.slice("--preset=".length).trim();
    if (arg.startsWith("--months=")) result.months = Number(arg.slice("--months=".length));
    if (arg.startsWith("--orders-min=")) result.ordersMin = Number(arg.slice("--orders-min=".length));
    if (arg.startsWith("--orders-max=")) result.ordersMax = Number(arg.slice("--orders-max=".length));
    if (arg.startsWith("--end-date=")) result.endDate = arg.slice("--end-date=".length).trim();
  }

  return applySeedPreset(result, result.preset);
}

function decimal(value) {
  return new Prisma.Decimal(value);
}

function sanitizeShopId(shopId) {
  return shopId.replace(/[^a-zA-Z0-9]/g, "-");
}

function gid(type, id) {
  return `gid+seed://shopify/${type}/${id}`;
}

function hashStringToInt(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function startOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function parseEndDate(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    prisma.orderSnapshotMaterialLine.deleteMany({
      where: { snapshotLine: { snapshot: { shopId } } },
    }),
    prisma.orderSnapshotEquipmentLine.deleteMany({
      where: { snapshotLine: { snapshot: { shopId } } },
    }),
    prisma.orderSnapshotPODLine.deleteMany({
      where: { snapshotLine: { snapshot: { shopId } } },
    }),
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
    prisma.costTemplateMaterialLine.deleteMany({
      where: { template: { shopId } },
    }),
    prisma.costTemplateEquipmentLine.deleteMany({
      where: { template: { shopId } },
    }),
    deleteByShop(prisma.costTemplate),
    deleteByShop(prisma.materialLibraryItem),
    deleteByShop(prisma.equipmentLibraryItem),
    deleteByShop(prisma.cause),
    deleteByShop(prisma.taxOffsetCache),
  ]);
}

async function clearSeedArtifacts(shopId, shopKey) {
  const seedGidPrefix = `gid+seed://shopify/`;

  await prisma.lineCauseAllocation.deleteMany({
    where: {
      snapshotLine: {
        snapshot: {
          shopId,
          shopifyOrderId: { startsWith: `${seedGidPrefix}Order/` },
        },
      },
    },
  });

  await prisma.adjustment.deleteMany({
    where: {
      snapshotLine: {
        snapshot: {
          shopId,
          shopifyOrderId: { startsWith: `${seedGidPrefix}Order/` },
        },
      },
    },
  });

  await prisma.orderSnapshotLine.deleteMany({
    where: {
      snapshot: {
        shopId,
        shopifyOrderId: { startsWith: `${seedGidPrefix}Order/` },
      },
    },
  });

  await prisma.orderSnapshot.deleteMany({
    where: {
      shopId,
      shopifyOrderId: { startsWith: `${seedGidPrefix}Order/` },
    },
  });

  await prisma.reportingPeriod.deleteMany({
    where: {
      shopId,
      shopifyPayoutId: { startsWith: `${seedGidPrefix}Payout/` },
    },
  });

  await prisma.productCauseAssignment.deleteMany({
    where: {
      product: {
        shopifyId: { startsWith: `${seedGidPrefix}Product/` },
      },
    },
  });

  await prisma.variantCostConfig.deleteMany({
    where: {
      variant: {
        shopifyId: { startsWith: `${seedGidPrefix}ProductVariant/` },
      },
    },
  });

  await prisma.variant.deleteMany({
    where: {
      shopId,
      shopifyId: { startsWith: `${seedGidPrefix}ProductVariant/` },
    },
  });

  await prisma.product.deleteMany({
    where: {
      shopId,
      shopifyId: { startsWith: `${seedGidPrefix}Product/` },
    },
  });

  await prisma.costTemplate.deleteMany({
    where: {
      shopId,
      name: { startsWith: SEED_MARKER },
    },
  });

  await prisma.materialLibraryItem.deleteMany({
    where: {
      shopId,
      name: { startsWith: SEED_MARKER },
    },
  });

  await prisma.equipmentLibraryItem.deleteMany({
    where: {
      shopId,
      name: { startsWith: SEED_MARKER },
    },
  });

  await prisma.cause.deleteMany({
    where: {
      shopId,
      name: { startsWith: SEED_MARKER },
    },
  });

  await prisma.shopifyChargeTransaction.deleteMany({
    where: {
      shopId,
      shopifyTransactionId: {
        startsWith: `${seedGidPrefix}BalanceTransaction/`,
      },
    },
  });

  await prisma.businessExpense.deleteMany({
    where: {
      shopId,
      name: { startsWith: SEED_MARKER },
    },
  });

  await prisma.disbursement.deleteMany({
    where: {
      shopId,
      referenceId: { startsWith: SEED_MARKER },
    },
  });

  await prisma.taxTrueUp.deleteMany({
    where: {
      shopId,
      redistributionNotes: { startsWith: SEED_MARKER },
    },
  });
}

async function seed(shopId, options) {
  const shopifyDomain = shopId;
  const shopKey = sanitizeShopId(shopId);
  const parsedEndDate = parseEndDate(options.endDate);
  const endDate = parsedEndDate ?? startOfUtcMonth(new Date());
  const seedKey = `${shopId}|${endDate.toISOString().slice(0, 10)}|${options.months}|${options.ordersMin}|${options.ordersMax}`;

  faker.seed(hashStringToInt(seedKey));

  const startDate = addUtcMonths(endDate, -options.months);

  await prisma.shop.upsert({
    where: { shopId },
    update: {
      shopifyDomain,
      currency: "USD",
      mistakeBuffer: decimal("0.05"),
      defaultLaborRate: decimal("24.00"),
      catalogSynced: true,
      postPurchaseEmailEnabled: true,
      wizardStep: options.completeSetup ? 8 : 0,
    },
    create: {
      shopId,
      shopifyDomain,
      currency: "USD",
      mistakeBuffer: decimal("0.05"),
      defaultLaborRate: decimal("24.00"),
      catalogSynced: true,
      postPurchaseEmailEnabled: true,
      wizardStep: options.completeSetup ? 8 : 0,
    },
  });

  await prisma.wizardState.upsert({
    where: { shopId },
    update: {
      currentStep: options.completeSetup ? 8 : 0,
      completedSteps: options.completeSetup ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [],
      skippedSteps: [],
    },
    create: {
      shopId,
      currentStep: options.completeSetup ? 8 : 0,
      completedSteps: options.completeSetup ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [],
      skippedSteps: [],
    },
  });

  await clearSeedArtifacts(shopId, shopKey);

  const causes = await prisma.$transaction([
    prisma.cause.create({
      data: {
        shopId,
        name: `${SEED_MARKER} Community Relief`,
        legalName: "Community Relief Fund",
        is501c3: true,
        donationLink: "https://example.org/relief",
        status: "active",
      },
    }),
    prisma.cause.create({
      data: {
        shopId,
        name: `${SEED_MARKER} Neighborhood Arts`,
        legalName: "Neighborhood Arts Collective",
        is501c3: false,
        donationLink: "https://example.org/arts",
        status: "active",
      },
    }),
    prisma.cause.create({
      data: {
        shopId,
        name: `${SEED_MARKER} Local Food Bank`,
        legalName: "Local Food Bank",
        is501c3: true,
        donationLink: "https://example.org/food",
        status: "active",
      },
    }),
  ]);

  const [materialYield, materialUses, materialShip, equipmentPress, equipmentCutter] = await prisma.$transaction([
    prisma.materialLibraryItem.create({
      data: {
        shopId,
        name: `${SEED_MARKER} Premium Cotton`,
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
        name: `${SEED_MARKER} Ink Cartridge`,
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
        name: `${SEED_MARKER} Shipping Mailer`,
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
        name: `${SEED_MARKER} Heat Press`,
        hourlyRate: decimal("18.00"),
        perUseCost: decimal("0.40"),
        equipmentCost: decimal("950.00"),
        status: "active",
      },
    }),
    prisma.equipmentLibraryItem.create({
      data: {
        shopId,
        name: `${SEED_MARKER} Cutter`,
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
      name: `${SEED_MARKER} Standard Shipping`,
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
      name: `${SEED_MARKER} Core Production`,
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

  const products = [];
  for (let i = 0; i < 3; i += 1) {
    const title = `${SEED_MARKER} ${faker.commerce.productName()}`;
    const handle = `${shopKey}-product-${i + 1}`;
    const product = await prisma.product.upsert({
      where: { shopId_shopifyId: { shopId, shopifyId: gid("Product", `${shopKey}-product-${i + 1}`) } },
      create: {
        shopId,
        shopifyId: gid("Product", `${shopKey}-product-${i + 1}`),
        title,
        handle,
        status: "active",
        syncedAt: endDate,
      },
      update: {
        title,
        handle,
        status: "active",
        syncedAt: endDate,
      },
    });

    const variants = [];
    for (let v = 0; v < 2; v += 1) {
      const variantTitle = `${title} / ${v === 0 ? "Small" : "Large"}`;
      const sku = `${handle.toUpperCase().slice(0, 8)}-${v === 0 ? "S" : "L"}`;
      const price = decimal(faker.commerce.price({ min: 20, max: 50, dec: 2 }));
      const variant = await prisma.variant.upsert({
        where: { shopId_shopifyId: { shopId, shopifyId: gid("ProductVariant", `${shopKey}-variant-${i + 1}-${v + 1}`) } },
        create: {
          shopId,
          shopifyId: gid("ProductVariant", `${shopKey}-variant-${i + 1}-${v + 1}`),
          productId: product.id,
          title: variantTitle,
          sku,
          price,
          syncedAt: endDate,
        },
        update: {
          title: variantTitle,
          sku,
          price,
          syncedAt: endDate,
        },
      });
      variants.push(variant);
    }

    products.push({ product, variants });
  }

  for (const { product } of products) {
    await prisma.productCauseAssignment.createMany({
      data: [
        {
          shopId,
          shopifyProductId: product.shopifyId,
          productId: product.id,
          causeId: causes[0].id,
          percentage: decimal("70.00"),
        },
        {
          shopId,
          shopifyProductId: product.shopifyId,
          productId: product.id,
          causeId: causes[1].id,
          percentage: decimal("30.00"),
        },
      ],
      skipDuplicates: true,
    });
  }

  const config = await prisma.variantCostConfig.create({
    data: {
      shopId,
      variantId: products[0].variants[0].id,
      productionTemplateId: productionTemplate.id,
      shippingTemplateId: shippingTemplate.id,
      laborMinutes: decimal("8.00"),
      laborRate: decimal("22.00"),
      mistakeBuffer: decimal("0.03"),
      materialLines: {
        create: {
          shopId,
          materialId: materialYield.id,
          quantity: decimal("1.00"),
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

  const periodAllocations = new Map();
  const periodIds = [];

  for (let monthIndex = 0; monthIndex < options.months; monthIndex += 1) {
    const periodStart = addUtcMonths(startDate, monthIndex);
    const periodEnd = addUtcMonths(periodStart, 1);
    const periodKey = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, "0")}`;
    const shopifyPayoutId = `gid+seed://shopify/Payout/${shopKey}-${periodKey}`;
    const status = monthIndex < options.months - 1 ? "CLOSED" : "OPEN";

    const period = await prisma.reportingPeriod.upsert({
      where: { shopId_shopifyPayoutId: { shopId, shopifyPayoutId } },
      create: {
        shopId,
        status,
        source: "payout",
        startDate: periodStart,
        endDate: periodEnd,
        shopifyPayoutId,
      },
      update: {
        status,
        startDate: periodStart,
        endDate: periodEnd,
      },
    });

    periodIds.push(period);
    periodAllocations.set(period.id, new Map());

    const chargeId = gid("BalanceTransaction", `${shopKey}-charge-${periodKey}`);
    await prisma.shopifyChargeTransaction.upsert({
      where: { shopId_shopifyTransactionId: { shopId, shopifyTransactionId: chargeId } },
      create: {
        shopId,
        shopifyTransactionId: chargeId,
        shopifyPayoutId,
        periodId: period.id,
        amount: decimal(faker.finance.amount({ min: 8, max: 18, dec: 2 })),
        currency: "USD",
        description: `${SEED_MARKER} Processing fee ${periodKey}`,
        processedAt: faker.date.between({ from: periodStart, to: periodEnd }),
      },
      update: {
        periodId: period.id,
        amount: decimal(faker.finance.amount({ min: 8, max: 18, dec: 2 })),
        processedAt: faker.date.between({ from: periodStart, to: periodEnd }),
      },
    });

    await prisma.businessExpense.create({
      data: {
        shopId,
        category: "inventory_materials",
        subType: "material_purchase",
        name: `${SEED_MARKER} Bulk materials ${periodKey}`,
        amount: decimal(faker.finance.amount({ min: 80, max: 220, dec: 2 })),
        expenseDate: faker.date.between({ from: periodStart, to: periodEnd }),
      },
    });
  }

  for (let monthIndex = 0; monthIndex < options.months; monthIndex += 1) {
    const period = periodIds[monthIndex];
    const periodStart = period.startDate;
    const periodEnd = period.endDate;
    const orderCount = faker.number.int({ min: options.ordersMin, max: options.ordersMax });

    for (let orderIndex = 0; orderIndex < orderCount; orderIndex += 1) {
      const createdAt = faker.date.between({ from: periodStart, to: periodEnd });
      const productEntry = faker.helpers.arrayElement(products);
      const variant = faker.helpers.arrayElement(productEntry.variants);
      const quantity = faker.number.int({ min: 1, max: 3 });
      const salePrice = decimal(variant.price);
      const subtotal = decimal(salePrice.mul(quantity));

      const laborCost = decimal(faker.finance.amount({ min: 2, max: 8, dec: 2 }));
      const materialCost = decimal(faker.finance.amount({ min: 3, max: 10, dec: 2 }));
      const packagingCost = decimal(faker.finance.amount({ min: 0.5, max: 2.5, dec: 2 }));
      const equipmentCost = decimal(faker.finance.amount({ min: 0.5, max: 2.0, dec: 2 }));
      const mistakeBufferAmount = decimal(faker.finance.amount({ min: 0.3, max: 1.2, dec: 2 }));

      const totalCost = laborCost.add(materialCost).add(packagingCost).add(equipmentCost).add(mistakeBufferAmount);
      const netContribution = subtotal.sub(totalCost);

      const orderKey = `${shopKey}-${periodStart.getUTCFullYear()}${String(periodStart.getUTCMonth() + 1).padStart(2, "0")}-${orderIndex + 1}`;
      const shopifyOrderId = gid("Order", orderKey);

      const snapshot = await prisma.orderSnapshot.upsert({
        where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
        create: {
          shopId,
          shopifyOrderId,
          orderNumber: `#S-${String(orderIndex + 1).padStart(3, "0")}`,
          origin: faker.helpers.arrayElement(["webhook", "reconciliation"]),
          createdAt,
          periodId: period.id,
        },
        update: {
          createdAt,
          periodId: period.id,
        },
      });

      await prisma.lineCauseAllocation.deleteMany({
        where: { snapshotLine: { snapshotId: snapshot.id } },
      });
      await prisma.adjustment.deleteMany({
        where: { snapshotLine: { snapshotId: snapshot.id } },
      });
      await prisma.orderSnapshotLine.deleteMany({
        where: { snapshotId: snapshot.id },
      });

      const line = await prisma.orderSnapshotLine.create({
        data: {
          shopId,
          snapshotId: snapshot.id,
          shopifyLineItemId: gid("LineItem", `${orderKey}-line-1`),
          shopifyVariantId: variant.shopifyId,
          variantTitle: variant.title,
          productTitle: productEntry.product.title,
          quantity,
          salePrice,
          subtotal,
          laborCost,
          materialCost,
          packagingCost,
          equipmentCost,
          mistakeBufferAmount,
          totalCost,
          netContribution,
        },
      });

      const causeSplit = faker.number.int({ min: 55, max: 85 });
      const allocationBase = Prisma.Decimal.max(netContribution, decimal(0));
      const primaryAllocation = allocationBase.mul(decimal(causeSplit)).div(decimal(100));
      const secondaryAllocation = allocationBase.sub(primaryAllocation);

      const allocations = [
        { cause: causes[0], percentage: causeSplit, amount: primaryAllocation },
        { cause: causes[1], percentage: 100 - causeSplit, amount: secondaryAllocation },
      ];

      for (const allocation of allocations) {
        await prisma.lineCauseAllocation.create({
          data: {
            shopId,
            snapshotLineId: line.id,
            causeId: allocation.cause.id,
            causeName: allocation.cause.name,
            is501c3: allocation.cause.is501c3,
            percentage: decimal(allocation.percentage.toFixed(2)),
            amount: allocation.amount,
          },
        });

        const allocationMap = periodAllocations.get(period.id);
        const current = allocationMap.get(allocation.cause.id) ?? decimal(0);
        allocationMap.set(allocation.cause.id, current.add(allocation.amount));
      }

      if (faker.datatype.boolean({ probability: 0.2 })) {
        await prisma.adjustment.create({
          data: {
            shopId,
            snapshotLineId: line.id,
            type: "refund",
            reason: "Seeded refund",
            netContribAdj: decimal("-1.00"),
            laborAdj: decimal("0.00"),
            materialAdj: decimal("0.00"),
            packagingAdj: decimal("0.00"),
            equipmentAdj: decimal("0.00"),
            actor: "system",
          },
        });
      }
    }
  }

  for (const period of periodIds) {
    const allocationMap = periodAllocations.get(period.id);
    for (const cause of causes) {
      const allocated = allocationMap.get(cause.id) ?? decimal(0);
      if (allocated.equals(0)) continue;

      await prisma.causeAllocation.upsert({
        where: { periodId_causeId: { periodId: period.id, causeId: cause.id } },
        create: {
          shopId,
          periodId: period.id,
          causeId: cause.id,
          causeName: cause.name,
          is501c3: cause.is501c3,
          allocated,
          disbursed: decimal("0.00"),
        },
        update: {
          allocated,
        },
      });

      if (period.status === "CLOSED") {
        const disbursedAmount = allocated.mul(decimal("0.5"));
        await prisma.disbursement.create({
          data: {
            shopId,
            periodId: period.id,
            causeId: cause.id,
            amount: disbursedAmount,
            paidAt: faker.date.between({ from: period.startDate, to: period.endDate }),
            paymentMethod: "ach",
            referenceId: `${SEED_MARKER}DISB-${period.id}-${cause.id}`,
          },
        });

        await prisma.causeAllocation.update({
          where: { periodId_causeId: { periodId: period.id, causeId: cause.id } },
          data: { disbursed: disbursedAmount },
        });
      }
    }

    if (period.status === "CLOSED") {
      await prisma.taxTrueUp.create({
        data: {
          shopId,
          periodId: period.id,
          estimatedTax: decimal(faker.finance.amount({ min: 5, max: 12, dec: 2 })),
          actualTax: decimal(faker.finance.amount({ min: 4, max: 11, dec: 2 })),
          delta: decimal(faker.finance.amount({ min: -2, max: 2, dec: 2 })),
          filedAt: faker.date.between({ from: period.startDate, to: period.endDate }),
          redistributionNotes: `${SEED_MARKER} Month-end tax true-up`,
        },
      });
    }
  }

  console.log(
    `Seeded ${options.preset ?? "dev"} data for ${shopId} (${options.months} months ending ${endDate.toISOString().slice(0, 10)}).`,
  );
}

async function main() {
  const { shopId: shopArg, reset, months, ordersMin, ordersMax, endDate } = parseArgs();
  const shopId = await resolveShopId(shopArg);

  if (!shopId) {
    throw new Error("No shop found. Pass --shop=your-shop.myshopify.com or set SEED_SHOP_ID.");
  }

  if (Number.isNaN(months) || months <= 0) {
    throw new Error("--months must be a positive number.");
  }

  if (Number.isNaN(ordersMin) || Number.isNaN(ordersMax) || ordersMin <= 0 || ordersMax < ordersMin) {
    throw new Error("--orders-min and --orders-max must be positive numbers, with max >= min.");
  }

  if (endDate && !parseEndDate(endDate)) {
    throw new Error("--end-date must be formatted as YYYY-MM-DD.");
  }

  if (reset) {
    await resetShopData(shopId);
  }

  await seed(shopId, { months, ordersMin, ordersMax, endDate });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
