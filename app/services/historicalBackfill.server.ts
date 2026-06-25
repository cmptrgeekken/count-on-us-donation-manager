import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { createSnapshot, type ShopifyOrderPayload } from "./snapshotService.server";
import {
  materializeArtistAllocationsForPeriod,
  materializeCauseAllocationsForPeriod,
} from "./reportingPeriodService.server";

type DbClient = typeof prisma;

type ImportKind = "payouts" | "charges" | "orders";
type CsvRow = Record<string, string>;

type PayoutImportRow = {
  id?: string | number | null;
  shopifyPayoutId?: string | number | null;
  startDate?: string | null;
  periodStart?: string | null;
  endDate?: string | null;
  periodEnd?: string | null;
  source?: string | null;
};

type ChargeImportRow = {
  id?: string | number | null;
  shopifyTransactionId?: string | number | null;
  shopifyPayoutId?: string | number | null;
  payoutId?: string | number | null;
  transactionType?: string | null;
  description?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  processedAt?: string | null;
};

type ImportIssue = {
  row: number;
  message: string;
};

type VariantMappingCandidate = {
  shopifyVariantId: string;
  label: string;
  matchReason: string;
};

type LineMappingRequest = {
  key: string;
  title: string;
  variantTitle: string;
  sku: string | null;
  reason: "unresolved" | "ambiguous";
  candidates: VariantMappingCandidate[];
};

type ResolvedImportVariant = {
  id: string;
  shopifyId: string;
  title?: string;
  product: {
    shopifyId: string;
    title?: string;
  };
};

type ImportSummary = {
  kind: ImportKind | "rebuild";
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  warnings: ImportIssue[];
  errors: ImportIssue[];
  lineMappingRequests?: LineMappingRequest[];
};

const ZERO_SUMMARY = {
  totalRows: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  warnings: [] as ImportIssue[],
  errors: [] as ImportIssue[],
};

function parseDate(value: string | null | undefined, label: string) {
  if (!value) throw new Error(`${label} is required.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed;
}

function optionalDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeId(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  return value.toString().trim();
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function lineMappingKey(input: { title?: string | null; variantTitle?: string | null; sku?: string | null }) {
  return [
    normalizeText(input.title),
    normalizeText(input.variantTitle),
    normalizeText(input.sku),
  ].join("|");
}

function normalizeCsvHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function getCsvValue(row: CsvRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[normalizeCsvHeader(key)];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return "";
}

function variantCandidateLabel(variant: { title?: string; product: { title?: string } }) {
  return `${variant.product.title ?? "Unknown product"} - ${variant.title ?? "Default Title"}`;
}

function parseCsvRows(input: string): CsvRow[] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const nextCharacter = input[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") index += 1;
      row.push(current);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += character;
  }

  row.push(current);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);

  const [headers, ...dataRows] = rows;
  if (!headers || headers.length === 0) {
    throw new Error("CSV import payload must include a header row.");
  }

  const normalizedHeaders = headers.map(normalizeCsvHeader);
  return dataRows.map((dataRow) =>
    normalizedHeaders.reduce<CsvRow>((record, header, index) => {
      record[header] = dataRow[index]?.trim() ?? "";
      return record;
    }, {}),
  );
}

function parseJsonArray(input: string) {
  const parsed = JSON.parse(input);
  if (!Array.isArray(parsed)) {
    throw new Error("Import payload must be a JSON array.");
  }
  return parsed as unknown[];
}

function parseShopifyChargesCsv(rows: CsvRow[]): ChargeImportRow[] {
  return rows.map((row, index) => {
    const order = getCsvValue(row, "Order");
    const category = getCsvValue(row, "Charge category");
    const description = getCsvValue(row, "Description") || "Historical Shopify charge";
    const amount = getCsvValue(row, "Amount", "Original amount");
    const date = getCsvValue(row, "Date", "Start of billing cycle", "End of billing cycle");

    return {
      shopifyTransactionId: getCsvValue(row, "Bill #") || `charges-csv:${order || "no-order"}:${category}:${description}:${amount}:${index + 1}`,
      transactionType: category,
      description: order ? `${description} (${order})` : description,
      amount,
      currency: getCsvValue(row, "Currency", "Original currency") || "USD",
      processedAt: date || null,
    };
  });
}

function parseShopifyPaymentTransactionsCsv(rows: CsvRow[]): PayoutImportRow[] {
  const grouped = new Map<string, Date[]>();

  for (const row of rows) {
    const payoutId = getCsvValue(row, "Payout ID");
    if (!payoutId) continue;

    const transactionDate = optionalDate(getCsvValue(row, "Transaction Date"));
    const payoutDate = optionalDate(getCsvValue(row, "Payout Date", "Available On"));
    const date = transactionDate ?? payoutDate;
    if (!date) continue;

    grouped.set(payoutId, [...(grouped.get(payoutId) ?? []), date]);
  }

  return Array.from(grouped.entries()).map(([shopifyPayoutId, dates]) => {
    const timestamps = dates.map((date) => date.getTime());
    const startDate = new Date(Math.min(...timestamps));
    const endDate = new Date(Math.max(...timestamps) + 1);
    return {
      shopifyPayoutId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      source: "shopify_payment_transactions_csv",
    };
  });
}

function splitLineItemName(name: string) {
  const separator = " - ";
  const separatorIndex = name.lastIndexOf(separator);
  if (separatorIndex === -1) {
    return { productTitle: name, variantTitle: "Default Title" };
  }

  return {
    productTitle: name.slice(0, separatorIndex),
    variantTitle: name.slice(separatorIndex + separator.length),
  };
}

function toOrderGid(value: string) {
  if (!value) return "";
  return value.startsWith("gid://") ? value : `gid://shopify/Order/${value}`;
}

function parseShopifyOrdersCsv(rows: CsvRow[]): ShopifyOrderPayload[] {
  const orders = new Map<string, ShopifyOrderPayload>();
  const lineIndexes = new Map<string, number>();
  const orderKeyByName = new Map<string, string>();

  for (const row of rows) {
    const orderName = getCsvValue(row, "Name");
    const explicitOrderId = getCsvValue(row, "Id");
    const orderKey = explicitOrderId || (orderName ? orderKeyByName.get(orderName) : "") || orderName;
    if (!orderKey) continue;
    if (orderName) orderKeyByName.set(orderName, orderKey);

    const existing = orders.get(orderKey);
    const order = existing ?? {
      admin_graphql_api_id: toOrderGid(explicitOrderId || orderKey),
      name: orderName,
      created_at: getCsvValue(row, "Created at"),
      total_tax: getCsvValue(row, "Taxes") || "0",
      current_total_tax: getCsvValue(row, "Taxes") || "0",
      line_items: [],
    };
    if (!existing) {
      orders.set(orderKey, order);
      lineIndexes.set(orderKey, 0);
    }

    const lineName = getCsvValue(row, "Lineitem name");
    if (!lineName) continue;

    const lineIndex = (lineIndexes.get(orderKey) ?? 0) + 1;
    lineIndexes.set(orderKey, lineIndex);
    const { productTitle, variantTitle } = splitLineItemName(lineName);

    order.line_items?.push({
      id: `${orderKey}:${lineIndex}`,
      title: productTitle,
      variant_title: variantTitle,
      sku: getCsvValue(row, "Lineitem sku") || null,
      importMappingKey: lineMappingKey({ title: productTitle, variantTitle, sku: getCsvValue(row, "Lineitem sku") || null }),
      quantity: getCsvValue(row, "Lineitem quantity") || "0",
      price: getCsvValue(row, "Lineitem price") || "0",
      total_discount: getCsvValue(row, "Lineitem discount") || "0",
    });
  }

  return Array.from(orders.values());
}

function parseCsvImportRows(input: string, kind?: string) {
  const rows = parseCsvRows(input);
  if (kind === "payouts") return parseShopifyPaymentTransactionsCsv(rows);
  if (kind === "charges") return parseShopifyChargesCsv(rows);
  if (kind === "orders") return parseShopifyOrdersCsv(rows);
  throw new Error("Choose an import type before uploading CSV.");
}

export function parseHistoricalImportRows(input: string, kind?: string) {
  if (!input.trim()) return [];
  const trimmed = input.trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return parseJsonArray(input);
  return parseCsvImportRows(input, kind);
}

function createEmptySummary(kind: ImportSummary["kind"], totalRows: number): ImportSummary {
  return {
    ...ZERO_SUMMARY,
    kind,
    totalRows,
    warnings: [],
    errors: [],
  };
}

function addLineMappingRequests(summary: ImportSummary, requests: LineMappingRequest[]) {
  if (requests.length === 0) return;
  const existingKeys = new Set((summary.lineMappingRequests ?? []).map((request) => request.key));
  const nextRequests = requests.filter((request) => {
    if (existingKeys.has(request.key)) return false;
    existingKeys.add(request.key);
    return true;
  });
  summary.lineMappingRequests = [...(summary.lineMappingRequests ?? []), ...nextRequests];
}

async function createImportBatch(input: {
  shopId: string;
  kind: ImportKind;
  sourceName?: string | null;
  sourceType?: string | null;
  summary: ImportSummary;
}, db: DbClient) {
  return db.importBatch.create({
    data: {
      shopId: input.shopId,
      kind: input.kind,
      status: input.summary.errors.length > 0 ? "completed_with_errors" : "completed",
      sourceName: input.sourceName ?? null,
      sourceType: input.sourceType ?? "json",
      dryRun: false,
      summary: input.summary as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

function getPayoutId(row: PayoutImportRow) {
  return normalizeId(row.shopifyPayoutId ?? row.id);
}

function getChargeId(row: ChargeImportRow) {
  const explicit = normalizeId(row.shopifyTransactionId ?? row.id);
  if (explicit) return explicit;

  const payoutId = normalizeId(row.shopifyPayoutId ?? row.payoutId);
  const processedAt = row.processedAt ?? "";
  const amount = row.amount ?? "";
  const currency = row.currency ?? "";
  const type = row.transactionType ?? "";
  const description = row.description ?? "";
  return `historical:${payoutId}:${processedAt}:${amount}:${currency}:${type}:${description}`;
}

async function findPeriodForDate(shopId: string, date: Date, db: DbClient) {
  return db.reportingPeriod.findFirst({
    where: {
      shopId,
      startDate: { lte: date },
      endDate: { gt: date },
    },
    orderBy: { startDate: "desc" },
    select: { id: true },
  });
}

async function findPeriodForCharge(shopId: string, row: ChargeImportRow, db: DbClient) {
  const payoutId = normalizeId(row.shopifyPayoutId ?? row.payoutId);
  if (payoutId) {
    const period = await db.reportingPeriod.findFirst({
      where: { shopId, shopifyPayoutId: payoutId },
      select: { id: true },
    });
    if (period) return period;
  }

  const processedAt = optionalDate(row.processedAt);
  return processedAt ? findPeriodForDate(shopId, processedAt, db) : null;
}

export async function importHistoricalPayouts(input: {
  shopId: string;
  rows: unknown[];
  dryRun?: boolean;
  sourceName?: string | null;
  db?: DbClient;
}) {
  const db = input.db ?? prisma;
  const summary = createEmptySummary("payouts", input.rows.length);

  for (const [index, rawRow] of input.rows.entries()) {
    const row = rawRow as PayoutImportRow;
    try {
      const shopifyPayoutId = getPayoutId(row);
      if (!shopifyPayoutId) {
        throw new Error("Stable payout id is required.");
      }

      const startDate = parseDate(row.startDate ?? row.periodStart, "startDate");
      const endDate = parseDate(row.endDate ?? row.periodEnd, "endDate");
      if (endDate <= startDate) {
        throw new Error("endDate must be after startDate.");
      }

      const existing = await db.reportingPeriod.findUnique({
        where: { shopId_shopifyPayoutId: { shopId: input.shopId, shopifyPayoutId } },
        select: { id: true },
      });

      if (input.dryRun) {
        if (existing) summary.updated += 1;
        else summary.created += 1;
        continue;
      }

      await db.reportingPeriod.upsert({
        where: { shopId_shopifyPayoutId: { shopId: input.shopId, shopifyPayoutId } },
        create: {
          shopId: input.shopId,
          shopifyPayoutId,
          startDate,
          endDate,
          source: "historical_import",
        },
        update: {
          startDate,
          endDate,
          source: "historical_import",
        },
      });

      if (existing) summary.updated += 1;
      else summary.created += 1;
    } catch (error) {
      summary.errors.push({ row: index + 1, message: error instanceof Error ? error.message : "Invalid payout row." });
    }
  }

  if (!input.dryRun) {
    await createImportBatch(
      { shopId: input.shopId, kind: "payouts", sourceName: input.sourceName, summary },
      db,
    );
  }

  return summary;
}

export async function importHistoricalCharges(input: {
  shopId: string;
  rows: unknown[];
  dryRun?: boolean;
  sourceName?: string | null;
  db?: DbClient;
}) {
  const db = input.db ?? prisma;
  const summary = createEmptySummary("charges", input.rows.length);
  const importedRows: Array<{ row: ChargeImportRow; id: string; periodId: string | null }> = [];

  for (const [index, rawRow] of input.rows.entries()) {
    const row = rawRow as ChargeImportRow;
    try {
      const shopifyTransactionId = getChargeId(row);
      const amount = new Prisma.Decimal(row.amount ?? "0");
      if (amount.lte(0)) throw new Error("amount must be greater than zero.");

      const period = await findPeriodForCharge(input.shopId, row, db);
      if (!period) {
        summary.warnings.push({ row: index + 1, message: "No matching reporting period found; charge will be imported without a period." });
      }

      const existing = await db.shopifyChargeTransaction.findUnique({
        where: { shopId_shopifyTransactionId: { shopId: input.shopId, shopifyTransactionId } },
        select: { id: true },
      });

      if (existing) summary.skipped += 1;
      else summary.created += 1;

      importedRows.push({ row, id: shopifyTransactionId, periodId: period?.id ?? null });
    } catch (error) {
      summary.errors.push({ row: index + 1, message: error instanceof Error ? error.message : "Invalid charge row." });
    }
  }

  if (!input.dryRun) {
    const batch = await createImportBatch(
      { shopId: input.shopId, kind: "charges", sourceName: input.sourceName, summary },
      db,
    );

    for (const { row, id, periodId } of importedRows) {
      await db.shopifyChargeTransaction.createMany({
        data: [
          {
            shopId: input.shopId,
            shopifyTransactionId: id,
            periodId,
            importBatchId: batch.id,
            shopifyPayoutId: normalizeId(row.shopifyPayoutId ?? row.payoutId) || null,
            transactionType: row.transactionType ?? null,
            description: row.description ?? "Historical Shopify charge",
            amount: new Prisma.Decimal(row.amount ?? "0"),
            currency: row.currency ?? "USD",
            processedAt: optionalDate(row.processedAt),
          },
        ],
        skipDuplicates: true,
      });
    }
  }

  return summary;
}

function getOrderId(order: ShopifyOrderPayload) {
  return normalizeId(order.admin_graphql_api_id);
}

async function validateOrderRow(shopId: string, order: ShopifyOrderPayload, db: DbClient) {
  const warnings: string[] = [];
  const lineItems = order.line_items ?? [];

  if (!getOrderId(order)) {
    throw new Error("Order admin_graphql_api_id is required.");
  }

  if (lineItems.length === 0) {
    warnings.push("Order has no line items.");
  }

  for (const line of lineItems) {
    const variantId = normalizeId(line.admin_graphql_api_id?.includes("ProductVariant") ? line.admin_graphql_api_id : line.variant_id);
    if (!variantId) {
      warnings.push(`Line ${line.title ?? "Untitled"} is missing variant id.`);
      continue;
    }

    const variantGid = variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;
    const variant = await db.variant.findUnique({
      where: { shopId_shopifyId: { shopId, shopifyId: variantGid } },
      select: {
        id: true,
        costConfig: { select: { id: true } },
        product: {
          select: {
            causeAssignments: { select: { id: true }, take: 1 },
            artistAssignments: { select: { id: true }, take: 1 },
          },
        },
      },
    });

    if (!variant) {
      warnings.push(`Variant ${variantGid} is not synced in Count On Us.`);
      continue;
    }

    if (!variant.costConfig) {
      warnings.push(`Variant ${variantGid} has no cost configuration.`);
    }

    if (variant.product.causeAssignments.length === 0 && variant.product.artistAssignments.length === 0) {
      warnings.push(`Variant ${variantGid} has no Cause or Artist routing.`);
    }
  }

  return warnings;
}

async function resolveCsvLineVariant(input: {
  shopId: string;
  title?: string | null;
  variantTitle?: string | null;
  sku?: string | null;
  mappingOverrides?: Record<string, string>;
  db: DbClient;
}): Promise<
  | { status: "matched"; variant: ResolvedImportVariant; reason: string }
  | { status: "unresolved" | "ambiguous"; candidates: VariantMappingCandidate[] }
> {
  const sku = input.sku?.trim();
  if (sku) {
    const skuMatch = await input.db.variant.findFirst({
      where: { shopId: input.shopId, sku },
      select: { id: true, shopifyId: true, title: true, product: { select: { shopifyId: true, title: true } } },
    });
    if (skuMatch) return { status: "matched", variant: skuMatch, reason: "SKU match" };
  }

  const mappingKey = lineMappingKey(input);
  const overrideVariantId = input.mappingOverrides?.[mappingKey]?.trim();
  if (overrideVariantId) {
    const override = await input.db.variant.findFirst({
      where: { shopId: input.shopId, shopifyId: overrideVariantId },
      select: { id: true, shopifyId: true, title: true, product: { select: { shopifyId: true, title: true } } },
    });
    if (override) return { status: "matched", variant: override, reason: "merchant-selected mapping" };
  }

  const savedMapping = input.db.historicalLineItemMapping?.findUnique
    ? await input.db.historicalLineItemMapping.findUnique({
        where: { shopId_mappingKey: { shopId: input.shopId, mappingKey } },
        select: {
          variant: {
            select: { id: true, shopifyId: true, title: true, product: { select: { shopifyId: true, title: true } } },
          },
        },
      })
    : null;
  if (savedMapping?.variant) {
    return { status: "matched", variant: savedMapping.variant, reason: "saved import mapping" };
  }

  const title = input.title?.trim();
  if (!title) return { status: "unresolved", candidates: [] };
  const variantTitle = input.variantTitle?.trim() || "Default Title";
  const exactMatches = await input.db.variant.findMany({
    where: {
      shopId: input.shopId,
      product: { title },
      OR: [
        { title: variantTitle },
        ...(variantTitle === "Default Title" ? [{ title: "Default" }] : []),
      ],
    },
    take: 5,
    select: { id: true, shopifyId: true, title: true, product: { select: { shopifyId: true, title: true } } },
  });
  if (exactMatches.length === 1) return { status: "matched", variant: exactMatches[0], reason: "exact title match" };
  if (exactMatches.length > 1) {
    return {
      status: "ambiguous",
      candidates: exactMatches.map((variant) => ({
        shopifyVariantId: variant.shopifyId,
        label: variantCandidateLabel(variant),
        matchReason: "exact title match",
      })),
    };
  }

  const normalizedTitle = normalizeText(title);
  const normalizedVariantTitle = normalizeText(variantTitle);
  const variants = await input.db.variant.findMany({
    where: { shopId: input.shopId },
    take: 500,
    select: { id: true, shopifyId: true, title: true, product: { select: { shopifyId: true, title: true } } },
  });
  const candidates = variants
    .map((variant) => {
      const productTitle = normalizeText(variant.product.title);
      const candidateVariantTitle = normalizeText(variant.title);
      const productMatches =
        productTitle === normalizedTitle ||
        productTitle.includes(normalizedTitle) ||
        normalizedTitle.includes(productTitle);
      const variantMatches =
        normalizedVariantTitle === "default title" ||
        candidateVariantTitle === normalizedVariantTitle ||
        candidateVariantTitle.includes(normalizedVariantTitle) ||
        normalizedVariantTitle.includes(candidateVariantTitle);
      if (!productMatches || !variantMatches) return null;

      return {
        shopifyVariantId: variant.shopifyId,
        label: variantCandidateLabel(variant),
        matchReason: "normalized title match",
      };
    })
    .filter((candidate): candidate is VariantMappingCandidate => Boolean(candidate))
    .slice(0, 10);

  if (candidates.length === 1) {
    const candidate = candidates[0];
    const variant = await input.db.variant.findFirst({
      where: { shopId: input.shopId, shopifyId: candidate.shopifyVariantId },
      select: { id: true, shopifyId: true, title: true, product: { select: { shopifyId: true, title: true } } },
    });
    if (variant) return { status: "matched", variant, reason: candidate.matchReason };
  }

  return {
    status: candidates.length > 1 ? "ambiguous" : "unresolved",
    candidates,
  };
}

async function enrichHistoricalOrderRows(
  shopId: string,
  order: ShopifyOrderPayload,
  db: DbClient,
  mappingOverrides: Record<string, string>,
) {
  const warnings: string[] = [];
  const lineMappingRequests: LineMappingRequest[] = [];

  for (const lineItem of order.line_items ?? []) {
    const existingVariantId = normalizeId(lineItem.admin_graphql_api_id?.includes("ProductVariant") ? lineItem.admin_graphql_api_id : lineItem.variant_id);
    if (existingVariantId) continue;

    const resolution = await resolveCsvLineVariant({
      shopId,
      title: lineItem.title,
      variantTitle: lineItem.variant_title,
      sku: lineItem.sku,
      mappingOverrides,
      db,
    });

    if (resolution.status !== "matched") {
      const key = lineItem.importMappingKey ?? lineMappingKey(lineItem);
      lineMappingRequests.push({
        key,
        title: lineItem.title ?? "Untitled",
        variantTitle: lineItem.variant_title ?? "Default Title",
        sku: lineItem.sku ?? null,
        reason: resolution.status,
        candidates: resolution.candidates,
      });
      warnings.push(
        resolution.status === "ambiguous"
          ? `Line ${lineItem.title ?? "Untitled"}${lineItem.sku ? ` (${lineItem.sku})` : ""} matched multiple synced variants. Choose one before importing.`
          : `Line ${lineItem.title ?? "Untitled"}${lineItem.sku ? ` (${lineItem.sku})` : ""} could not be matched to a synced variant.`,
      );
      continue;
    }

    lineItem.variant_id = resolution.variant.shopifyId;
    lineItem.product_id = resolution.variant.product.shopifyId;
  }

  return { warnings, lineMappingRequests };
}

export async function persistHistoricalLineItemMappings(input: {
  shopId: string;
  orders: ShopifyOrderPayload[];
  mappingOverrides: Record<string, string>;
  importBatchId?: string | null;
  db?: DbClient;
}) {
  const db = input.db ?? prisma;
  const persisted = new Set<string>();

  for (const order of input.orders) {
    for (const lineItem of order.line_items ?? []) {
      const mappingKey = lineItem.importMappingKey ?? lineMappingKey(lineItem);
      const overrideVariantId = input.mappingOverrides[mappingKey]?.trim();
      if (!overrideVariantId || persisted.has(mappingKey)) continue;

      const variant = await db.variant.findFirst({
        where: { shopId: input.shopId, shopifyId: overrideVariantId },
        select: { id: true },
      });
      if (!variant) continue;

      await db.historicalLineItemMapping.upsert({
        where: { shopId_mappingKey: { shopId: input.shopId, mappingKey } },
        create: {
          shopId: input.shopId,
          mappingKey,
          lineTitle: lineItem.title ?? "Untitled",
          normalizedLineTitle: normalizeText(lineItem.title),
          variantTitle: lineItem.variant_title ?? null,
          normalizedVariantTitle: normalizeText(lineItem.variant_title),
          sku: lineItem.sku ?? null,
          variantId: variant.id,
          firstImportBatchId: input.importBatchId ?? null,
          lastImportBatchId: input.importBatchId ?? null,
          useCount: 1,
        },
        update: {
          lineTitle: lineItem.title ?? "Untitled",
          normalizedLineTitle: normalizeText(lineItem.title),
          variantTitle: lineItem.variant_title ?? null,
          normalizedVariantTitle: normalizeText(lineItem.variant_title),
          sku: lineItem.sku ?? null,
          variantId: variant.id,
          lastImportBatchId: input.importBatchId ?? null,
          useCount: { increment: 1 },
        },
      });
      persisted.add(mappingKey);
    }
  }

  return { persisted: persisted.size };
}

export async function importHistoricalOrders(input: {
  shopId: string;
  rows: unknown[];
  dryRun?: boolean;
  sourceName?: string | null;
  mappingOverrides?: Record<string, string>;
  db?: DbClient;
  fetchImpl?: typeof fetch;
}) {
  const db = input.db ?? prisma;
  const summary = createEmptySummary("orders", input.rows.length);
  const importedAt = new Date();
  const preparedOrders: Array<{ order: ShopifyOrderPayload; periodId: string | null }> = [];

  for (const [index, rawRow] of input.rows.entries()) {
    const order = rawRow as ShopifyOrderPayload;
    try {
      const shopifyOrderId = getOrderId(order);
      if (!shopifyOrderId) {
        throw new Error("Order admin_graphql_api_id is required.");
      }

      const existing = await db.orderSnapshot.findUnique({
        where: { shopId_shopifyOrderId: { shopId: input.shopId, shopifyOrderId } },
        select: { id: true },
      });

      if (existing) {
        summary.skipped += 1;
        continue;
      }

      const enrichment = await enrichHistoricalOrderRows(input.shopId, order, db, input.mappingOverrides ?? {});
      for (const warning of enrichment.warnings) {
        summary.warnings.push({ row: index + 1, message: warning });
      }
      addLineMappingRequests(summary, enrichment.lineMappingRequests);
      if (!input.dryRun && enrichment.lineMappingRequests.length > 0) {
        summary.errors.push({ row: index + 1, message: "Resolve line item mappings before importing this order." });
        continue;
      }

      const warnings = await validateOrderRow(input.shopId, order, db);
      for (const warning of warnings) {
        summary.warnings.push({ row: index + 1, message: warning });
      }

      const orderDate = optionalDate(order.created_at ?? order.createdAt);
      const period = orderDate ? await findPeriodForDate(input.shopId, orderDate, db) : null;
      if (!period) {
        summary.warnings.push({ row: index + 1, message: "No matching reporting period found for order date." });
      }

      summary.created += 1;
      preparedOrders.push({ order, periodId: period?.id ?? null });
    } catch (error) {
      summary.errors.push({ row: index + 1, message: error instanceof Error ? error.message : "Invalid order row." });
    }
  }

  if (!input.dryRun) {
    const batch = await createImportBatch(
      { shopId: input.shopId, kind: "orders", sourceName: input.sourceName, summary },
      db,
    );

    for (const { order, periodId } of preparedOrders) {
      await createSnapshot(
        input.shopId,
        order,
        db,
        "historical_import",
        input.fetchImpl ?? fetch,
        { importBatchId: batch.id, importedAt, periodId },
      );
    }

    if (Object.keys(input.mappingOverrides ?? {}).length > 0) {
      await persistHistoricalLineItemMappings({
        shopId: input.shopId,
        orders: preparedOrders.map((preparedOrder) => preparedOrder.order),
        mappingOverrides: input.mappingOverrides ?? {},
        importBatchId: batch.id,
        db,
      });
    }
  }

  return summary;
}

export async function rebuildReportingPeriod(input: {
  shopId: string;
  periodId: string;
  db?: DbClient;
}) {
  const db = input.db ?? prisma;
  const period = await db.reportingPeriod.findFirst({
    where: { shopId: input.shopId, id: input.periodId },
    select: { id: true, startDate: true, endDate: true },
  });
  if (!period) throw new Error("Reporting period not found.");

  return rebuildPaymentSafeReportingPeriod({ shopId: input.shopId, period, db });
}

function sumDecimals(values: Prisma.Decimal[]) {
  return values.reduce((sum, value) => sum.add(value), new Prisma.Decimal(0));
}

async function summarizeRebuildPeriodState(input: {
  shopId: string;
  period: { id: string; startDate: Date; endDate: Date };
  db: DbClient;
}) {
  const { db, period } = input;
  const [snapshotLines, chargesSummary, causeAllocations, artistAllocations] = await Promise.all([
    db.orderSnapshotLine.findMany({
      where: {
        shopId: input.shopId,
        snapshot: {
          createdAt: {
            gte: period.startDate,
            lt: period.endDate,
          },
        },
      },
      select: {
        subtotal: true,
        totalCost: true,
        netContribution: true,
        adjustments: {
          select: { netContribAdj: true },
        },
      },
    }),
    db.shopifyChargeTransaction.aggregate({
      where: {
        shopId: input.shopId,
        processedAt: {
          gte: period.startDate,
          lt: period.endDate,
        },
      },
      _sum: { amount: true },
    }),
    db.causeAllocation.findMany({
      where: {
        shopId: input.shopId,
        periodId: period.id,
      },
      select: { allocated: true },
    }),
    db.artistAllocation.findMany({
      where: {
        shopId: input.shopId,
        periodId: period.id,
      },
      select: { allocated: true },
    }),
  ]);

  const grossSales = sumDecimals(snapshotLines.map((line) => line.subtotal));
  const totalCost = sumDecimals(snapshotLines.map((line) => line.totalCost));
  const totalNetContribution = snapshotLines.reduce((sum, line) => {
    const adjustmentTotal = sumDecimals(line.adjustments.map((adjustment) => adjustment.netContribAdj));
    return sum.add(line.netContribution).add(adjustmentTotal);
  }, new Prisma.Decimal(0));
  const shopifyCharges = chargesSummary._sum.amount ?? new Prisma.Decimal(0);
  const donationPool = totalNetContribution.sub(shopifyCharges);
  const causeAllocationTotal = sumDecimals(causeAllocations.map((allocation) => allocation.allocated));
  const artistPayoutTotal = sumDecimals(artistAllocations.map((allocation) => allocation.allocated));

  return {
    orderLineCount: snapshotLines.length,
    grossSales,
    totalCost,
    totalNetContribution,
    shopifyCharges,
    donationPool,
    causeAllocationTotal,
    artistPayoutTotal,
    causeAllocationCount: causeAllocations.length,
    artistAllocationCount: artistAllocations.length,
  };
}

function decimalDelta(after: Prisma.Decimal, before: Prisma.Decimal) {
  return after.sub(before);
}

async function rebuildPaymentSafeReportingPeriod(input: {
  shopId: string;
  period: { id: string; startDate: Date; endDate: Date };
  db: DbClient;
}) {
  const { db, period } = input;
  const before = await summarizeRebuildPeriodState(input);

  await db.$transaction(async (tx) => {
    await tx.orderSnapshot.updateMany({
      where: {
        shopId: input.shopId,
        createdAt: { gte: period.startDate, lt: period.endDate },
      },
      data: { periodId: period.id },
    });
    await tx.orderSnapshot.updateMany({
      where: {
        shopId: input.shopId,
        periodId: period.id,
        OR: [
          { createdAt: { lt: period.startDate } },
          { createdAt: { gte: period.endDate } },
        ],
      },
      data: { periodId: null },
    });
    await tx.shopifyChargeTransaction.updateMany({
      where: {
        shopId: input.shopId,
        processedAt: { gte: period.startDate, lt: period.endDate },
      },
      data: { periodId: period.id },
    });
    await tx.analyticalRecalculationRun.deleteMany({ where: { shopId: input.shopId, periodId: period.id } });
  });

  await Promise.all([
    materializeCauseAllocationsForPeriod(input.shopId, period, db),
    materializeArtistAllocationsForPeriod(input.shopId, period, db),
  ]);

  const after = await summarizeRebuildPeriodState(input);

  return {
    periodId: period.id,
    periodStartDate: period.startDate.toISOString(),
    periodEndDate: period.endDate.toISOString(),
    before: {
      orderLineCount: before.orderLineCount,
      grossSales: before.grossSales.toString(),
      totalCost: before.totalCost.toString(),
      totalNetContribution: before.totalNetContribution.toString(),
      shopifyCharges: before.shopifyCharges.toString(),
      donationPool: before.donationPool.toString(),
      causeAllocationTotal: before.causeAllocationTotal.toString(),
      artistPayoutTotal: before.artistPayoutTotal.toString(),
      causeAllocationCount: before.causeAllocationCount,
      artistAllocationCount: before.artistAllocationCount,
    },
    after: {
      orderLineCount: after.orderLineCount,
      grossSales: after.grossSales.toString(),
      totalCost: after.totalCost.toString(),
      totalNetContribution: after.totalNetContribution.toString(),
      shopifyCharges: after.shopifyCharges.toString(),
      donationPool: after.donationPool.toString(),
      causeAllocationTotal: after.causeAllocationTotal.toString(),
      artistPayoutTotal: after.artistPayoutTotal.toString(),
      causeAllocationCount: after.causeAllocationCount,
      artistAllocationCount: after.artistAllocationCount,
    },
    delta: {
      orderLineCount: after.orderLineCount - before.orderLineCount,
      grossSales: decimalDelta(after.grossSales, before.grossSales).toString(),
      totalCost: decimalDelta(after.totalCost, before.totalCost).toString(),
      totalNetContribution: decimalDelta(after.totalNetContribution, before.totalNetContribution).toString(),
      shopifyCharges: decimalDelta(after.shopifyCharges, before.shopifyCharges).toString(),
      donationPool: decimalDelta(after.donationPool, before.donationPool).toString(),
      causeAllocationTotal: decimalDelta(after.causeAllocationTotal, before.causeAllocationTotal).toString(),
      artistPayoutTotal: decimalDelta(after.artistPayoutTotal, before.artistPayoutTotal).toString(),
      causeAllocationCount: after.causeAllocationCount - before.causeAllocationCount,
      artistAllocationCount: after.artistAllocationCount - before.artistAllocationCount,
    },
  };
}

export async function rebuildAllReporting(input: { shopId: string; db?: DbClient }) {
  const db = input.db ?? prisma;
  const periods = await db.reportingPeriod.findMany({
    where: { shopId: input.shopId },
    orderBy: { startDate: "asc" },
    select: { id: true, startDate: true, endDate: true },
  });

  const rebuilt = [];
  for (const period of periods) {
    rebuilt.push(await rebuildPaymentSafeReportingPeriod({ shopId: input.shopId, period, db }));
  }
  return rebuilt;
}
