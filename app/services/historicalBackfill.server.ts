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
type ImportLineKind = "product" | "tip" | "custom";

const TIP_MAPPING_VALUE = "__TIP__";
const CUSTOM_MAPPING_VALUE = "__CUSTOM__";

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

type ReplacementSnapshotSummary = {
  row: number;
  shopifyOrderId: string;
  orderNumber: string | null;
  existingSnapshotId: string | null;
  replacementSnapshotId?: string | null;
  origin?: string | null;
  periodId?: string | null;
  periodStatus?: string | null;
  requiresForce: boolean;
  lineCount: number;
  totalCost: string;
  netContribution: string;
  status: "would_replace" | "replaced" | "skipped" | "blocked";
};

type ImportSummary = {
  kind: ImportKind | "rebuild" | "snapshot_replacement";
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  warnings: ImportIssue[];
  errors: ImportIssue[];
  lineMappingRequests?: LineMappingRequest[];
  replacementResults?: ReplacementSnapshotSummary[];
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
    throw new Error("The CSV has no header row. Export it again from Shopify without removing the first row, then retry.");
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
    throw new Error("The JSON payload must be an array of rows enclosed in [ ]. Correct its structure, then run the dry run again.");
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
    const explicitOrderId = getCsvValue(row, "Id", "Order ID", "Order Id");
    const orderKey = explicitOrderId || (orderName ? orderKeyByName.get(orderName) : "") || orderName;
    if (!orderKey) continue;
    if (orderName) orderKeyByName.set(orderName, orderKey);

    const existing = orders.get(orderKey);
    const order = existing ?? {
      admin_graphql_api_id: toOrderGid(explicitOrderId || orderKey),
      name: orderName,
      line_items: [],
    };
    if (!existing) {
      orders.set(orderKey, order);
      lineIndexes.set(orderKey, 0);
    }

    const createdAt = getCsvValue(row, "Created at", "Created At");
    const updatedAt = getCsvValue(row, "Updated at", "Updated At");
    const cancelledAt = getCsvValue(row, "Cancelled at", "Canceled at", "Cancelled At", "Canceled At");
    const financialStatus = getCsvValue(row, "Financial Status", "Payment Status", "Order Financial Status");
    const fulfillmentStatus = getCsvValue(row, "Fulfillment Status", "Order Fulfillment Status");
    const subtotal = getCsvValue(row, "Subtotal", "Subtotal Price", "Current Subtotal Price");
    const refundedAmount = getCsvValue(row, "Refunded Amount", "Refund Amount");
    const discounts = getCsvValue(row, "Discount Amount", "Discount", "Discounts", "Total Discounts");
    const total = getCsvValue(row, "Total", "Total Price", "Current Total Price");
    const shipping = getCsvValue(row, "Shipping", "Shipping Price", "Total Shipping");
    const taxes = getCsvValue(row, "Taxes", "Tax", "Total Tax");
    const email = getCsvValue(row, "Email", "Contact Email", "Customer Email");
    const customerId = getCsvValue(row, "Customer ID", "Customer Id");
    const customerName = getCsvValue(row, "Customer", "Customer Name");
    const billingName = getCsvValue(row, "Billing Name") || customerName;
    const billingFirstName = getCsvValue(row, "Billing First Name", "Customer First Name");
    const billingLastName = getCsvValue(row, "Billing Last Name", "Customer Last Name");
    const shippingName = getCsvValue(row, "Shipping Name");
    const shippingFirstName = getCsvValue(row, "Shipping First Name");
    const shippingLastName = getCsvValue(row, "Shipping Last Name");

    if (orderName) order.name = orderName;
    if (createdAt) order.created_at = createdAt;
    if (updatedAt) order.updated_at = updatedAt;
    if (cancelledAt) order.cancelled_at = cancelledAt;
    if (financialStatus) order.financial_status = financialStatus;
    if (fulfillmentStatus) order.fulfillment_status = fulfillmentStatus;
    if (subtotal) order.subtotal_price = subtotal;
    if (refundedAmount) order.refunded_amount = refundedAmount;
    if (order.subtotal_price) {
      order.current_subtotal_price = Prisma.Decimal.max(
        new Prisma.Decimal(order.subtotal_price).sub(new Prisma.Decimal(order.refunded_amount || 0)),
        new Prisma.Decimal(0),
      ).toString();
    }
    if (discounts) {
      order.total_discounts = discounts;
      order.current_total_discounts = discounts;
    }
    if (total) {
      order.total_price = total;
      order.current_total_price = total;
    }
    if (shipping) order.total_shipping_price_set = { shop_money: { amount: shipping } };
    if (taxes) {
      order.total_tax = taxes;
      order.current_total_tax = taxes;
    }
    if (email) order.email = email;
    if (customerId || email || billingFirstName || billingLastName) {
      order.customer = {
        id: customerId || order.customer?.id,
        email: email || order.customer?.email,
        first_name: billingFirstName || order.customer?.first_name,
        last_name: billingLastName || order.customer?.last_name,
      };
    }
    if (billingName || billingFirstName || billingLastName) {
      order.billing_address = {
        name: billingName || order.billing_address?.name,
        first_name: billingFirstName || order.billing_address?.first_name,
        last_name: billingLastName || order.billing_address?.last_name,
      };
    }
    if (shippingName || shippingFirstName || shippingLastName) {
      order.shipping_address = {
        name: shippingName || order.shipping_address?.name,
        first_name: shippingFirstName || order.shipping_address?.first_name,
        last_name: shippingLastName || order.shipping_address?.last_name,
      };
    }

    const lineName = getCsvValue(row, "Lineitem name", "Line item name");
    if (!lineName) continue;

    const lineIndex = (lineIndexes.get(orderKey) ?? 0) + 1;
    lineIndexes.set(orderKey, lineIndex);
    const { productTitle, variantTitle } = splitLineItemName(lineName);

    order.line_items?.push({
      id: `${orderKey}:${lineIndex}`,
      title: productTitle,
      variant_title: variantTitle,
      sku: getCsvValue(row, "Lineitem sku", "Line item sku") || null,
      importMappingKey: lineMappingKey({ title: productTitle, variantTitle, sku: getCsvValue(row, "Lineitem sku", "Line item sku") || null }),
      quantity: getCsvValue(row, "Lineitem quantity", "Line item quantity") || "0",
      price: getCsvValue(row, "Lineitem price", "Line item price") || "0",
      total_discount: getCsvValue(row, "Lineitem discount", "Line item discount") || "0",
      importLineKind: (() => {
        const status = normalizeText(getCsvValue(
          row,
          "Lineitem fulfillment status",
          "Line item fulfillment status",
          "Lineitem fulfullment status",
          "Line item fulfullment status",
        )).replace(/ /g, "_");
        if (status === "not_eligible") return "not_eligible";
        if (status === "fulfilled") return "product";
        return "pending";
      })(),
    });
  }

  return Array.from(orders.values());
}

function parseCsvImportRows(input: string, kind?: string) {
  const rows = parseCsvRows(input);
  if (kind === "payouts") return parseShopifyPaymentTransactionsCsv(rows);
  if (kind === "charges") return parseShopifyChargesCsv(rows);
  if (kind === "orders") return parseShopifyOrdersCsv(rows);
  throw new Error("Choose Payouts, Shopify charges, or Orders as the import type, then upload the CSV again.");
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
        throw new Error("Payout ID is missing. Use a Shopify Payments export with the Payout ID column, or add shopifyPayoutId to this row.");
      }

      const startDate = parseDate(row.startDate ?? row.periodStart, "startDate");
      const endDate = parseDate(row.endDate ?? row.periodEnd, "endDate");
      if (endDate <= startDate) {
        throw new Error("endDate must be later than startDate. Correct both dates in this row and retry.");
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
      if (amount.lte(0)) throw new Error("Charge amount must be greater than zero. Correct this row's amount and retry.");

      const period = await findPeriodForCharge(input.shopId, row, db);
      if (!period) {
        summary.warnings.push({ row: index + 1, message: "No reporting period covers this charge. Import the matching payout period, then rebuild it to attach the charge." });
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
  return toOrderGid(normalizeId(order.admin_graphql_api_id));
}

async function validateOrderRow(shopId: string, order: ShopifyOrderPayload, db: DbClient) {
  const warnings: string[] = [];
  const lineItems = order.line_items ?? [];

  if (!getOrderId(order)) {
    throw new Error("Order ID is missing. Use a Shopify Orders CSV with the ID column, or add admin_graphql_api_id to this JSON row.");
  }

  if (lineItems.length === 0) {
    warnings.push("Order has no line items. Export it again with Shopify line-item columns, or remove the empty order from the import.");
  }
  if (
    order.financial_status === undefined &&
    order.fulfillment_status === undefined &&
    order.cancelled_at === undefined &&
    order.canceled_at === undefined
  ) {
    warnings.push("Order is missing payment, cancellation, or refund status. Import those lifecycle fields or review the order in Order History before relying on finalized reporting.");
  }

  for (const line of lineItems) {
    if (line.importLineKind === "tip" || line.importLineKind === "pending" || line.importLineKind === "not_eligible") continue;
    if (line.importLineKind === "custom") {
      warnings.push(`Custom line ${line.title ?? "Untitled"} will import with zero recorded production cost and no product-specific routing.`);
      continue;
    }

    const variantId = normalizeId(line.admin_graphql_api_id?.includes("ProductVariant") ? line.admin_graphql_api_id : line.variant_id);
    if (!variantId) {
      warnings.push(`Line ${line.title ?? "Untitled"} has no variant ID. Map it to a synced variant or classify it as a tip or custom item before importing.`);
      continue;
    }

    const variantGid = variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`;
    const variant = await db.variant.findUnique({
      where: { shopId_shopifyId: { shopId, shopifyId: variantGid } },
      select: {
        id: true,
        title: true,
        sku: true,
        costConfig: { select: { id: true } },
        product: {
          select: {
            title: true,
            causeAssignments: { select: { id: true }, take: 1 },
            artistAssignments: { select: { id: true }, take: 1 },
          },
        },
      },
    });

    if (!variant) {
      warnings.push(`Line ${line.title ?? "Untitled"} references a variant that is not synced in Count On Us. Sync the Shopify catalog, then rerun the dry run and map the line.`);
      continue;
    }

    const variantLabel = `${variant.product.title} — ${variant.title}${variant.sku ? ` (${variant.sku})` : ""}`;

    if (!variant.costConfig) {
      warnings.push(`${variantLabel} has no cost configuration.`);
    }

    if (variant.product.causeAssignments.length === 0 && variant.product.artistAssignments.length === 0) {
      warnings.push(`${variantLabel} has no Cause or Artist routing.`);
    }
  }

  return warnings;
}

async function resolveCsvLineVariant(input: {
  shopId: string;
  mappingKey?: string | null;
  title?: string | null;
  variantTitle?: string | null;
  sku?: string | null;
  mappingOverrides?: Record<string, string>;
  db: DbClient;
}): Promise<
  | { status: "matched"; variant: ResolvedImportVariant; reason: string }
  | { status: "classified"; lineKind: Exclude<ImportLineKind, "product">; reason: string }
  | { status: "unresolved" | "ambiguous"; candidates: VariantMappingCandidate[] }
> {
  const mappingKey = input.mappingKey ?? lineMappingKey(input);
  const overrideVariantId = input.mappingOverrides?.[mappingKey]?.trim();
  if (overrideVariantId === TIP_MAPPING_VALUE) {
    return { status: "classified", lineKind: "tip", reason: "merchant-selected tip handling" };
  }
  if (overrideVariantId === CUSTOM_MAPPING_VALUE) {
    return { status: "classified", lineKind: "custom", reason: "merchant-selected custom merchandise handling" };
  }

  const sku = input.sku?.trim();
  if (sku) {
    const skuMatch = await input.db.variant.findFirst({
      where: { shopId: input.shopId, sku },
      select: { id: true, shopifyId: true, title: true, product: { select: { shopifyId: true, title: true } } },
    });
    if (skuMatch) return { status: "matched", variant: skuMatch, reason: "SKU match" };
  }

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
          lineKind: true,
          variant: {
            select: { id: true, shopifyId: true, title: true, product: { select: { shopifyId: true, title: true } } },
          },
        },
      })
    : null;
  if (savedMapping?.lineKind === "tip" || savedMapping?.lineKind === "custom") {
    return { status: "classified", lineKind: savedMapping.lineKind, reason: "saved import handling" };
  }
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
  const suppliedVariantGids = Array.from(new Set(
    (order.line_items ?? [])
      .map((lineItem) => normalizeId(
        lineItem.admin_graphql_api_id?.includes("ProductVariant")
          ? lineItem.admin_graphql_api_id
          : lineItem.variant_id,
      ))
      .filter(Boolean)
      .map((variantId) => variantId.startsWith("gid://") ? variantId : `gid://shopify/ProductVariant/${variantId}`),
  ));
  const syncedSuppliedVariants = suppliedVariantGids.length > 0
    ? await db.variant.findMany({
        where: { shopId, shopifyId: { in: suppliedVariantGids } },
        select: { shopifyId: true },
      })
    : [];
  const syncedVariantGids = new Set(syncedSuppliedVariants.map((variant) => variant.shopifyId));

  for (const lineItem of order.line_items ?? []) {
    if (lineItem.importLineKind === "pending" || lineItem.importLineKind === "not_eligible") continue;
    const existingVariantId = normalizeId(lineItem.admin_graphql_api_id?.includes("ProductVariant") ? lineItem.admin_graphql_api_id : lineItem.variant_id);
    const existingVariantGid = existingVariantId
      ? existingVariantId.startsWith("gid://")
        ? existingVariantId
        : `gid://shopify/ProductVariant/${existingVariantId}`
      : null;
    if (existingVariantGid && syncedVariantGids.has(existingVariantGid)) continue;

    const resolution = await resolveCsvLineVariant({
      shopId,
      mappingKey: lineItem.importMappingKey,
      title: lineItem.title,
      variantTitle: lineItem.variant_title,
      sku: lineItem.sku,
      mappingOverrides,
      db,
    });

    if (resolution.status === "classified") {
      lineItem.importLineKind = resolution.lineKind;
      continue;
    }

    if (resolution.status !== "matched") {
      const key = lineItem.importMappingKey ?? lineMappingKey({
        title: lineItem.title,
        variantTitle: lineItem.variant_title,
        sku: lineItem.sku,
      });
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
    lineItem.importLineKind = "product";
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
      const mappingKey = lineItem.importMappingKey ?? lineMappingKey({
        title: lineItem.title,
        variantTitle: lineItem.variant_title,
        sku: lineItem.sku,
      });
      const overrideVariantId = input.mappingOverrides[mappingKey]?.trim();
      if (!overrideVariantId || persisted.has(mappingKey)) continue;

      const lineKind: ImportLineKind = overrideVariantId === TIP_MAPPING_VALUE
        ? "tip"
        : overrideVariantId === CUSTOM_MAPPING_VALUE
          ? "custom"
          : "product";
      const variant = lineKind === "product"
        ? await db.variant.findFirst({
            where: { shopId: input.shopId, shopifyId: overrideVariantId },
            select: { id: true },
          })
        : null;
      if (lineKind === "product" && !variant) continue;

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
          lineKind,
          variantId: variant?.id ?? null,
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
          lineKind,
          variantId: variant?.id ?? null,
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
  const preparedOrders: Array<{
    order: ShopifyOrderPayload;
    periodId: string | null;
    replacement?: {
      id: string;
      periodId: string | null;
      customerDisplayName: string | null;
      shopifyCustomerId: string | null;
      normalizedCustomerEmailHash: string | null;
      subtotalAmount: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      shippingAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      salesTaxCollected: Prisma.Decimal;
    };
  }> = [];

  for (const [index, rawRow] of input.rows.entries()) {
    const order = rawRow as ShopifyOrderPayload;
    try {
      let shopifyOrderId = getOrderId(order);
      if (!shopifyOrderId) {
        throw new Error("Order ID is missing. Use a Shopify Orders CSV with the ID column, or add admin_graphql_api_id to this JSON row.");
      }

      let existing = db.orderRecord?.findUnique
        ? (await db.orderRecord.findUnique({
            where: { shopId_shopifyOrderId: { shopId: input.shopId, shopifyOrderId } },
            select: { currentSnapshot: { select: {
              id: true, origin: true, periodId: true, customerDisplayName: true,
              shopifyCustomerId: true, normalizedCustomerEmailHash: true,
              subtotalAmount: true, discountAmount: true, shippingAmount: true,
              totalAmount: true, salesTaxCollected: true,
            } } },
          }))?.currentSnapshot ?? null
        : await db.orderSnapshot.findFirst({
            where: { shopId: input.shopId, shopifyOrderId },
            select: {
              id: true, origin: true, periodId: true, customerDisplayName: true,
              shopifyCustomerId: true, normalizedCustomerEmailHash: true,
              subtotalAmount: true, discountAmount: true, shippingAmount: true,
              totalAmount: true, salesTaxCollected: true,
            },
          });

      const hasCanonicalShopifyOrderId = /^gid:\/\/shopify\/Order\/\d+$/.test(shopifyOrderId);
      if (!existing && !hasCanonicalShopifyOrderId && order.name && db.orderRecord?.findFirst) {
        const matchingRecord = await db.orderRecord.findFirst({
          where: {
            shopId: input.shopId,
            currentSnapshot: { is: { orderNumber: order.name } },
          },
          select: {
            shopifyOrderId: true,
            currentSnapshot: { select: {
              id: true, origin: true, periodId: true, customerDisplayName: true,
              shopifyCustomerId: true, normalizedCustomerEmailHash: true,
              subtotalAmount: true, discountAmount: true, shippingAmount: true,
              totalAmount: true, salesTaxCollected: true,
            } },
          },
        });
        if (matchingRecord?.currentSnapshot) {
          shopifyOrderId = matchingRecord.shopifyOrderId;
          existing = matchingRecord.currentSnapshot;
        }
      }

      if (existing && existing.origin !== "reconciliation") {
        summary.skipped += 1;
        continue;
      }

      const enrichment = await enrichHistoricalOrderRows(input.shopId, order, db, input.mappingOverrides ?? {});
      for (const warning of enrichment.warnings) {
        summary.warnings.push({ row: index + 1, message: warning });
      }
      addLineMappingRequests(summary, enrichment.lineMappingRequests);
      if (!input.dryRun && enrichment.lineMappingRequests.length > 0) {
        summary.errors.push({ row: index + 1, message: "Choose a product/variant, Tip, or Custom handling for every unresolved line below, then import again." });
        continue;
      }

      const warnings = await validateOrderRow(input.shopId, order, db);
      for (const warning of warnings) {
        summary.warnings.push({ row: index + 1, message: warning });
      }

      const orderDate = optionalDate(order.created_at ?? order.createdAt);
      const period = orderDate ? await findPeriodForDate(input.shopId, orderDate, db) : null;
      if (!period) {
        summary.warnings.push({ row: index + 1, message: "No reporting period covers this order date. Import the matching payout period, then rebuild it to attach the order." });
      }

      if (existing) summary.updated += 1;
      else summary.created += 1;
      preparedOrders.push({
        order: { ...order, admin_graphql_api_id: shopifyOrderId },
        periodId: existing?.periodId ?? period?.id ?? null,
        replacement: existing ? {
          id: existing.id,
          periodId: existing.periodId,
          customerDisplayName: existing.customerDisplayName,
          shopifyCustomerId: existing.shopifyCustomerId,
          normalizedCustomerEmailHash: existing.normalizedCustomerEmailHash,
          subtotalAmount: existing.subtotalAmount,
          discountAmount: existing.discountAmount,
          shippingAmount: existing.shippingAmount,
          totalAmount: existing.totalAmount,
          salesTaxCollected: existing.salesTaxCollected,
        } : undefined,
      });
    } catch (error) {
      summary.errors.push({ row: index + 1, message: error instanceof Error ? error.message : "Invalid order row." });
    }
  }

  if (!input.dryRun) {
    const batch = await createImportBatch(
      { shopId: input.shopId, kind: "orders", sourceName: input.sourceName, summary },
      db,
    );

    for (const { order, periodId, replacement } of preparedOrders) {
      await createSnapshot(
        input.shopId,
        order,
        db,
        "historical_import",
        input.fetchImpl ?? fetch,
        {
          importBatchId: batch.id,
          importedAt,
          periodId,
          replaceExistingSnapshotId: replacement?.id,
          replacementReason: replacement ? "Historical import superseded reconciliation snapshot" : null,
          replacementSource: replacement ? "historical_import" : null,
          fallbackSnapshot: replacement,
        },
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

export async function replaceOrderSnapshots(input: {
  shopId: string;
  rows: unknown[];
  dryRun?: boolean;
  forceClosed?: boolean;
  replacementReason: string;
  sourceName?: string | null;
  mappingOverrides?: Record<string, string>;
  db?: DbClient;
  fetchImpl?: typeof fetch;
}) {
  const db = input.db ?? prisma;
  const dryRun = input.dryRun ?? true;
  const forceClosed = input.forceClosed ?? false;
  const replacementReason = input.replacementReason.trim();
  const summary = createEmptySummary("snapshot_replacement", input.rows.length);
  summary.replacementResults = [];

  if (!dryRun && replacementReason.length < 8) {
    throw new Error("Enter a replacement reason of at least 8 characters explaining why the financial snapshot is changing, then retry.");
  }

  for (const [index, rawRow] of input.rows.entries()) {
    const rowNumber = index + 1;
    const order = rawRow as ShopifyOrderPayload;
    try {
      const shopifyOrderId = getOrderId(order);
      if (!shopifyOrderId) {
        throw new Error("Order ID is missing. Use a Shopify Orders CSV with the ID column, or add admin_graphql_api_id to this JSON row.");
      }

      const existing = db.orderRecord?.findUnique
        ? (await db.orderRecord.findUnique({
            where: { shopId_shopifyOrderId: { shopId: input.shopId, shopifyOrderId } },
            select: {
              currentSnapshot: {
                select: {
                  id: true,
                  orderNumber: true,
                  origin: true,
                  periodId: true,
                  customerDisplayName: true,
                  shopifyCustomerId: true,
                  normalizedCustomerEmailHash: true,
                  subtotalAmount: true,
                  discountAmount: true,
                  shippingAmount: true,
                  totalAmount: true,
                  salesTaxCollected: true,
                  period: { select: { status: true } },
                  lines: { select: { totalCost: true, netContribution: true } },
                },
              },
            },
          }))?.currentSnapshot ?? null
        : await db.orderSnapshot.findFirst({
            where: { shopId: input.shopId, shopifyOrderId },
            select: {
              id: true,
              orderNumber: true,
              origin: true,
              periodId: true,
              customerDisplayName: true,
              shopifyCustomerId: true,
              normalizedCustomerEmailHash: true,
              subtotalAmount: true,
              discountAmount: true,
              shippingAmount: true,
              totalAmount: true,
              salesTaxCollected: true,
              period: { select: { status: true } },
              lines: { select: { totalCost: true, netContribution: true } },
            },
          });

      if (!existing) {
        summary.skipped += 1;
        summary.replacementResults.push({
          row: rowNumber,
          shopifyOrderId,
          orderNumber: order.name ?? order.order_number?.toString() ?? null,
          existingSnapshotId: null,
          requiresForce: false,
          lineCount: 0,
          totalCost: "0",
          netContribution: "0",
          status: "skipped",
        });
        summary.warnings.push({ row: rowNumber, message: "No existing snapshot was found. Import this order through Historical import before using Snapshot replacement." });
        continue;
      }

      const enrichment = await enrichHistoricalOrderRows(input.shopId, order, db, input.mappingOverrides ?? {});
      for (const warning of enrichment.warnings) {
        summary.warnings.push({ row: rowNumber, message: warning });
      }
      addLineMappingRequests(summary, enrichment.lineMappingRequests);
      if (enrichment.lineMappingRequests.length > 0) {
        summary.errors.push({ row: rowNumber, message: "Choose a product/variant, Tip, or Custom handling for every unresolved line below, then rerun replacement." });
        continue;
      }

      const warnings = await validateOrderRow(input.shopId, order, db);
      for (const warning of warnings) {
        summary.warnings.push({ row: rowNumber, message: warning });
      }

      const requiresForce = existing.period?.status === "CLOSED";
      const totalCost = sumDecimals(existing.lines.map((line: { totalCost: Prisma.Decimal }) => line.totalCost));
      const netContribution = sumDecimals(existing.lines.map((line: { netContribution: Prisma.Decimal }) => line.netContribution));
      const baseResult = {
        row: rowNumber,
        shopifyOrderId,
        orderNumber: existing.orderNumber ?? order.name ?? order.order_number?.toString() ?? null,
        existingSnapshotId: existing.id,
        origin: existing.origin,
        periodId: existing.periodId,
        periodStatus: existing.period?.status ?? null,
        requiresForce,
        lineCount: existing.lines.length,
        totalCost: totalCost.toString(),
        netContribution: netContribution.toString(),
      };

      if (requiresForce && !forceClosed) {
        summary.skipped += 1;
        summary.replacementResults.push({ ...baseResult, status: "blocked" });
        summary.errors.push({ row: rowNumber, message: "This snapshot belongs to a closed period. Review the dry run, enable Force closed-period replacement, enter REPLACE, and rebuild the period afterward." });
        continue;
      }

      if (dryRun) {
        summary.updated += 1;
        summary.replacementResults.push({ ...baseResult, status: "would_replace" });
        continue;
      }

      const replacement = await createSnapshot(
        input.shopId,
        order,
        db,
        existing.origin === "historical_import" || existing.origin === "reconciliation" ? existing.origin : "webhook",
        input.fetchImpl ?? fetch,
        {
          periodId: existing.periodId,
          replaceExistingSnapshotId: existing.id,
          replacementReason,
          replacementSource: input.sourceName ?? "uploaded_order_payload",
          fallbackSnapshot: {
            customerDisplayName: existing.customerDisplayName,
            shopifyCustomerId: existing.shopifyCustomerId,
            normalizedCustomerEmailHash: existing.normalizedCustomerEmailHash,
            subtotalAmount: existing.subtotalAmount,
            discountAmount: existing.discountAmount,
            shippingAmount: existing.shippingAmount,
            totalAmount: existing.totalAmount,
            salesTaxCollected: existing.salesTaxCollected,
          },
        },
      );

      summary.updated += 1;
      summary.replacementResults.push({
        ...baseResult,
        replacementSnapshotId: replacement.snapshotId ?? null,
        status: "replaced",
      });
    } catch (error) {
      summary.errors.push({ row: rowNumber, message: error instanceof Error ? error.message : "Invalid order row." });
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
  if (!period) throw new Error("The selected reporting period no longer exists. Refresh the page, choose a current period, and retry the rebuild.");

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
          currentForOrderRecord: { isNot: null },
          orderRecord: { lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } } },
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
  const reviewRequiredOrderCount = db.orderRecord?.count
    ? await db.orderRecord.count({
        where: {
          shopId: input.shopId,
          OR: [
            { lifecycle: { is: null } },
            { lifecycle: { is: { state: { in: ["unknown", "review_required"] } } } },
          ],
          currentSnapshot: {
            is: { createdAt: { gte: period.startDate, lt: period.endDate } },
          },
        },
      })
    : 0;
  if (reviewRequiredOrderCount > 0) {
    throw new Error(
      `Reporting rebuild blocked: ${reviewRequiredOrderCount} order(s) in this period require lifecycle review. Resolve them from Order History before rebuilding so valid donation obligations are not removed.`,
    );
  }
  const before = await summarizeRebuildPeriodState(input);

  await db.$transaction(async (tx) => {
    await tx.orderSnapshot.updateMany({
      where: {
        shopId: input.shopId,
        currentForOrderRecord: { isNot: null },
        orderRecord: { lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } } },
        createdAt: { gte: period.startDate, lt: period.endDate },
      },
      data: { periodId: period.id },
    });
    await tx.orderSnapshot.updateMany({
      where: {
        shopId: input.shopId,
        periodId: period.id,
        currentForOrderRecord: { isNot: null },
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
    await tx.orderSettlement.updateMany({
      where: {
        shopId: input.shopId,
        snapshot: {
          currentForOrderRecord: { isNot: null },
          orderRecord: { lifecycle: { is: { state: { in: ["active", "partially_refunded"] } } } },
          createdAt: { gte: period.startDate, lt: period.endDate },
        },
      },
      data: { periodId: period.id },
    });
    await tx.orderSettlement.updateMany({
      where: {
        shopId: input.shopId,
        periodId: period.id,
        snapshot: {
          currentForOrderRecord: { isNot: null },
          OR: [
            { createdAt: { lt: period.startDate } },
            { createdAt: { gte: period.endDate } },
          ],
        },
      },
      data: { periodId: null },
    });
    await tx.analyticalRecalculationRun.deleteMany({ where: { shopId: input.shopId, periodId: period.id } });
  });

  await Promise.all([
    materializeCauseAllocationsForPeriod(input.shopId, period, db),
    materializeArtistAllocationsForPeriod(input.shopId, period, db),
  ]);
  await db.reportingPeriod.updateMany({
    where: { id: period.id, shopId: input.shopId },
    data: { rebuildRequired: false, rebuildRequestedAt: null },
  });

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
