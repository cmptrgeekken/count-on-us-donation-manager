import { prisma } from "../db.server";
import { syncShopifyCharges } from "./chargeSyncService.server";
import { runReconciliation } from "./reconciliationService.server";
import {
  closeReportingPeriod,
  createOrOpenReportingPeriod,
} from "./reportingPeriodService.server";
import { refreshTaxOffsetCacheForShop } from "./reportingService.server";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type FinancialBackfillInput = {
  shopId: string;
  admin: AdminContext;
  since?: Date | string | null;
  until?: Date | string | null;
  closePeriods?: boolean;
  createMonthlyPeriods?: boolean;
  db?: typeof prisma;
};

function parseDate(value: Date | string | null | undefined, fallback: Date) {
  if (value instanceof Date) return value;
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid financial backfill date: ${value}`);
  }
  return parsed;
}

function defaultSinceDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 60);
  return date;
}

function defaultUntilDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function createMonthlyBackfillPeriods(
  shopId: string,
  since: Date,
  until: Date,
  db: typeof prisma,
) {
  let ensured = 0;
  let cursor = startOfUtcMonth(since);

  while (cursor < until) {
    const nextMonth = addUtcMonths(cursor, 1);
    await createOrOpenReportingPeriod(
      {
        shopId,
        startDate: cursor,
        endDate: nextMonth,
        shopifyPayoutId: `financial-backfill:${monthKey(cursor)}`,
        source: "financial-backfill",
      },
      db,
    );
    ensured += 1;
    cursor = nextMonth;
  }

  return ensured;
}

export async function runFinancialBackfill(input: FinancialBackfillInput) {
  const db = input.db ?? prisma;
  const since = parseDate(input.since, defaultSinceDate());
  const until = parseDate(input.until, defaultUntilDate());

  if (until <= since) {
    throw new Error("Financial backfill until date must be after since date.");
  }

  const reconciliation = await runReconciliation(input.shopId, input.admin, db, {
    since,
    until,
  });
  const charges = await syncShopifyCharges({
    shopId: input.shopId,
    admin: input.admin,
    since,
    until,
    db,
  });

  const monthlyPeriodsEnsured = input.createMonthlyPeriods
    ? await createMonthlyBackfillPeriods(input.shopId, since, until, db)
    : 0;

  let closedPeriods = 0;
  if (input.closePeriods !== false) {
    const periods = await db.reportingPeriod.findMany({
      where: {
        shopId: input.shopId,
        startDate: { lt: until },
        endDate: { gt: since },
      },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });

    for (const period of periods) {
      const result = await closeReportingPeriod(input.shopId, period.id, db);
      if (result.closed) {
        closedPeriods += 1;
      }
    }
  }

  await refreshTaxOffsetCacheForShop(input.shopId, db);

  const summary = {
    since: since.toISOString(),
    until: until.toISOString(),
    ordersCreated: reconciliation.created,
    ordersSkipped: reconciliation.skipped,
    chargeTransactionsImported: charges.imported,
    chargeTransactionsSkipped: charges.skipped,
    monthlyPeriodsEnsured,
    closedPeriods,
  };

  await db.auditLog.create({
    data: {
      shopId: input.shopId,
      entity: "ReportingPeriod",
      action: "FINANCIAL_BACKFILL_COMPLETED",
      actor: "system",
      payload: summary,
    },
  });

  return summary;
}
