import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_LABOR_RATE = new Prisma.Decimal("15")
const DEFAULT_MISTAKE_BUFFER = new Prisma.Decimal("0.1");

const EXPECTED_COLLECTIONS = [
  "materialLibraryItems",
  "equipmentLibraryItems",
  "causes",
  "products",
  "variants",
  "variantCostConfigs",
  "variantMaterialLines",
  "variantEquipmentLines",
  "productCauseAssignments",
];
const VALID_PRODUCT_STATUSES = new Set(["active", "archived", "draft"]);

function parseArgs() {
  const result = {
    file: null,
    ordersCsv: null,
    chargesCsv: null,
    paymentTransactionsCsv: null,
    shopId: null,
    shopDomain: null,
    dryRun: false,
    resetShop: false,
    resetOnly: false,
    replaceCatalog: false,
    replaceFinancials: false,
    normalizeProductStatus: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") result.dryRun = true;
    if (arg === "--reset-shop") result.resetShop = true;
    if (arg === "--reset-only") result.resetOnly = true;
    if (arg === "--replace-catalog") result.replaceCatalog = true;
    if (arg === "--replace-financials") result.replaceFinancials = true;
    if (arg === "--normalize-product-status") result.normalizeProductStatus = true;
    if (arg.startsWith("--file=")) result.file = arg.slice("--file=".length).trim();
    if (arg.startsWith("--orders-csv=")) result.ordersCsv = arg.slice("--orders-csv=".length).trim();
    if (arg.startsWith("--charges-csv=")) result.chargesCsv = arg.slice("--charges-csv=".length).trim();
    if (arg.startsWith("--payment-transactions-csv=")) result.paymentTransactionsCsv = arg.slice("--payment-transactions-csv=".length).trim();
    if (arg.startsWith("--shop=")) result.shopId = arg.slice("--shop=".length).trim();
    if (arg.startsWith("--shop-domain=")) result.shopDomain = arg.slice("--shop-domain=".length).trim();
  }

  if (!result.shopDomain && result.shopId) {
    result.shopDomain = result.shopId;
  }

  if (result.resetOnly) {
    result.resetShop = true;
  }

  if (result.resetShop) {
    result.replaceCatalog = true;
    result.replaceFinancials = true;
  }

  if (!result.file) {
    throw new Error("Pass --file=/path/to/shopify-prisma-staging-export_v2.json");
  }

  return result;
}

function decimal(value) {
  if (value === null || value === undefined || value === "") return null;
  return new Prisma.Decimal(value);
}

function date(value) {
  if (!value) return new Date();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }
  return parsed;
}

function syntheticGid(kind, value) {
  const digest = createHash("sha256").update(`${kind}:${value}`).digest("hex").slice(0, 24);
  return `gid+devimport://shopify/${kind}/${digest}`;
}

function parseCsvFile(file) {
  if (!file) return [];
  const text = readFileSync(file, "utf8");
  const rawRows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rawRows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rawRows.push(row);
  }

  const [headers, ...rows] = rawRows.filter((entry) => entry.some((value) => value !== ""));
  if (!headers) return [];
  return rows.map((entry) => Object.fromEntries(headers.map((header, index) => [header, entry[index] ?? ""])));
}

function parseMoney(value) {
  if (value === null || value === undefined || value === "") return new Prisma.Decimal(0);
  return new Prisma.Decimal(String(value).replace(/[$,']/g, "") || 0);
}

function parseInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function moneyToCents(value) {
  return new Prisma.Decimal(value).mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

function centsToMoney(cents) {
  return new Prisma.Decimal(cents).div(100);
}

function monthKeyFromDate(value) {
  const parsed = date(value);
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(monthKey) {
  const [year, month] = monthKey.split("-").map((part) => Number.parseInt(part, 10));
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1)),
    endDate: new Date(Date.UTC(year, month, 1)),
  };
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function redactChargeDescription(description) {
  if (!description) return null;
  return description.replace(/\bto\s+[^,]+,\s+[A-Za-z ]+/i, "to redacted destination");
}

function uniqueValues(rows, key) {
  return new Set(rows.map((row) => row[key]).filter(Boolean));
}

function duplicateValues(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

function normalizeProductStatus(status, shouldNormalize) {
  if (!shouldNormalize) return status;
  if (status === "unlisted") return "archived";
  return status;
}

function loadExport(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  for (const collection of EXPECTED_COLLECTIONS) {
    if (!Array.isArray(data[collection])) {
      throw new Error(`Missing expected array: ${collection}`);
    }
  }
  return data;
}

function validateExport(data, targetShopId) {
  const errors = [];
  const warnings = [];

  const materialKeys = uniqueValues(data.materialLibraryItems, "_dedupeKey");
  const equipmentKeys = uniqueValues(data.equipmentLibraryItems, "_dedupeKey");
  const causeKeys = uniqueValues(data.causes, "_dedupeKey");
  const productIds = uniqueValues(data.products, "shopifyId");
  const variantIds = uniqueValues(data.variants, "shopifyId");

  for (const [collection, key] of [
    ["materialLibraryItems", "_dedupeKey"],
    ["equipmentLibraryItems", "_dedupeKey"],
    ["causes", "_dedupeKey"],
    ["products", "shopifyId"],
    ["variants", "shopifyId"],
  ]) {
    const duplicates = duplicateValues(data[collection], key);
    if (duplicates.length > 0) {
      errors.push(`${collection} has duplicate ${key} values: ${duplicates.slice(0, 5).join(", ")}`);
    }
  }

  for (const row of data.variants) {
    if (!productIds.has(row.productShopifyId)) {
      errors.push(`Variant ${row.shopifyId} references missing product ${row.productShopifyId}`);
    }
  }

  for (const row of data.variantCostConfigs) {
    if (!variantIds.has(row.variantShopifyId)) {
      errors.push(`Variant cost config references missing variant ${row.variantShopifyId}`);
    }
    if (row.productionTemplateId || row.shippingTemplateId) {
      warnings.push(`Variant ${row.variantShopifyId} references a cost template, but this import does not include costTemplates.`);
    }
  }

  for (const row of data.variantMaterialLines) {
    if (!variantIds.has(row.variantShopifyId)) {
      errors.push(`Material line ${row._dedupeKey} references missing variant ${row.variantShopifyId}`);
    }
    if (!materialKeys.has(row.materialDedupeKey)) {
      errors.push(`Material line ${row._dedupeKey} references missing material ${row.materialDedupeKey}`);
    }
    if (row.templateLineId) {
      warnings.push(`Material line ${row._dedupeKey} has templateLineId, but this import does not include costTemplateMaterialLines.`);
    }
  }

  for (const row of data.variantEquipmentLines) {
    if (!variantIds.has(row.variantShopifyId)) {
      errors.push(`Equipment line ${row._dedupeKey} references missing variant ${row.variantShopifyId}`);
    }
    if (!equipmentKeys.has(row.equipmentDedupeKey)) {
      errors.push(`Equipment line ${row._dedupeKey} references missing equipment ${row.equipmentDedupeKey}`);
    }
    if (row.templateLineId) {
      warnings.push(`Equipment line ${row._dedupeKey} has templateLineId, but this import does not include costTemplateEquipmentLines.`);
    }
  }

  const assignmentTotals = new Map();
  for (const row of data.productCauseAssignments) {
    const productShopifyId = row.productShopifyId || row.shopifyProductId;
    if (!productIds.has(productShopifyId)) {
      errors.push(`Product-cause assignment ${row._dedupeKey} references missing product ${productShopifyId}`);
    }
    if (!causeKeys.has(row.causeDedupeKey)) {
      errors.push(`Product-cause assignment ${row._dedupeKey} references missing cause ${row.causeDedupeKey}`);
    }
    assignmentTotals.set(productShopifyId, (assignmentTotals.get(productShopifyId) ?? 0) + Number(row.percentage ?? 0));
  }

  for (const product of data.products) {
    if (!VALID_PRODUCT_STATUSES.has(product.status)) {
      warnings.push(`Product ${product.shopifyId} has non-standard status "${product.status}".`);
    }
    const assignmentTotal = assignmentTotals.get(product.shopifyId) ?? 0;
    if (assignmentTotal === 0) {
      warnings.push(`Product ${product.shopifyId} has no cause assignment.`);
    } else if (assignmentTotal > 100) {
      warnings.push(`Product ${product.shopifyId} cause assignments total ${assignmentTotal.toFixed(2)}%, over 100%.`);
    }
  }

  for (const collection of EXPECTED_COLLECTIONS) {
    for (const row of data[collection]) {
      if (row.shopId && row.shopId !== targetShopId) {
        warnings.push(`${collection} row for source shop ${row.shopId} will be imported into ${targetShopId}.`);
        break;
      }
    }
  }

  return { errors, warnings };
}

async function replaceCatalog(shopId) {
  await prisma.$transaction([
    prisma.disbursementApplication.deleteMany({
      where: {
        OR: [
          { disbursement: { cause: { shopId } } },
          { causeAllocation: { cause: { shopId } } },
        ],
      },
    }),
    prisma.lineCauseAllocation.deleteMany({ where: { cause: { shopId } } }),
    prisma.taxTrueUpRedistribution.deleteMany({ where: { cause: { shopId } } }),
    prisma.causeAllocation.deleteMany({ where: { cause: { shopId } } }),
    prisma.disbursement.deleteMany({ where: { cause: { shopId } } }),
    prisma.productCauseAssignment.deleteMany({
      where: {
        OR: [
          { shopId },
          { cause: { shopId } },
        ],
      },
    }),
    prisma.variantMaterialLine.deleteMany({
      where: {
        OR: [
          { shopId },
          { material: { shopId } },
        ],
      },
    }),
    prisma.variantEquipmentLine.deleteMany({
      where: {
        OR: [
          { shopId },
          { equipment: { shopId } },
        ],
      },
    }),
    prisma.variantCostConfig.deleteMany({ where: { shopId } }),
    prisma.variant.deleteMany({ where: { shopId } }),
    prisma.product.deleteMany({ where: { shopId } }),
    prisma.costTemplateMaterialLine.deleteMany({
      where: {
        OR: [
          { template: { shopId } },
          { material: { shopId } },
        ],
      },
    }),
    prisma.costTemplateEquipmentLine.deleteMany({
      where: {
        OR: [
          { template: { shopId } },
          { equipment: { shopId } },
        ],
      },
    }),
    prisma.costTemplate.deleteMany({ where: { shopId } }),
    prisma.materialLibraryItem.deleteMany({ where: { shopId } }),
    prisma.equipmentLibraryItem.deleteMany({ where: { shopId } }),
    prisma.cause.deleteMany({ where: { shopId } }),
  ]);
}

async function replaceFinancials(shopId) {
  await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { shopId } }),
    prisma.adjustment.deleteMany({ where: { shopId } }),
    prisma.lineCauseAllocation.deleteMany({ where: { shopId } }),
    prisma.orderSnapshotMaterialLine.deleteMany({ where: { snapshotLine: { shopId } } }),
    prisma.orderSnapshotEquipmentLine.deleteMany({ where: { snapshotLine: { shopId } } }),
    prisma.orderSnapshotPODLine.deleteMany({ where: { snapshotLine: { shopId } } }),
    prisma.orderSnapshotLine.deleteMany({ where: { shopId } }),
    prisma.orderSnapshot.deleteMany({ where: { shopId } }),
    prisma.disbursementApplication.deleteMany({ where: { shopId } }),
    prisma.causeAllocation.deleteMany({ where: { shopId } }),
    prisma.disbursement.deleteMany({ where: { shopId } }),
    prisma.taxTrueUpRedistribution.deleteMany({ where: { shopId } }),
    prisma.taxTrueUp.deleteMany({ where: { shopId } }),
    prisma.shopifyChargeTransaction.deleteMany({ where: { shopId } }),
    prisma.businessExpense.deleteMany({ where: { shopId } }),
    prisma.taxOffsetCache.deleteMany({ where: { shopId } }),
    prisma.analyticalRecalculationRun.deleteMany({ where: { shopId } }),
    prisma.reportingPeriod.deleteMany({ where: { shopId } }),
  ]);
}

async function shopDataCounts(shopId) {
  return {
    materials: await prisma.materialLibraryItem.count({ where: { shopId } }),
    equipment: await prisma.equipmentLibraryItem.count({ where: { shopId } }),
    causes: await prisma.cause.count({ where: { shopId } }),
    products: await prisma.product.count({ where: { shopId } }),
    variants: await prisma.variant.count({ where: { shopId } }),
    orders: await prisma.orderSnapshot.count({ where: { shopId } }),
    reportingPeriods: await prisma.reportingPeriod.count({ where: { shopId } }),
  };
}

function printShopDataCounts(shopId, counts) {
  console.log(
    `Shop ${shopId} now has ${counts.materials} materials, ${counts.equipment} equipment items, ${counts.causes} causes, ${counts.products} products, ${counts.variants} variants, ${counts.orders} order snapshots, and ${counts.reportingPeriods} reporting periods.`,
  );
}

function buildCatalogIndexes(data) {
  const productsByShopifyId = new Map(data.products.map((product) => [product.shopifyId, product]));
  const variantsByShopifyId = new Map(data.variants.map((variant) => [variant.shopifyId, variant]));
  const configsByVariantShopifyId = new Map(data.variantCostConfigs.map((config) => [config.variantShopifyId, config]));
  const materialsByDedupeKey = new Map(data.materialLibraryItems.map((material) => [material._dedupeKey, material]));
  const equipmentByDedupeKey = new Map(data.equipmentLibraryItems.map((equipment) => [equipment._dedupeKey, equipment]));
  const materialLinesByVariantShopifyId = new Map();
  const equipmentLinesByVariantShopifyId = new Map();
  const assignmentsByProductShopifyId = new Map();

  for (const line of data.variantMaterialLines) {
    const lines = materialLinesByVariantShopifyId.get(line.variantShopifyId) ?? [];
    lines.push(line);
    materialLinesByVariantShopifyId.set(line.variantShopifyId, lines);
  }

  for (const line of data.variantEquipmentLines) {
    const lines = equipmentLinesByVariantShopifyId.get(line.variantShopifyId) ?? [];
    lines.push(line);
    equipmentLinesByVariantShopifyId.set(line.variantShopifyId, lines);
  }

  for (const assignment of data.productCauseAssignments) {
    const productShopifyId = assignment.productShopifyId || assignment.shopifyProductId;
    const assignments = assignmentsByProductShopifyId.get(productShopifyId) ?? [];
    assignments.push(assignment);
    assignmentsByProductShopifyId.set(productShopifyId, assignments);
  }

  const variantsByLineName = new Map();
  for (const variant of data.variants) {
    const product = productsByShopifyId.get(variant.productShopifyId);
    if (!product) continue;
    const candidates = [product.title];
    if (variant.title && !["default title", "none"].includes(variant.title.toLowerCase())) {
      candidates.push(`${product.title} - ${variant.title}`);
    }
    for (const candidate of candidates) {
      variantsByLineName.set(normalizeText(candidate), variant);
    }
  }

  return {
    productsByShopifyId,
    variantsByShopifyId,
    configsByVariantShopifyId,
    materialsByDedupeKey,
    equipmentByDedupeKey,
    materialLinesByVariantShopifyId,
    equipmentLinesByVariantShopifyId,
    assignmentsByProductShopifyId,
    variantsByLineName,
  };
}

function materialLineCost(line, material) {
  const perUnit = parseMoney(material.purchasePrice).div(parseMoney(material.purchaseQty || 1));
  const quantity = parseMoney(line.quantity);
  const yieldValue = decimal(line.yield);
  const usesPerVariant = decimal(line.usesPerVariant);
  const totalUsesPerUnit = decimal(material.totalUsesPerUnit);

  if (material.costingModel === "yield" && yieldValue?.gt(0)) {
    return perUnit.div(yieldValue).mul(quantity);
  }

  if (material.costingModel === "uses" && totalUsesPerUnit?.gt(0) && usesPerVariant) {
    return perUnit.div(totalUsesPerUnit).mul(usesPerVariant);
  }

  return perUnit.mul(quantity);
}

function equipmentLineCost(line, equipment) {
  let cost = new Prisma.Decimal(0);
  const hourlyRate = decimal(equipment.hourlyRate);
  const perUseCost = decimal(equipment.perUseCost);
  const minutes = decimal(line.minutes);
  const uses = decimal(line.uses);

  if (hourlyRate && minutes) cost = cost.add(hourlyRate.mul(minutes).div(60));
  if (perUseCost && uses) cost = cost.add(perUseCost.mul(uses));
  return cost;
}

function resolveVariantForOrderLine(lineName, indexes) {
  const normalized = normalizeText(lineName);
  return indexes.variantsByLineName.get(normalized) ?? null;
}

function calculateVariantCosts(variant, indexes, defaultMistakeBuffer, defaultLaborRate) {
  const materialLines = indexes.materialLinesByVariantShopifyId.get(variant.shopifyId) ?? [];
  const equipmentLines = indexes.equipmentLinesByVariantShopifyId.get(variant.shopifyId) ?? [];
  const config = indexes.configsByVariantShopifyId.get(variant.shopifyId);
  let materialCost = new Prisma.Decimal(0);
  let packagingCost = new Prisma.Decimal(0);
  let equipmentCost = new Prisma.Decimal(0);
  let maxShippingMaterialCost = new Prisma.Decimal(0);

  for (const line of materialLines) {
    const material = indexes.materialsByDedupeKey.get(line.materialDedupeKey);
    if (!material) continue;
    const lineCost = materialLineCost(line, material);
    if (material.type === "shipping") {
      if (lineCost.gt(maxShippingMaterialCost)) maxShippingMaterialCost = lineCost;
    } else {
      materialCost = materialCost.add(lineCost);
    }
  }
  packagingCost = maxShippingMaterialCost;

  for (const line of equipmentLines) {
    const equipment = indexes.equipmentByDedupeKey.get(line.equipmentDedupeKey);
    if (!equipment) continue;
    equipmentCost = equipmentCost.add(equipmentLineCost(line, equipment));
  }

  const laborMinutes = decimal(config?.laborMinutes);
  const laborRate = decimal(config?.laborRate ?? defaultLaborRate);
  const laborCost = laborMinutes && laborRate ? laborRate.mul(laborMinutes).div(60) : new Prisma.Decimal(0);
  const mistakeBufferAmount = materialCost.mul(defaultMistakeBuffer);
  const totalCost = materialCost.add(packagingCost).add(equipmentCost).add(laborCost).add(mistakeBufferAmount);

  return { materialCost, packagingCost, equipmentCost, laborCost, mistakeBufferAmount, totalCost, laborMinutes, laborRate };
}

function analyzeTemplateTrends(data, indexes) {
  const productionPatterns = new Map();
  const shippingPatterns = new Map();

  for (const variant of data.variants) {
    const materialLines = indexes.materialLinesByVariantShopifyId.get(variant.shopifyId) ?? [];
    const equipmentLines = indexes.equipmentLinesByVariantShopifyId.get(variant.shopifyId) ?? [];
    const productionParts = [];
    const shippingParts = [];

    for (const line of materialLines) {
      const material = indexes.materialsByDedupeKey.get(line.materialDedupeKey);
      if (!material) continue;
      const part = `material:${material.name}:${line.quantity ?? ""}:${line.yield ?? ""}:${line.usesPerVariant ?? ""}`;
      if (material.type === "shipping") shippingParts.push(part);
      else productionParts.push(part);
    }

    for (const line of equipmentLines) {
      const equipment = indexes.equipmentByDedupeKey.get(line.equipmentDedupeKey);
      if (!equipment) continue;
      productionParts.push(`equipment:${equipment.name}:${line.minutes ?? ""}:${line.uses ?? ""}`);
    }

    for (const [map, parts] of [
      [productionPatterns, productionParts],
      [shippingPatterns, shippingParts],
    ]) {
      const signature = parts.sort().join("|");
      if (!signature) continue;
      const current = map.get(signature) ?? { count: 0, examples: [] };
      current.count += 1;
      if (current.examples.length < 3) current.examples.push(variant.shopifyId);
      map.set(signature, current);
    }
  }

  const sortPatterns = (patterns) =>
    Array.from(patterns.entries())
      .map(([signature, value]) => ({ signature, ...value }))
      .sort((left, right) => right.count - left.count);

  return {
    production: sortPatterns(productionPatterns),
    shipping: sortPatterns(shippingPatterns),
  };
}

function groupOrderRows(rows) {
  const orders = new Map();
  for (const row of rows) {
    const name = row.Name;
    if (!name) continue;
    const existing = orders.get(name) ?? { header: null, lines: [] };
    if (row.Id) existing.header = row;
    if (row["Lineitem name"]) existing.lines.push(row);
    orders.set(name, existing);
  }
  return Array.from(orders.entries()).map(([name, value]) => ({ name, ...value }));
}

function buildOrderLineDiscounts(order) {
  const lineGrossCents = order.lines.map((lineRow) => {
    if (normalizeText(lineRow["Lineitem name"]) === "tip") return 0;
    const quantity = parseInteger(lineRow["Lineitem quantity"], 1);
    return moneyToCents(parseMoney(lineRow["Lineitem price"]).mul(quantity));
  });

  const explicitDiscountCents = order.lines.map((lineRow) => moneyToCents(parseMoney(lineRow["Lineitem discount"])));
  const totalExplicitDiscountCents = explicitDiscountCents.reduce((sum, cents) => sum + cents, 0);
  const orderDiscountCents = moneyToCents(parseMoney(order.header?.["Discount Amount"]));
  const remainingDiscountCents = Math.max(0, orderDiscountCents - totalExplicitDiscountCents);

  if (remainingDiscountCents === 0) {
    return explicitDiscountCents.map(centsToMoney);
  }

  const remainingGrossCents = lineGrossCents.map((grossCents, index) =>
    Math.max(0, grossCents - explicitDiscountCents[index]),
  );
  const discountableGrossCents = remainingGrossCents.reduce((sum, cents) => sum + cents, 0);
  if (discountableGrossCents === 0) {
    return explicitDiscountCents.map(centsToMoney);
  }

  const targetCents = Math.min(remainingDiscountCents, discountableGrossCents);
  const allocations = remainingGrossCents.map((grossCents, index) => {
    const exact = (targetCents * grossCents) / discountableGrossCents;
    const cents = Math.floor(exact);
    return { index, cents, remainder: exact - cents };
  });

  let allocatedCents = allocations.reduce((sum, allocation) => sum + allocation.cents, 0);
  for (const allocation of [...allocations].sort((left, right) => right.remainder - left.remainder)) {
    if (allocatedCents >= targetCents) break;
    if (allocation.cents >= remainingGrossCents[allocation.index]) continue;
    allocation.cents += 1;
    allocatedCents += 1;
  }

  return allocations
    .sort((left, right) => left.index - right.index)
    .map((allocation, index) =>
      centsToMoney(Math.min(lineGrossCents[index], explicitDiscountCents[index] + allocation.cents)),
    );
}

function financialAnalysis(options) {
  const orders = groupOrderRows(parseCsvFile(options.ordersCsv));
  const charges = parseCsvFile(options.chargesCsv);
  const transactions = parseCsvFile(options.paymentTransactionsCsv);
  return {
    orderCount: orders.length,
    orderLineCount: orders.reduce((sum, order) => sum + order.lines.length, 0),
    chargeCount: charges.length,
    transactionCount: transactions.length,
  };
}

function periodKeyForOrder(order, transactionsByOrder) {
  const transaction = transactionsByOrder.get(order.name);
  if (transaction?.["Payout Date"]) return monthKeyFromDate(transaction["Payout Date"]);
  return monthKeyFromDate(order.header?.["Created at"] ?? order.lines[0]?.["Created at"]);
}

async function ensurePeriod(periodsByMonth, shopId, monthKey) {
  if (periodsByMonth.has(monthKey)) return periodsByMonth.get(monthKey);
  const { startDate, endDate } = monthRange(monthKey);
  const shopifyPayoutId = syntheticGid("Payout", `${shopId}:${monthKey}`);
  const period = await prisma.reportingPeriod.upsert({
    where: { shopId_shopifyPayoutId: { shopId, shopifyPayoutId } },
    create: {
      shopId,
      status: "CLOSED",
      source: "csv_import",
      startDate,
      endDate,
      shopifyPayoutId,
      closedAt: endDate,
    },
    update: {
      status: "CLOSED",
      source: "csv_import",
      startDate,
      endDate,
      closedAt: endDate,
    },
  });
  periodsByMonth.set(monthKey, period);
  return period;
}

async function importCsvFinancials(data, shopId, options, idMaps, defaultMistakeBuffer, defaultLaborRate) {
  const orderRows = parseCsvFile(options.ordersCsv);
  const charges = parseCsvFile(options.chargesCsv);
  const transactions = parseCsvFile(options.paymentTransactionsCsv);
  if (orderRows.length === 0 && charges.length === 0 && transactions.length === 0) return;

  const indexes = buildCatalogIndexes(data);
  const periodsByMonth = new Map();
  const allocationsByPeriodCause = new Map();
  const transactionsByOrder = new Map();

  for (const transaction of transactions) {
    if (transaction.Order && !transactionsByOrder.has(transaction.Order)) {
      transactionsByOrder.set(transaction.Order, transaction);
    }
  }

  for (const transaction of transactions) {
    const fee = parseMoney(transaction.Fee);
    if (fee.equals(0)) continue;
    const processedAt = date(transaction["Transaction Date"]);
    const monthKey = monthKeyFromDate(transaction["Payout Date"] || transaction["Transaction Date"]);
    const period = await ensurePeriod(periodsByMonth, shopId, monthKey);
    const transactionKey = `${transaction.Order}:${transaction.Checkout}:${transaction.Type}:${transaction["Transaction Date"]}`;
    const shopifyTransactionId = syntheticGid("BalanceTransaction", transactionKey);
    await prisma.shopifyChargeTransaction.upsert({
      where: { shopId_shopifyTransactionId: { shopId, shopifyTransactionId } },
      create: {
        shopId,
        shopifyTransactionId,
        periodId: period.id,
        shopifyPayoutId: transaction["Payout ID"] ? syntheticGid("Payout", transaction["Payout ID"]) : period.shopifyPayoutId,
        transactionType: "payment_fee",
        description: `Payment fee for ${transaction.Order || "redacted order"}`,
        amount: fee,
        currency: transaction.Currency || "USD",
        processedAt,
      },
      update: {
        periodId: period.id,
        shopifyPayoutId: transaction["Payout ID"] ? syntheticGid("Payout", transaction["Payout ID"]) : period.shopifyPayoutId,
        transactionType: "payment_fee",
        description: `Payment fee for ${transaction.Order || "redacted order"}`,
        amount: fee,
        currency: transaction.Currency || "USD",
        processedAt,
      },
    });
  }

  for (const charge of charges) {
    const amount = parseMoney(charge.Amount);
    if (amount.equals(0)) continue;
    const processedAt = charge.Date ? date(charge.Date) : charge["Start of billing cycle"] ? date(charge["Start of billing cycle"]) : new Date();
    const monthKey = monthKeyFromDate(charge.Date || charge["Start of billing cycle"] || processedAt.toISOString());
    const period = await ensurePeriod(periodsByMonth, shopId, monthKey);
    const transactionKey = `${charge["Bill #"]}:${charge["Charge category"]}:${charge.Order}:${charge.Description}:${charge.Date}:${charge.Amount}`;
    const shopifyTransactionId = syntheticGid("Charge", transactionKey);
    await prisma.shopifyChargeTransaction.upsert({
      where: { shopId_shopifyTransactionId: { shopId, shopifyTransactionId } },
      create: {
        shopId,
        shopifyTransactionId,
        periodId: period.id,
        shopifyPayoutId: period.shopifyPayoutId,
        transactionType: charge["Charge category"] || "shopify_charge",
        description: redactChargeDescription(charge.Description),
        amount,
        currency: charge.Currency || "USD",
        processedAt,
      },
      update: {
        periodId: period.id,
        shopifyPayoutId: period.shopifyPayoutId,
        transactionType: charge["Charge category"] || "shopify_charge",
        description: redactChargeDescription(charge.Description),
        amount,
        currency: charge.Currency || "USD",
        processedAt,
      },
    });
  }

  for (const order of groupOrderRows(orderRows)) {
    if (!order.header) continue;
    const period = await ensurePeriod(periodsByMonth, shopId, periodKeyForOrder(order, transactionsByOrder));
    const createdAt = date(order.header["Created at"]);
    const shopifyOrderId = syntheticGid("Order", order.header.Id || order.name);
    const snapshot = await prisma.orderSnapshot.upsert({
      where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
      create: {
        shopId,
        shopifyOrderId,
        orderNumber: order.name,
        origin: "csv_import",
        createdAt,
        periodId: period.id,
      },
      update: {
        orderNumber: order.name,
        origin: "csv_import",
        createdAt,
        periodId: period.id,
      },
    });

    await prisma.lineCauseAllocation.deleteMany({ where: { snapshotLine: { snapshotId: snapshot.id } } });
    await prisma.orderSnapshotLine.deleteMany({ where: { snapshotId: snapshot.id } });

    const lineDiscounts = buildOrderLineDiscounts(order);
    const preparedLines = [];
    let orderSubtotal = new Prisma.Decimal(0);
    let orderPackagingCost = new Prisma.Decimal(0);

    for (let lineIndex = 0; lineIndex < order.lines.length; lineIndex += 1) {
      const lineRow = order.lines[lineIndex];
      if (normalizeText(lineRow["Lineitem name"]) === "tip") continue;
      const variant = resolveVariantForOrderLine(lineRow["Lineitem name"], indexes);
      const product = variant ? indexes.productsByShopifyId.get(variant.productShopifyId) : null;
      const quantity = parseInteger(lineRow["Lineitem quantity"], 1);
      const grossSubtotal = parseMoney(lineRow["Lineitem price"]).mul(quantity);
      const lineDiscount = lineDiscounts[lineIndex] ?? parseMoney(lineRow["Lineitem discount"]);
      const discountedSubtotal = grossSubtotal.sub(lineDiscount);
      const subtotal = discountedSubtotal.isNegative() ? new Prisma.Decimal(0) : discountedSubtotal;
      const salePrice = quantity > 0 ? subtotal.div(quantity) : new Prisma.Decimal(0);
      const costs = variant
        ? calculateVariantCosts(variant, indexes, defaultMistakeBuffer, defaultLaborRate)
        : {
            materialCost: new Prisma.Decimal(0),
            packagingCost: new Prisma.Decimal(0),
            equipmentCost: new Prisma.Decimal(0),
            laborCost: new Prisma.Decimal(0),
            mistakeBufferAmount: new Prisma.Decimal(0),
            totalCost: new Prisma.Decimal(0),
            laborMinutes: null,
            laborRate: null,
          };

      preparedLines.push({ lineIndex, lineRow, variant, product, quantity, salePrice, subtotal, costs });
      orderSubtotal = orderSubtotal.add(subtotal);
      if (costs.packagingCost.gt(orderPackagingCost)) orderPackagingCost = costs.packagingCost;
    }

    for (const preparedLine of preparedLines) {
      const { lineIndex, lineRow, variant, product, quantity, salePrice, subtotal, costs } = preparedLine;
      const packagingAllocated = orderSubtotal.gt(0)
        ? orderPackagingCost.mul(subtotal).div(orderSubtotal)
        : new Prisma.Decimal(0);
      const totalCost = costs.laborCost
        .add(costs.materialCost)
        .add(costs.equipmentCost)
        .add(costs.mistakeBufferAmount)
        .mul(quantity)
        .add(packagingAllocated);
      const netContribution = subtotal.sub(totalCost);

      const line = await prisma.orderSnapshotLine.create({
        data: {
          shopId,
          snapshotId: snapshot.id,
          shopifyLineItemId: syntheticGid("LineItem", `${order.name}:${lineIndex}:${lineRow["Lineitem name"]}`),
          shopifyVariantId: variant?.shopifyId ?? syntheticGid("UnknownVariant", lineRow["Lineitem name"]),
          variantTitle: variant?.title ?? lineRow["Lineitem name"],
          productTitle: product?.title ?? lineRow["Lineitem name"],
          quantity,
          salePrice,
          subtotal,
          laborCost: costs.laborCost.mul(quantity),
          materialCost: costs.materialCost.mul(quantity),
          packagingCost: packagingAllocated,
          equipmentCost: costs.equipmentCost.mul(quantity),
          mistakeBufferAmount: costs.mistakeBufferAmount.mul(quantity),
          totalCost,
          netContribution,
          laborMinutes: costs.laborMinutes,
          laborRate: costs.laborRate,
        },
      });

      const assignments = product ? indexes.assignmentsByProductShopifyId.get(product.shopifyId) ?? [] : [];
      for (const assignment of assignments) {
        const causeId = idMaps.causeIds.get(assignment.causeDedupeKey);
        const cause = data.causes.find((candidate) => candidate._dedupeKey === assignment.causeDedupeKey);
        if (!causeId || !cause) continue;
        const percentage = parseMoney(assignment.percentage);
        const amount = netContribution.mul(percentage).div(100);
        await prisma.lineCauseAllocation.create({
          data: {
            shopId,
            snapshotLineId: line.id,
            causeId,
            causeName: cause.name,
            is501c3: cause.is501c3 ?? false,
            percentage,
            amount,
          },
        });

        const allocationKey = `${period.id}:${causeId}`;
        const current = allocationsByPeriodCause.get(allocationKey) ?? {
          period,
          causeId,
          causeName: cause.name,
          is501c3: cause.is501c3 ?? false,
          amount: new Prisma.Decimal(0),
        };
        current.amount = current.amount.add(amount);
        allocationsByPeriodCause.set(allocationKey, current);
      }
    }
  }

  for (const allocation of allocationsByPeriodCause.values()) {
    await prisma.causeAllocation.upsert({
      where: { periodId_causeId: { periodId: allocation.period.id, causeId: allocation.causeId } },
      create: {
        shopId,
        periodId: allocation.period.id,
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        allocated: allocation.amount,
        disbursed: new Prisma.Decimal(0),
      },
      update: {
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        allocated: allocation.amount,
      },
    });
  }

  console.log(
    `Imported ${groupOrderRows(orderRows).length} orders, ${charges.length} Shopify charge rows, and ${transactions.length} payment transaction rows for ${shopId}.`,
  );
}

async function importCatalog(data, options) {
  const sourceShopId = data.meta?.shopId ?? data.products[0]?.shopId ?? data.causes[0]?.shopId;
  const shopId = options.shopId ?? sourceShopId;
  if (!shopId) throw new Error("Could not determine shopId. Pass --shop=...");

  const shopDomain = options.shopDomain ?? shopId;
  const materialIds = new Map();
  const equipmentIds = new Map();
  const causeIds = new Map();
  const productIds = new Map();
  const variantIds = new Map();
  const configIds = new Map();
  const indexes = buildCatalogIndexes(data);
  const csvAnalysis = financialAnalysis(options);

  const validation = validateExport(data, shopId);
  printAnalysis(data, shopId, validation, analyzeTemplateTrends(data, indexes), csvAnalysis);
  if (validation.errors.length > 0) {
    throw new Error(`Import validation failed with ${validation.errors.length} error(s).`);
  }
  if (options.dryRun) return;

  const shop = await prisma.shop.upsert({
    where: { shopId },
    update: {
      shopifyDomain: shopDomain,
      currency: "USD",
      catalogSynced: true,
      wizardStep: 8,
    },
    create: {
      shopId,
      shopifyDomain: shopDomain,
      currency: "USD",
      catalogSynced: true,
      wizardStep: 8,
      mistakeBuffer: DEFAULT_MISTAKE_BUFFER,
    },
  });
  const defaultLaborRate = shop.laborRate ?? DEFAULT_LABOR_RATE;
  const defaultMistakeBuffer = shop.mistakeBuffer ?? DEFAULT_MISTAKE_BUFFER;
  if (shop.mistakeBuffer === null) {
    await prisma.shop.update({
      where: { shopId },
      data: { mistakeBuffer: defaultMistakeBuffer },
    });
  }

  await prisma.wizardState.upsert({
    where: { shopId },
    update: {
      currentStep: 8,
      completedSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      skippedSteps: [],
    },
    create: {
      shopId,
      currentStep: 8,
      completedSteps: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      skippedSteps: [],
    },
  });

  if (options.replaceFinancials) {
    await replaceFinancials(shopId);
  }

  if (options.replaceCatalog) {
    await replaceCatalog(shopId);
  }

  if (options.resetOnly) {
    console.log(`Reset seed-imported catalog and financial data for ${shopId}.`);
    printShopDataCounts(shopId, await shopDataCounts(shopId));
    return;
  }

  for (const row of data.materialLibraryItems) {
    const material = await prisma.materialLibraryItem.create({
      data: {
        shopId,
        name: row.name,
        type: row.type,
        costingModel: row.costingModel,
        purchasePrice: decimal(row.purchasePrice),
        purchaseQty: decimal(row.purchaseQty),
        perUnitCost: decimal(row.perUnitCost),
        totalUsesPerUnit: decimal(row.totalUsesPerUnit),
        purchaseLink: row.purchaseLink,
        weightGrams: decimal(row.weightGrams),
        unitDescription: row.unitDescription,
        status: row.status ?? "active",
        notes: row.notes,
      },
    });
    materialIds.set(row._dedupeKey, material.id);
  }

  for (const row of data.equipmentLibraryItems) {
    const equipment = await prisma.equipmentLibraryItem.create({
      data: {
        shopId,
        name: row.name,
        hourlyRate: decimal(row.hourlyRate),
        perUseCost: decimal(row.perUseCost),
        purchaseLink: row.purchaseLink,
        equipmentCost: decimal(row.equipmentCost),
        status: row.status ?? "active",
        notes: row.notes,
      },
    });
    equipmentIds.set(row._dedupeKey, equipment.id);
  }

  for (const row of data.causes) {
    const cause = await prisma.cause.create({
      data: {
        shopId,
        shopifyMetaobjectId: row.shopifyMetaobjectId,
        name: row.name,
        legalName: row.legalName,
        is501c3: row.is501c3 ?? false,
        description: row.description,
        iconUrl: row.iconUrl,
        donationLink: row.donationLink,
        websiteUrl: row.websiteUrl,
        instagramUrl: row.instagramUrl,
        status: row.status ?? "active",
      },
    });
    causeIds.set(row._dedupeKey, cause.id);
  }

  for (const row of data.products) {
    const product = await prisma.product.upsert({
      where: { shopId_shopifyId: { shopId, shopifyId: row.shopifyId } },
      create: {
        shopId,
        shopifyId: row.shopifyId,
        title: row.title,
        handle: row.handle,
        status: normalizeProductStatus(row.status, options.normalizeProductStatus),
        syncedAt: date(row.syncedAt),
      },
      update: {
        title: row.title,
        handle: row.handle,
        status: normalizeProductStatus(row.status, options.normalizeProductStatus),
        syncedAt: date(row.syncedAt),
      },
    });
    productIds.set(row.shopifyId, product.id);
  }

  for (const row of data.variants) {
    const productId = productIds.get(row.productShopifyId);
    const variant = await prisma.variant.upsert({
      where: { shopId_shopifyId: { shopId, shopifyId: row.shopifyId } },
      create: {
        shopId,
        shopifyId: row.shopifyId,
        productId,
        title: row.title,
        sku: row.sku,
        price: decimal(row.price),
        syncedAt: date(row.syncedAt),
      },
      update: {
        productId,
        title: row.title,
        sku: row.sku,
        price: decimal(row.price),
        syncedAt: date(row.syncedAt),
      },
    });
    variantIds.set(row.shopifyId, variant.id);
  }

  for (const row of data.variantCostConfigs) {
    const variantId = variantIds.get(row.variantShopifyId);
    const config = await prisma.variantCostConfig.upsert({
      where: { variantId },
      create: {
        shopId,
        variantId,
        productionTemplateId: null,
        shippingTemplateId: null,
        laborMinutes: decimal(row.laborMinutes),
        lineItemCount: row.lineItemCount ?? 0,
      },
      update: {
        productionTemplateId: null,
        shippingTemplateId: null,
        laborMinutes: decimal(row.laborMinutes),
        lineItemCount: row.lineItemCount ?? 0,
      },
    });
    configIds.set(row.variantShopifyId, config.id);
  }

  for (const row of data.variantMaterialLines) {
    const configId = configIds.get(row.variantShopifyId);
    const materialId = materialIds.get(row.materialDedupeKey);
    if (!configId || !materialId) {
      throw new Error(`Cannot import material line ${row._dedupeKey ?? row.variantShopifyId}: missing config or material mapping.`);
    }

    await prisma.variantMaterialLine.create({
      data: {
        shopId,
        config: { connect: { id: configId } },
        material: { connect: { id: materialId } },
        yield: decimal(row.yield),
        quantity: decimal(row.quantity) ?? new Prisma.Decimal(1),
        usesPerVariant: decimal(row.usesPerVariant),
      },
    });
  }

  for (const row of data.variantEquipmentLines) {
    const configId = configIds.get(row.variantShopifyId);
    const equipmentId = equipmentIds.get(row.equipmentDedupeKey);
    if (!configId || !equipmentId) {
      throw new Error(`Cannot import equipment line ${row._dedupeKey ?? row.variantShopifyId}: missing config or equipment mapping.`);
    }

    await prisma.variantEquipmentLine.create({
      data: {
        shopId,
        config: { connect: { id: configId } },
        equipment: { connect: { id: equipmentId } },
        minutes: decimal(row.minutes),
        uses: decimal(row.uses),
      },
    });
  }

  for (const row of data.productCauseAssignments) {
    const productShopifyId = row.productShopifyId || row.shopifyProductId;
    await prisma.productCauseAssignment.upsert({
      where: {
        shopId_shopifyProductId_causeId: {
          shopId,
          shopifyProductId: row.shopifyProductId ?? productShopifyId,
          causeId: causeIds.get(row.causeDedupeKey),
        },
      },
      create: {
        shopId,
        shopifyProductId: row.shopifyProductId ?? productShopifyId,
        productId: productIds.get(productShopifyId),
        causeId: causeIds.get(row.causeDedupeKey),
        percentage: decimal(row.percentage),
      },
      update: {
        productId: productIds.get(productShopifyId),
        percentage: decimal(row.percentage),
      },
    });
  }

  await importCsvFinancials(data, shopId, options, { causeIds }, defaultMistakeBuffer, defaultLaborRate);

  console.log(`Imported catalog export for ${shopId}.`);
  printShopDataCounts(shopId, await shopDataCounts(shopId));
}

function printAnalysis(data, shopId, validation, templateTrends, csvAnalysis) {
  console.log(`Catalog import analysis for ${shopId}`);
  for (const collection of EXPECTED_COLLECTIONS) {
    console.log(`- ${collection}: ${data[collection].length}`);
  }
  console.log(`- ignored root/meta fields: meta${data.meta ? "" : " (not present)"}, _raw, _source, _dedupeKey`);
  if (csvAnalysis.orderCount || csvAnalysis.chargeCount || csvAnalysis.transactionCount) {
    console.log(`- orders CSV: ${csvAnalysis.orderCount} orders / ${csvAnalysis.orderLineCount} line rows`);
    console.log(`- charges CSV: ${csvAnalysis.chargeCount} rows`);
    console.log(`- payment transactions CSV: ${csvAnalysis.transactionCount} rows`);
    console.log("- Order costs: material, equipment, labor, and cause allocations are derived from the imported variant catalog.");
    console.log("- PII handling: customer names, emails, addresses, and phones are not persisted; payment/order internals use synthetic IDs.");
  }

  if (templateTrends) {
    const printTrend = (label, rows) => {
      const strong = rows.filter((row) => row.count >= 3).slice(0, 5);
      if (strong.length === 0) return;
      console.log(`\n${label} template candidates:`);
      for (const row of strong) {
        console.log(`- ${row.count} variants share ${row.signature.split("|").length} line(s); examples: ${row.examples.join(", ")}`);
      }
    };
    printTrend("Production", templateTrends.production);
    printTrend("Shipping", templateTrends.shipping);
  }

  if (validation.errors.length > 0) {
    console.log("\nErrors:");
    for (const error of validation.errors.slice(0, 25)) console.log(`- ${error}`);
    if (validation.errors.length > 25) console.log(`- ...and ${validation.errors.length - 25} more`);
  }

  if (validation.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of validation.warnings.slice(0, 25)) console.log(`- ${warning}`);
    if (validation.warnings.length > 25) console.log(`- ...and ${validation.warnings.length - 25} more`);
  }
}

async function main() {
  const options = parseArgs();
  const data = loadExport(options.file);
  await importCatalog(data, options);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
