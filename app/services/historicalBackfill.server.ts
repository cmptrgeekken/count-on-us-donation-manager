import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { createSnapshot, type ShopifyOrderPayload } from "./snapshotService.server";
import {
  materializeArtistAllocationsForPeriod,
  materializeCauseAllocationsForPeriod,
} from "./reportingPeriodService.server";

type DbClient = typeof prisma;

type ImportKind = "payouts" | "charges" | "orders";

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

type ImportSummary = {
  kind: ImportKind | "rebuild";
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  warnings: ImportIssue[];
  errors: ImportIssue[];
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

function parseJsonArray(input: string) {
  const parsed = JSON.parse(input);
  if (!Array.isArray(parsed)) {
    throw new Error("Import payload must be a JSON array.");
  }
  return parsed as unknown[];
}

export function parseHistoricalImportRows(input: string) {
  if (!input.trim()) return [];
  return parseJsonArray(input);
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

export async function importHistoricalOrders(input: {
  shopId: string;
  rows: unknown[];
  dryRun?: boolean;
  sourceName?: string | null;
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

  const [disbursementApplications, artistPaymentApplications] = await Promise.all([
    db.disbursementApplication.count({
      where: { shopId: input.shopId, causeAllocation: { periodId: period.id } },
    }),
    db.artistPaymentApplication.count({
      where: { shopId: input.shopId, artistAllocation: { periodId: period.id } },
    }),
  ]);

  if (disbursementApplications > 0 || artistPaymentApplications > 0) {
    throw new Error("This period has payment applications. Reverse payments before rebuilding reporting allocations.");
  }

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

  const [causeAllocations, artistAllocations] = await Promise.all([
    materializeCauseAllocationsForPeriod(input.shopId, period, db),
    materializeArtistAllocationsForPeriod(input.shopId, period, db),
  ]);

  return {
    periodId: period.id,
    causeAllocationCount: causeAllocations.length,
    artistAllocationCount: artistAllocations.length,
  };
}

export async function rebuildAllReporting(input: { shopId: string; db?: DbClient }) {
  const db = input.db ?? prisma;
  const periods = await db.reportingPeriod.findMany({
    where: { shopId: input.shopId },
    orderBy: { startDate: "asc" },
    select: { id: true },
  });
  const rebuilt = [];
  for (const period of periods) {
    rebuilt.push(await rebuildReportingPeriod({ shopId: input.shopId, periodId: period.id, db }));
  }
  return rebuilt;
}
