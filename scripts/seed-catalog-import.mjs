import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  createOrderLineResolver,
  loadOrderLineMap,
  mergePendingOrderLineMappings,
  normalizeOrderLineText,
  saveOrderLineMap,
  summarizeOrderLineMatching,
} from "./seed-order-line-matching.mjs";

const prisma = new PrismaClient();
const DEFAULT_LABOR_RATE = new Prisma.Decimal("15");
const DEFAULT_MISTAKE_BUFFER = new Prisma.Decimal("0.1");

const EXPECTED_COLLECTIONS = [
  "materialLibraryItems",
  "equipmentLibraryItems",
  "costTemplates",
  "costTemplateMaterialLines",
  "costTemplateEquipmentLines",
  "causes",
  "products",
  "variants",
  "variantCostConfigs",
  "variantMaterialLines",
  "variantEquipmentLines",
  "productCauseAssignments",
];
const VALID_PRODUCT_STATUSES = new Set(["active", "archived", "draft"]);

function hasFinancialCsv(options) {
  return Boolean(options.ordersCsv || options.chargesCsv || options.paymentTransactionsCsv);
}

function emptyCatalogExport() {
  return Object.fromEntries(EXPECTED_COLLECTIONS.map((collection) => [collection, []]));
}

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
    orderLineMap: null,
    interactiveOrderLineMap: false,
    fuzzyOrderLineMatching: true,
    templateCandidatesReport: null,
    templateCandidateMinVariants: 3,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") result.dryRun = true;
    if (arg === "--reset-shop") result.resetShop = true;
    if (arg === "--reset-only") result.resetOnly = true;
    if (arg === "--replace-catalog") result.replaceCatalog = true;
    if (arg === "--replace-financials") result.replaceFinancials = true;
    if (arg === "--normalize-product-status") result.normalizeProductStatus = true;
    if (arg === "--interactive-order-line-map") result.interactiveOrderLineMap = true;
    if (arg === "--fuzzy-order-line-matching") result.fuzzyOrderLineMatching = true;
    if (arg === "--no-fuzzy-order-line-matching") result.fuzzyOrderLineMatching = false;
    if (arg.startsWith("--file=")) result.file = arg.slice("--file=".length).trim();
    if (arg.startsWith("--orders-csv=")) result.ordersCsv = arg.slice("--orders-csv=".length).trim();
    if (arg.startsWith("--charges-csv=")) result.chargesCsv = arg.slice("--charges-csv=".length).trim();
    if (arg.startsWith("--payment-transactions-csv=")) result.paymentTransactionsCsv = arg.slice("--payment-transactions-csv=".length).trim();
    if (arg.startsWith("--shop=")) result.shopId = arg.slice("--shop=".length).trim();
    if (arg.startsWith("--shop-domain=")) result.shopDomain = arg.slice("--shop-domain=".length).trim();
    if (arg.startsWith("--order-line-map=")) result.orderLineMap = arg.slice("--order-line-map=".length).trim();
    if (arg.startsWith("--template-candidates-report=")) {
      result.templateCandidatesReport = arg.slice("--template-candidates-report=".length).trim();
    }
    if (arg.startsWith("--template-candidate-min-variants=")) {
      const value = Number.parseInt(arg.slice("--template-candidate-min-variants=".length).trim(), 10);
      if (!Number.isFinite(value) || value < 2) {
        throw new Error("--template-candidate-min-variants must be an integer greater than or equal to 2.");
      }
      result.templateCandidateMinVariants = value;
    }
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

  if (!result.file && result.ordersCsv) {
    throw new Error("--orders-csv requires --file because historical order snapshots need catalog data for variant matching and cost derivation.");
  }

  if (!result.file && !hasFinancialCsv(result) && !result.resetOnly) {
    throw new Error("Pass --file=/path/to/catalog.json, or pass --charges-csv/--payment-transactions-csv for a financial-only import.");
  }

  if (!result.file && !result.shopId) {
    throw new Error("--shop is required when importing financial CSVs without --file.");
  }

  if (!result.orderLineMap && result.ordersCsv) {
    result.orderLineMap = join(dirname(result.ordersCsv), "order-line-map.json");
  }

  return result;
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function decimal(value) {
  if (value === null || value === undefined || value === "") return null;
  return new Prisma.Decimal(value);
}

function decimalOrZero(value) {
  return value ?? new Prisma.Decimal(0);
}

async function recomputeTaxOffsetCache(shopId) {
  const [expenseTotals, allocationTotals, snapshotTotals, adjustmentTotals, adjustedAllocationLines] = await Promise.all([
    prisma.businessExpense.aggregate({
      where: { shopId },
      _sum: { amount: true },
    }),
    prisma.lineCauseAllocation.aggregate({
      where: {
        shopId,
        is501c3: true,
      },
      _sum: { amount: true },
    }),
    prisma.orderSnapshotLine.aggregate({
      where: { shopId },
      _sum: { netContribution: true },
    }),
    prisma.adjustment.aggregate({
      where: { shopId },
      _sum: { netContribAdj: true },
    }),
    prisma.orderSnapshotLine.findMany({
      where: {
        shopId,
        causeAllocations: {
          some: {
            is501c3: true,
          },
        },
        adjustments: {
          some: {},
        },
      },
      select: {
        netContribution: true,
        adjustments: {
          select: { netContribAdj: true },
        },
        causeAllocations: {
          where: { is501c3: true },
          select: { amount: true },
        },
      },
    }),
  ]);

  const expenseTotal = decimalOrZero(expenseTotals._sum.amount);
  const allocationTotal = decimalOrZero(allocationTotals._sum.amount);
  const snapshotTotal = decimalOrZero(snapshotTotals._sum.netContribution);
  const adjustmentTotal = decimalOrZero(adjustmentTotals._sum.netContribAdj);
  const adjustedAllocationTotal = adjustedAllocationLines.reduce((sum, line) => {
    if (line.netContribution.equals(0)) return sum;

    const baseAllocations = line.causeAllocations.reduce(
      (allocationSum, allocation) => allocationSum.add(allocation.amount),
      new Prisma.Decimal(0),
    );
    const lineAdjustmentTotal = line.adjustments.reduce(
      (adjustmentSum, adjustment) => adjustmentSum.add(adjustment.netContribAdj),
      new Prisma.Decimal(0),
    );
    const ratio = lineAdjustmentTotal.div(line.netContribution);
    if (ratio.abs().greaterThan(new Prisma.Decimal(10))) return sum;

    return sum.add(baseAllocations.mul(ratio));
  }, new Prisma.Decimal(0));

  const cumulativeNetContrib = snapshotTotal.plus(adjustmentTotal);
  const deductionPool = expenseTotal.plus(allocationTotal).plus(adjustedAllocationTotal);
  const taxableExposure = cumulativeNetContrib.minus(deductionPool);
  const widgetTaxSuppressed = taxableExposure.lessThanOrEqualTo(0);

  await prisma.taxOffsetCache.upsert({
    where: { shopId },
    create: {
      shopId,
      taxableExposure,
      deductionPool,
      cumulativeNetContrib,
      widgetTaxSuppressed,
    },
    update: {
      taxableExposure,
      deductionPool,
      cumulativeNetContrib,
      widgetTaxSuppressed,
    },
  });

  return {
    taxableExposure,
    deductionPool,
    cumulativeNetContrib,
    widgetTaxSuppressed,
  };
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

function firstNonZeroMoney(row, headers) {
  for (const header of headers) {
    const amount = parseMoney(row?.[header]);
    if (!amount.equals(0)) return amount;
  }
  return new Prisma.Decimal(0);
}

function sumMoney(row, headers) {
  return headers.reduce((sum, header) => sum.add(parseMoney(row?.[header])), new Prisma.Decimal(0));
}

function orderSalesTax(order) {
  const headerTax = firstNonZeroMoney(order.header, [
    "Taxes",
    "Tax",
    "Total Tax",
    "Total tax",
    "Tax Amount",
    "Total Tax Amount",
    "Sales Tax",
  ]);
  if (!headerTax.equals(0)) return headerTax;

  return order.lines.reduce(
    (sum, line) =>
      sum.add(
        sumMoney(line, [
          "Lineitem tax",
          "Lineitem Tax",
          "Lineitem taxes",
          "Tax 1 Value",
          "Tax 2 Value",
          "Tax 3 Value",
          "Tax Value",
        ]),
      ),
    new Prisma.Decimal(0),
  );
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
  return normalizeOrderLineText(value);
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
      if (collection.startsWith("costTemplate")) {
        data[collection] = [];
      } else {
        throw new Error(`Missing expected array: ${collection}`);
      }
    }
  }
  return data;
}

function validateExport(data, targetShopId) {
  const errors = [];
  const warnings = [];

  const materialKeys = uniqueValues(data.materialLibraryItems, "_dedupeKey");
  const equipmentKeys = uniqueValues(data.equipmentLibraryItems, "_dedupeKey");
  const templateKeys = uniqueValues(data.costTemplates, "_dedupeKey");
  const templateMaterialLineKeys = uniqueValues(data.costTemplateMaterialLines, "_dedupeKey");
  const templateEquipmentLineKeys = uniqueValues(data.costTemplateEquipmentLines, "_dedupeKey");
  const causeKeys = uniqueValues(data.causes, "_dedupeKey");
  const productIds = uniqueValues(data.products, "shopifyId");
  const variantIds = uniqueValues(data.variants, "shopifyId");

  for (const [collection, key] of [
    ["materialLibraryItems", "_dedupeKey"],
    ["equipmentLibraryItems", "_dedupeKey"],
    ["costTemplates", "_dedupeKey"],
    ["costTemplateMaterialLines", "_dedupeKey"],
    ["costTemplateEquipmentLines", "_dedupeKey"],
    ["causes", "_dedupeKey"],
    ["products", "shopifyId"],
    ["variants", "shopifyId"],
  ]) {
    const duplicates = duplicateValues(data[collection], key);
    if (duplicates.length > 0) {
      errors.push(`${collection} has duplicate ${key} values: ${duplicates.slice(0, 5).join(", ")}`);
    }
  }

  for (const row of data.costTemplates) {
    if (row.defaultShippingTemplateDedupeKey && !templateKeys.has(row.defaultShippingTemplateDedupeKey)) {
      errors.push(`Cost template ${row._dedupeKey} references missing default shipping template ${row.defaultShippingTemplateDedupeKey}`);
    }
  }

  for (const row of data.costTemplateMaterialLines) {
    if (!templateKeys.has(row.templateDedupeKey)) {
      errors.push(`Template material line ${row._dedupeKey} references missing template ${row.templateDedupeKey}`);
    }
    if (!materialKeys.has(row.materialDedupeKey)) {
      errors.push(`Template material line ${row._dedupeKey} references missing material ${row.materialDedupeKey}`);
    }
  }

  for (const row of data.costTemplateEquipmentLines) {
    if (!templateKeys.has(row.templateDedupeKey)) {
      errors.push(`Template equipment line ${row._dedupeKey} references missing template ${row.templateDedupeKey}`);
    }
    if (!equipmentKeys.has(row.equipmentDedupeKey)) {
      errors.push(`Template equipment line ${row._dedupeKey} references missing equipment ${row.equipmentDedupeKey}`);
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
    const productionTemplateKey = row.productionTemplateDedupeKey ?? row.productionTemplateId;
    const shippingTemplateKey = row.shippingTemplateDedupeKey ?? row.shippingTemplateId;
    if (productionTemplateKey && !templateKeys.has(productionTemplateKey)) {
      warnings.push(`Variant ${row.variantShopifyId} references missing production template ${productionTemplateKey}; the assignment will be skipped.`);
    }
    if (shippingTemplateKey && !templateKeys.has(shippingTemplateKey)) {
      warnings.push(`Variant ${row.variantShopifyId} references missing shipping template ${shippingTemplateKey}; the assignment will be skipped.`);
    }
  }

  for (const row of data.variantMaterialLines) {
    if (!variantIds.has(row.variantShopifyId)) {
      errors.push(`Material line ${row._dedupeKey} references missing variant ${row.variantShopifyId}`);
    }
    if (!materialKeys.has(row.materialDedupeKey)) {
      errors.push(`Material line ${row._dedupeKey} references missing material ${row.materialDedupeKey}`);
    }
    const templateLineKey = row.templateLineDedupeKey ?? row.templateLineId;
    if (templateLineKey && !templateMaterialLineKeys.has(templateLineKey)) {
      warnings.push(`Material line ${row._dedupeKey} references missing template material line ${templateLineKey}; the override link will be skipped.`);
    }
  }

  for (const row of data.variantEquipmentLines) {
    if (!variantIds.has(row.variantShopifyId)) {
      errors.push(`Equipment line ${row._dedupeKey} references missing variant ${row.variantShopifyId}`);
    }
    if (!equipmentKeys.has(row.equipmentDedupeKey)) {
      errors.push(`Equipment line ${row._dedupeKey} references missing equipment ${row.equipmentDedupeKey}`);
    }
    const templateLineKey = row.templateLineDedupeKey ?? row.templateLineId;
    if (templateLineKey && !templateEquipmentLineKeys.has(templateLineKey)) {
      warnings.push(`Equipment line ${row._dedupeKey} references missing template equipment line ${templateLineKey}; the override link will be skipped.`);
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
    prisma.shippingPackageMaterialLine.deleteMany({ where: { shopId } }),
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
    prisma.shippingPackage.deleteMany({ where: { shopId } }),
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
    prisma.packagingReviewItem.deleteMany({ where: { shopId } }),
    prisma.orderPackageAllocation.deleteMany({ where: { shopId } }),
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
  let shippingMaterialCost = new Prisma.Decimal(0);
  const resolvedMaterialLines = [];
  const resolvedEquipmentLines = [];

  for (const line of materialLines) {
    const material = indexes.materialsByDedupeKey.get(line.materialDedupeKey);
    if (!material) continue;
    const lineCost = materialLineCost(line, material);
    resolvedMaterialLines.push({
      materialDedupeKey: line.materialDedupeKey,
      materialName: material.name,
      materialType: material.type,
      costingModel: material.costingModel,
      purchasePrice: parseMoney(material.purchasePrice),
      purchaseQty: parseMoney(material.purchaseQty || 1),
      perUnitCost: parseMoney(material.perUnitCost),
      yield_: decimal(line.yield),
      usesPerVariant: decimal(line.usesPerVariant),
      quantity: decimal(line.quantity) ?? new Prisma.Decimal(1),
      lineCost,
    });
    if (material.type === "shipping") {
      shippingMaterialCost = shippingMaterialCost.add(lineCost);
    } else {
      materialCost = materialCost.add(lineCost);
    }
  }
  packagingCost = shippingMaterialCost;

  for (const line of equipmentLines) {
    const equipment = indexes.equipmentByDedupeKey.get(line.equipmentDedupeKey);
    if (!equipment) continue;
    const lineCost = equipmentLineCost(line, equipment);
    resolvedEquipmentLines.push({
      equipmentDedupeKey: line.equipmentDedupeKey,
      equipmentName: equipment.name,
      hourlyRate: decimal(equipment.hourlyRate),
      perUseCost: decimal(equipment.perUseCost),
      minutes: decimal(line.minutes),
      uses: decimal(line.uses),
      lineCost,
    });
    equipmentCost = equipmentCost.add(lineCost);
  }

  const laborMinutes = decimal(config?.laborMinutes);
  const laborRate = decimal(defaultLaborRate);
  const laborCost = laborMinutes && laborRate ? laborRate.mul(laborMinutes).div(60) : new Prisma.Decimal(0);
  const mistakeBufferAmount = materialCost.mul(defaultMistakeBuffer);
  const totalCost = materialCost.add(packagingCost).add(equipmentCost).add(laborCost).add(mistakeBufferAmount);

  return {
    materialCost,
    packagingCost,
    equipmentCost,
    laborCost,
    mistakeBufferAmount,
    totalCost,
    laborMinutes,
    laborRate,
    materialLines: resolvedMaterialLines,
    equipmentLines: resolvedEquipmentLines,
  };
}

async function createImportedPackageProfiles(shopId, data, materialIds, configIds) {
  const packageBySignature = new Map();
  let packageIndex = 1;

  for (const configRow of data.variantCostConfigs) {
    const configId = configIds.get(configRow.variantShopifyId);
    if (!configId) continue;

    const shippingLines = data.variantMaterialLines
      .filter((line) => line.variantShopifyId === configRow.variantShopifyId)
      .map((line) => {
        const material = data.materialLibraryItems.find((candidate) => candidate._dedupeKey === line.materialDedupeKey);
        return material?.type === "shipping" ? { line, material } : null;
      })
      .filter(Boolean);

    if (shippingLines.length === 0) continue;

    const signature = shippingLines
      .map(({ line }) => `${line.materialDedupeKey}:${line.quantity ?? "1"}`)
      .sort()
      .join("|");

    let packageId = packageBySignature.get(signature);
    if (!packageId) {
      const pkg = await prisma.shippingPackage.create({
        data: {
          shopId,
          name: `Imported package ${packageIndex}`,
          length: new Prisma.Decimal(12),
          width: new Prisma.Decimal(9),
          height: new Prisma.Decimal(1),
          source: "csv_import",
          notes: "Created from imported variant shipping material lines. Review dimensions before relying on cartonization.",
        },
      });
      packageIndex += 1;
      packageId = pkg.id;
      packageBySignature.set(signature, packageId);

      for (const { line } of shippingLines) {
        const materialId = materialIds.get(line.materialDedupeKey);
        if (!materialId) continue;
        await prisma.shippingPackageMaterialLine.upsert({
          where: { packageId_materialId: { packageId, materialId } },
          create: {
            shopId,
            packageId,
            materialId,
            quantity: decimal(line.quantity) ?? new Prisma.Decimal(1),
          },
          update: {
            quantity: decimal(line.quantity) ?? new Prisma.Decimal(1),
          },
        });
      }
    }

    await prisma.variantCostConfig.updateMany({
      where: { id: configId, shopId },
      data: {
        preferredPackageId: packageId,
        packedLength: new Prisma.Decimal(1),
        packedWidth: new Prisma.Decimal(1),
        packedHeight: new Prisma.Decimal(1),
        canSharePackage: true,
      },
    });
  }
}

function materialTemplatePart(line, material) {
  return {
    kind: "material",
    key: `material:${material._dedupeKey}:${line.quantity ?? ""}:${line.yield ?? ""}:${line.usesPerVariant ?? ""}`,
    materialDedupeKey: material._dedupeKey,
    name: material.name,
    materialType: material.type,
    costingModel: material.costingModel,
    quantity: displayValue(line.quantity),
    yield: displayValue(line.yield),
    usesPerVariant: displayValue(line.usesPerVariant),
  };
}

function equipmentTemplatePart(line, equipment) {
  return {
    kind: "equipment",
    key: `equipment:${equipment._dedupeKey}:${line.minutes ?? ""}:${line.uses ?? ""}`,
    equipmentDedupeKey: equipment._dedupeKey,
    name: equipment.name,
    minutes: displayValue(line.minutes),
    uses: displayValue(line.uses),
  };
}

function variantExample(variant, indexes) {
  const product = indexes.productsByShopifyId.get(variant.productShopifyId);
  return {
    productTitle: product?.title ?? null,
    productHandle: product?.handle ?? null,
    variantTitle: variant.title ?? null,
    sku: variant.sku ?? null,
    shopifyId: variant.shopifyId,
  };
}

function formatVariantExample(example) {
  const product = example.productTitle ?? "Unknown product";
  const variant = example.variantTitle && !["default title", "none"].includes(example.variantTitle.toLowerCase())
    ? ` - ${example.variantTitle}`
    : "";
  const sku = example.sku ? ` (${example.sku})` : "";
  return `${product}${variant}${sku}`;
}

function describeTemplatePart(line) {
  if (line.kind === "material") {
    const details = [
      `type=${line.materialType}`,
      `model=${line.costingModel}`,
      line.quantity ? `quantity=${line.quantity}` : null,
      line.yield ? `yield=${line.yield}` : null,
      line.usesPerVariant ? `usesPerVariant=${line.usesPerVariant}` : null,
    ].filter(Boolean);
    return `material: ${line.name} (${details.join(", ")})`;
  }

  const details = [
    line.minutes ? `minutes=${line.minutes}` : null,
    line.uses ? `uses=${line.uses}` : null,
  ].filter(Boolean);
  return `equipment: ${line.name}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
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
      const part = materialTemplatePart(line, material);
      if (material.type === "shipping") shippingParts.push(part);
      else productionParts.push(part);
    }

    for (const line of equipmentLines) {
      const equipment = indexes.equipmentByDedupeKey.get(line.equipmentDedupeKey);
      if (!equipment) continue;
      productionParts.push(equipmentTemplatePart(line, equipment));
    }

    for (const [map, parts] of [
      [productionPatterns, productionParts],
      [shippingPatterns, shippingParts],
    ]) {
      const sortedParts = parts.sort((left, right) => left.key.localeCompare(right.key));
      const signature = sortedParts.map((part) => part.key).join("|");
      if (!signature) continue;
      const current = map.get(signature) ?? {
        count: 0,
        examples: [],
        lines: sortedParts.map(({ key, ...part }) => part),
      };
      current.count += 1;
      if (current.examples.length < 5) current.examples.push(variantExample(variant, indexes));
      map.set(signature, current);
    }
  }

  const sortPatterns = (patterns) =>
    Array.from(patterns.entries())
      .map(([signature, value], index) => ({
        signature,
        suggestedName: `Imported Template Candidate ${index + 1}`,
        lineCount: value.lines.length,
        ...value,
      }))
      .sort((left, right) => right.count - left.count);

  const trends = {
    production: sortPatterns(productionPatterns),
    shipping: sortPatterns(shippingPatterns),
  };

  for (const [type, rows] of Object.entries(trends)) {
    rows.forEach((row, index) => {
      row.suggestedName = `Imported ${type === "production" ? "Production" : "Shipping"} Template ${index + 1}`;
    });
  }

  return trends;
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

function isCanceledOrder(order) {
  return Boolean(order.header?.["Cancelled at"]?.trim());
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

async function analyzeOrderLineMatching(data, options) {
  const orderRows = parseCsvFile(options.ordersCsv);
  if (orderRows.length === 0) return;

  const indexes = buildCatalogIndexes(data);
  const resolver = createOrderLineResolver({
    indexes,
    orderLineMap: loadOrderLineMap(options.orderLineMap),
    fuzzyEnabled: options.fuzzyOrderLineMatching,
    interactive: options.interactiveOrderLineMap,
  });

  try {
    for (const order of groupOrderRows(orderRows)) {
      if (!order.header || isCanceledOrder(order)) continue;
      for (const lineRow of order.lines) {
        if (normalizeText(lineRow["Lineitem name"]) === "tip") continue;
        await resolver.resolve(lineRow["Lineitem name"], {
          quantity: parseInteger(lineRow["Lineitem quantity"], 1),
        });
      }
    }
  } finally {
    await resolver.close();
  }

  console.log("\nOrder line catalog matching:");
  for (const line of summarizeOrderLineMatching(resolver.stats)) {
    console.log(line);
  }
  if (resolver.pendingMappings.size > 0) {
    console.log(
      `- ${resolver.pendingMappings.size} mapping(s) would be saved to ${options.orderLineMap} during a non-dry run.`,
    );
  }
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

  const hasOrderRows = orderRows.length > 0;
  const indexes = hasOrderRows ? buildCatalogIndexes(data) : null;
  const orderLineMap = hasOrderRows ? loadOrderLineMap(options.orderLineMap) : null;
  const orderLineResolver = hasOrderRows
    ? createOrderLineResolver({
        indexes,
        orderLineMap,
        fuzzyEnabled: options.fuzzyOrderLineMatching,
        interactive: options.interactiveOrderLineMap,
      })
    : null;
  const periodsByMonth = new Map();
  const allocationsByPeriodCause = new Map();
  const transactionsByOrder = new Map();
  let importedOrderCount = 0;
  let skippedCanceledOrderCount = 0;

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
    const shopifyOrderId = syntheticGid("Order", order.header.Id || order.name);

    if (isCanceledOrder(order)) {
      skippedCanceledOrderCount += 1;
      await prisma.orderSnapshot.deleteMany({
        where: {
          shopId,
          shopifyOrderId,
          origin: "csv_import",
        },
      });
      continue;
    }

    const period = await ensurePeriod(periodsByMonth, shopId, periodKeyForOrder(order, transactionsByOrder));
    const createdAt = date(order.header["Created at"]);
    const salesTaxCollected = orderSalesTax(order);
    const snapshot = await prisma.orderSnapshot.upsert({
      where: { shopId_shopifyOrderId: { shopId, shopifyOrderId } },
      create: {
        shopId,
        shopifyOrderId,
        orderNumber: order.name,
        origin: "csv_import",
        salesTaxCollected,
        createdAt,
        periodId: period.id,
      },
      update: {
        orderNumber: order.name,
        origin: "csv_import",
        salesTaxCollected,
        createdAt,
        periodId: period.id,
      },
    });

	    await prisma.lineCauseAllocation.deleteMany({ where: { snapshotLine: { snapshotId: snapshot.id } } });
	    await prisma.packagingReviewItem.deleteMany({ where: { snapshotId: snapshot.id } });
	    await prisma.orderPackageAllocation.deleteMany({ where: { snapshotId: snapshot.id } });
	    await prisma.orderSnapshotLine.deleteMany({ where: { snapshotId: snapshot.id } });

    const lineDiscounts = buildOrderLineDiscounts(order);
    const preparedLines = [];
    let orderSubtotal = new Prisma.Decimal(0);
    let orderPackagingCost = new Prisma.Decimal(0);

	    for (let lineIndex = 0; lineIndex < order.lines.length; lineIndex += 1) {
      const lineRow = order.lines[lineIndex];
      if (normalizeText(lineRow["Lineitem name"]) === "tip") continue;
      const variant = await orderLineResolver.resolve(lineRow["Lineitem name"], {
        quantity: parseInteger(lineRow["Lineitem quantity"], 1),
      });
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
            materialLines: [],
            equipmentLines: [],
          };

      preparedLines.push({ lineIndex, lineRow, variant, product, quantity, salePrice, subtotal, costs });
      orderSubtotal = orderSubtotal.add(subtotal);
	      if (costs.packagingCost.gt(orderPackagingCost)) orderPackagingCost = costs.packagingCost;
	    }

	    const packageConfig = await prisma.variantCostConfig.findFirst({
	      where: {
	        shopId,
	        variantId: {
	          in: preparedLines.map((line) => line.variant?.id).filter(Boolean),
	        },
	        preferredPackageId: { not: null },
	      },
	      include: { preferredPackage: true },
	    });
	    if (packageConfig?.preferredPackage && orderPackagingCost.gt(0)) {
	      await prisma.orderPackageAllocation.create({
	        data: {
	          shopId,
	          snapshotId: snapshot.id,
	          packageId: packageConfig.preferredPackage.id,
	          packageName: packageConfig.preferredPackage.name,
	          quantity: 1,
	          materialCost: orderPackagingCost,
	          source: "csv_import",
	          confidence: "low",
	          reason: "Imported from historical shipping-material estimate.",
	          allocationSignature: `${snapshot.id}:csv-import-package`,
	        },
	      });
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

      if (costs.materialLines.length > 0) {
        const materialRows = costs.materialLines.map((materialLine) => {
          const isShipping = materialLine.materialType === "shipping";
          const allocatedShippingCost =
            isShipping && costs.packagingCost.gt(0)
              ? materialLine.lineCost.div(costs.packagingCost).mul(packagingAllocated)
              : new Prisma.Decimal(0);
          return {
            snapshotLineId: line.id,
            materialId: idMaps.materialIds.get(materialLine.materialDedupeKey) ?? null,
            materialName: materialLine.materialName,
            materialType: materialLine.materialType,
            costingModel: materialLine.costingModel,
            purchasePrice: materialLine.purchasePrice,
            purchaseQty: materialLine.purchaseQty,
            perUnitCost: materialLine.perUnitCost,
            yield_: materialLine.yield_,
            usesPerVariant: materialLine.usesPerVariant ? materialLine.usesPerVariant.mul(quantity) : null,
            quantity: isShipping ? materialLine.quantity : materialLine.quantity.mul(quantity),
            lineCost: isShipping ? allocatedShippingCost : materialLine.lineCost.mul(quantity),
          };
        });

        await prisma.orderSnapshotMaterialLine.createMany({ data: materialRows });
      }

      if (costs.equipmentLines.length > 0) {
        await prisma.orderSnapshotEquipmentLine.createMany({
          data: costs.equipmentLines.map((equipmentLine) => ({
            snapshotLineId: line.id,
            equipmentId: idMaps.equipmentIds.get(equipmentLine.equipmentDedupeKey) ?? null,
            equipmentName: equipmentLine.equipmentName,
            hourlyRate: equipmentLine.hourlyRate,
            perUseCost: equipmentLine.perUseCost,
            minutes: equipmentLine.minutes ? equipmentLine.minutes.mul(quantity) : null,
            uses: equipmentLine.uses ? equipmentLine.uses.mul(quantity) : null,
            lineCost: equipmentLine.lineCost.mul(quantity),
          })),
        });
      }

      const assignments = product ? indexes.assignmentsByProductShopifyId.get(product.shopifyId) ?? [] : [];
      for (const assignment of assignments) {
        const causeId = idMaps.causeIds.get(assignment.causeDedupeKey);
        const cause = data.causes.find((candidate) => candidate._dedupeKey === assignment.causeDedupeKey);
        if (!causeId || !cause) continue;
        const percentage = parseMoney(assignment.percentage);
        const allocationBase = Prisma.Decimal.max(netContribution, new Prisma.Decimal(0));
        const amount = allocationBase.mul(percentage).div(100);
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
    importedOrderCount += 1;
  }

  if (orderLineResolver) {
    await orderLineResolver.close();
  }

  const touchedPeriodIds = new Set(Array.from(periodsByMonth.values()).map((period) => period.id));
  for (const existingAllocation of await prisma.causeAllocation.findMany({
    where: {
      shopId,
      periodId: { in: Array.from(touchedPeriodIds) },
    },
    select: {
      id: true,
      periodId: true,
      causeId: true,
    },
  })) {
    if (!allocationsByPeriodCause.has(`${existingAllocation.periodId}:${existingAllocation.causeId}`)) {
      await prisma.causeAllocation.delete({ where: { id: existingAllocation.id } });
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

  const taxOffsetSummary = await recomputeTaxOffsetCache(shopId);

  console.log(
    `Imported ${importedOrderCount} orders, skipped ${skippedCanceledOrderCount} canceled orders, ${charges.length} Shopify charge rows, and ${transactions.length} payment transaction rows for ${shopId}.`,
  );
  console.log(
    `Tax offset cache: deduction pool ${taxOffsetSummary.deductionPool.toFixed(2)}, cumulative net contribution ${taxOffsetSummary.cumulativeNetContrib.toFixed(2)}, taxable exposure ${taxOffsetSummary.taxableExposure.toFixed(2)}, widget tax reserve ${taxOffsetSummary.widgetTaxSuppressed ? "suppressed" : "enabled"}.`,
  );
  if (orderLineResolver) {
    console.log("\nOrder line catalog matching:");
    for (const line of summarizeOrderLineMatching(orderLineResolver.stats)) {
      console.log(line);
    }
    if (orderLineResolver.pendingMappings.size > 0) {
      const nextOrderLineMap = mergePendingOrderLineMappings(orderLineMap, orderLineResolver.pendingMappings);
      saveOrderLineMap(options.orderLineMap, nextOrderLineMap);
      console.log(`Saved ${orderLineResolver.pendingMappings.size} order line mapping(s) to ${options.orderLineMap}.`);
    }
  }
}

async function importCatalog(data, options) {
  const sourceShopId = data.meta?.shopId ?? data.products[0]?.shopId ?? data.causes[0]?.shopId;
  const shopId = options.shopId ?? sourceShopId;
  if (!shopId) throw new Error("Could not determine shopId. Pass --shop=...");

  const shopDomain = options.shopDomain ?? shopId;
  const materialIds = new Map();
  const equipmentIds = new Map();
  const templateIds = new Map();
  const templateMaterialLineIds = new Map();
  const templateEquipmentLineIds = new Map();
  const causeIds = new Map();
  const productIds = new Map();
  const variantIds = new Map();
  const configIds = new Map();
  const indexes = buildCatalogIndexes(data);
  const csvAnalysis = financialAnalysis(options);

  const validation = validateExport(data, shopId);
  const templateTrends = analyzeTemplateTrends(data, indexes);
  printAnalysis(data, shopId, validation, templateTrends, csvAnalysis, options);
  if (options.templateCandidatesReport) {
    writeTemplateCandidateReport(options.templateCandidatesReport, shopId, templateTrends, options);
  }
  if (validation.errors.length > 0) {
    throw new Error(`Import validation failed with ${validation.errors.length} error(s).`);
  }
  if (options.dryRun) {
    await analyzeOrderLineMatching(data, options);
    return;
  }

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
      defaultLaborRate: DEFAULT_LABOR_RATE,
    },
  });
  const defaultLaborRate = shop.defaultLaborRate ?? DEFAULT_LABOR_RATE;
  const defaultMistakeBuffer = shop.mistakeBuffer ?? DEFAULT_MISTAKE_BUFFER;
  if (shop.mistakeBuffer === null || shop.defaultLaborRate === null) {
    await prisma.shop.update({
      where: { shopId },
      data: {
        mistakeBuffer: defaultMistakeBuffer,
        defaultLaborRate,
      },
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

  for (const row of data.costTemplates) {
    const template = await prisma.costTemplate.create({
      data: {
        shopId,
        name: row.name,
        type: row.type ?? "production",
        defaultShippingTemplateId: null,
        description: row.description,
        status: row.status ?? "active",
      },
    });
    templateIds.set(row._dedupeKey, template.id);
  }

  for (const row of data.costTemplates) {
    const templateId = templateIds.get(row._dedupeKey);
    const defaultShippingTemplateId = row.defaultShippingTemplateDedupeKey
      ? templateIds.get(row.defaultShippingTemplateDedupeKey)
      : null;
    if (templateId && defaultShippingTemplateId) {
      await prisma.costTemplate.update({
        where: { id: templateId },
        data: { defaultShippingTemplateId },
      });
    }
  }

  for (const row of data.costTemplateMaterialLines) {
    const templateId = templateIds.get(row.templateDedupeKey);
    const materialId = materialIds.get(row.materialDedupeKey);
    if (!templateId || !materialId) {
      throw new Error(`Cannot import template material line ${row._dedupeKey}: missing template or material mapping.`);
    }

    const line = await prisma.costTemplateMaterialLine.create({
      data: {
        template: { connect: { id: templateId } },
        material: { connect: { id: materialId } },
        yield: decimal(row.yield),
        quantity: decimal(row.quantity) ?? new Prisma.Decimal(1),
        usesPerVariant: decimal(row.usesPerVariant),
      },
    });
    templateMaterialLineIds.set(row._dedupeKey, line.id);
  }

  for (const row of data.costTemplateEquipmentLines) {
    const templateId = templateIds.get(row.templateDedupeKey);
    const equipmentId = equipmentIds.get(row.equipmentDedupeKey);
    if (!templateId || !equipmentId) {
      throw new Error(`Cannot import template equipment line ${row._dedupeKey}: missing template or equipment mapping.`);
    }

    const line = await prisma.costTemplateEquipmentLine.create({
      data: {
        template: { connect: { id: templateId } },
        equipment: { connect: { id: equipmentId } },
        minutes: decimal(row.minutes),
        uses: decimal(row.uses),
      },
    });
    templateEquipmentLineIds.set(row._dedupeKey, line.id);
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
    const productionTemplateId = templateIds.get(row.productionTemplateDedupeKey ?? row.productionTemplateId) ?? null;
    const shippingTemplateId = templateIds.get(row.shippingTemplateDedupeKey ?? row.shippingTemplateId) ?? null;
    const config = await prisma.variantCostConfig.upsert({
      where: { variantId },
      create: {
        shopId,
        variantId,
        productionTemplateId,
        shippingTemplateId,
        laborMinutes: decimal(row.laborMinutes),
        laborRate: null,
        mistakeBuffer: null,
        lineItemCount: row.lineItemCount ?? 0,
      },
      update: {
        productionTemplateId,
        shippingTemplateId,
        laborMinutes: decimal(row.laborMinutes),
        laborRate: null,
        mistakeBuffer: null,
        lineItemCount: row.lineItemCount ?? 0,
      },
    });
    configIds.set(row.variantShopifyId, config.id);
  }

  for (const row of data.variantMaterialLines) {
    const configId = configIds.get(row.variantShopifyId);
    const materialId = materialIds.get(row.materialDedupeKey);
    const templateLineId = templateMaterialLineIds.get(row.templateLineDedupeKey ?? row.templateLineId) ?? null;
    if (!configId || !materialId) {
      throw new Error(`Cannot import material line ${row._dedupeKey ?? row.variantShopifyId}: missing config or material mapping.`);
    }

    await prisma.variantMaterialLine.create({
      data: {
        shopId,
        config: { connect: { id: configId } },
        material: { connect: { id: materialId } },
        ...(templateLineId ? { templateLine: { connect: { id: templateLineId } } } : {}),
        yield: decimal(row.yield),
        quantity: decimal(row.quantity) ?? new Prisma.Decimal(1),
        usesPerVariant: decimal(row.usesPerVariant),
      },
    });
  }

  for (const row of data.variantEquipmentLines) {
    const configId = configIds.get(row.variantShopifyId);
    const equipmentId = equipmentIds.get(row.equipmentDedupeKey);
    const templateLineId = templateEquipmentLineIds.get(row.templateLineDedupeKey ?? row.templateLineId) ?? null;
    if (!configId || !equipmentId) {
      throw new Error(`Cannot import equipment line ${row._dedupeKey ?? row.variantShopifyId}: missing config or equipment mapping.`);
    }

    await prisma.variantEquipmentLine.create({
      data: {
        shopId,
        config: { connect: { id: configId } },
        equipment: { connect: { id: equipmentId } },
        ...(templateLineId ? { templateLine: { connect: { id: templateLineId } } } : {}),
        minutes: decimal(row.minutes),
        uses: decimal(row.uses),
      },
    });
  }

  await createImportedPackageProfiles(shopId, data, materialIds, configIds);

  for (const row of data.productCauseAssignments) {
    const productShopifyId = row.productShopifyId || row.shopifyProductId;
    const productId = productIds.get(productShopifyId);
    const causeId = causeIds.get(row.causeDedupeKey);
    if (!productId || !causeId) {
      throw new Error(`Cannot import product cause assignment ${productShopifyId}: missing product or cause mapping.`);
    }

    await prisma.productCauseAssignment.deleteMany({
      where: {
        shopId,
        causeId,
        OR: [
          { productId },
          { shopifyProductId: row.shopifyProductId ?? productShopifyId },
        ],
      },
    });
    await prisma.productCauseAssignment.create({
      data: {
        shopId,
        shopifyProductId: row.shopifyProductId ?? productShopifyId,
        productId,
        causeId,
        percentage: decimal(row.percentage),
      },
    });
  }

  await importCsvFinancials(
    data,
    shopId,
    options,
    { causeIds, materialIds, equipmentIds },
    defaultMistakeBuffer,
    defaultLaborRate,
  );

  console.log(`Imported catalog export for ${shopId}.`);
  printShopDataCounts(shopId, await shopDataCounts(shopId));
}

function reportableTemplateCandidates(templateTrends, minVariants) {
  return {
    production: templateTrends.production.filter((row) => row.count >= minVariants),
    shipping: templateTrends.shipping.filter((row) => row.count >= minVariants),
  };
}

function writeTemplateCandidateReport(file, shopId, templateTrends, options) {
  const candidates = reportableTemplateCandidates(templateTrends, options.templateCandidateMinVariants);
  const payload = {
    shopId,
    generatedAt: new Date().toISOString(),
    minVariants: options.templateCandidateMinVariants,
    note: "Analysis-only template candidates derived from repeated variant material/equipment line patterns. Review before creating or assigning templates.",
    candidates,
  };

  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`\nWrote template candidate report to ${file}.`);
}

function printAnalysis(data, shopId, validation, templateTrends, csvAnalysis, options) {
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
    const minVariants = options.templateCandidateMinVariants;
    const printTrend = (label, rows) => {
      const strong = rows.filter((row) => row.count >= minVariants).slice(0, 5);
      if (strong.length === 0) return;
      console.log(`\n${label} template candidates:`);
      for (const row of strong) {
        console.log(`- ${row.suggestedName}: ${row.count} variants share ${row.lineCount} line(s)`);
        for (const line of row.lines) {
          console.log(`  - ${describeTemplatePart(line)}`);
        }
        console.log(`  examples: ${row.examples.map(formatVariantExample).join("; ")}`);
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

async function importStandaloneFinancialCsv(options) {
  const shopId = options.shopId;
  const shopDomain = options.shopDomain ?? shopId;
  const csvAnalysis = financialAnalysis(options);

  console.log(`Financial CSV import analysis for ${shopId}`);
  console.log(`- charges CSV: ${csvAnalysis.chargeCount} rows`);
  console.log(`- payment transactions CSV: ${csvAnalysis.transactionCount} rows`);
  console.log("- Historical order CSV import is skipped in file-less mode; pass --file with --orders-csv to import snapshots.");

  if (csvAnalysis.chargeCount === 0 && csvAnalysis.transactionCount === 0) {
    console.log("- no financial rows found");
    return;
  }

  if (options.dryRun) {
    return;
  }

  await prisma.shop.upsert({
    where: { shopId },
    update: {
      shopifyDomain: shopDomain,
      currency: "USD",
    },
    create: {
      shopId,
      shopifyDomain: shopDomain,
      currency: "USD",
      mistakeBuffer: DEFAULT_MISTAKE_BUFFER,
      defaultLaborRate: DEFAULT_LABOR_RATE,
    },
  });

  if (options.replaceFinancials) {
    await replaceFinancials(shopId);
  }

  await importCsvFinancials(
    emptyCatalogExport(),
    shopId,
    options,
    {
      causeIds: new Map(),
      materialIds: new Map(),
      equipmentIds: new Map(),
    },
    DEFAULT_MISTAKE_BUFFER,
    DEFAULT_LABOR_RATE,
  );

  printShopDataCounts(shopId, await shopDataCounts(shopId));
}

async function main() {
  const options = parseArgs();
  if (!options.file) {
    await importStandaloneFinancialCsv(options);
    return;
  }

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
