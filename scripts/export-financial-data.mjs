import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function usage() {
  return [
    "Usage:",
    "  npm run export:financial -- --shop=<shop.myshopify.com> [--out=seed-imports/financial.json]",
    "",
    "Options:",
    "  --shop=<domain>        Required source shop.",
    "  --out=<path>           Output JSON path.",
    "  --since=YYYY-MM-DD     Inclusive export start date.",
    "  --until=YYYY-MM-DD     Exclusive export end date.",
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const result = {
    shopId: null,
    out: null,
    since: null,
    until: null,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (arg.startsWith("--shop=")) {
      result.shopId = arg.slice("--shop=".length).trim();
    } else if (arg.startsWith("--out=")) {
      result.out = arg.slice("--out=".length).trim();
    } else if (arg.startsWith("--since=")) {
      result.since = parseDateArg("since", arg.slice("--since=".length));
    } else if (arg.startsWith("--until=")) {
      result.until = parseDateArg("until", arg.slice("--until=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  if (!result.shopId) {
    throw new Error(`--shop is required.\n\n${usage()}`);
  }
  if (result.since && result.until && result.until <= result.since) {
    throw new Error("--until must be after --since.");
  }

  result.out ??= `seed-imports/financial-${result.shopId.replace(/[^a-z0-9.-]+/gi, "-")}.json`;
  return result;
}

function parseDateArg(name, value) {
  const parsed = new Date(`${value.trim()}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --${name} date: ${value}`);
  }
  return parsed;
}

function dateWindow(field, since, until) {
  if (!since && !until) return {};
  return {
    [field]: {
      ...(since ? { gte: since } : {}),
      ...(until ? { lt: until } : {}),
    },
  };
}

function decimalString(value) {
  if (value === null || value === undefined) return null;
  return value.toString();
}

function dateString(value) {
  if (!value) return null;
  return value.toISOString();
}

function omitUndefined(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function periodKey(period) {
  if (!period) return null;
  if (period.shopifyPayoutId) return `payout:${period.shopifyPayoutId}`;
  return `range:${period.startDate.toISOString()}:${period.endDate.toISOString()}:${period.source}`;
}

function causeKey(cause) {
  if (!cause) return null;
  return cause.shopifyMetaobjectId ? `metaobject:${cause.shopifyMetaobjectId}` : `name:${cause.name}`;
}

function artistKey(artist) {
  if (!artist) return null;
  return `name:${artist.displayName}:${artist.creditName}`;
}

function periodRef(period) {
  if (!period) return null;
  return {
    periodKey: periodKey(period),
    shopifyPayoutId: period.shopifyPayoutId,
    startDate: dateString(period.startDate),
    endDate: dateString(period.endDate),
    source: period.source,
    status: period.status,
  };
}

async function exportFinancial({ shopId, out, since, until }) {
  const shop = await prisma.shop.findUnique({
    where: { shopId },
    select: { shopId: true, shopifyDomain: true, currency: true },
  });

  if (!shop) {
    throw new Error(`Shop not found: ${shopId}`);
  }

  const [
    reportingPeriods,
    businessExpenses,
    shopifyChargeTransactions,
    disbursements,
    artistPayments,
    taxTrueUps,
  ] = await Promise.all([
    prisma.reportingPeriod.findMany({
      where: {
        shopId,
        ...(since || until
          ? {
              ...(since ? { endDate: { gt: since } } : {}),
              ...(until ? { startDate: { lt: until } } : {}),
            }
          : {}),
      },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.businessExpense.findMany({
      where: { shopId, ...dateWindow("expenseDate", since, until) },
      orderBy: [{ expenseDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.shopifyChargeTransaction.findMany({
      where: { shopId, ...dateWindow("processedAt", since, until) },
      include: { period: true },
      orderBy: [{ processedAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.disbursement.findMany({
      where: { shopId, ...dateWindow("paidAt", since, until) },
      include: {
        period: true,
        cause: true,
        applications: {
          include: {
            causeAllocation: {
              include: {
                period: true,
                cause: true,
              },
            },
          },
          orderBy: [{ createdAt: "asc" }],
        },
      },
      orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.artistPayment.findMany({
      where: { shopId, ...dateWindow("paidAt", since, until) },
      include: {
        period: true,
        artist: true,
        applications: {
          include: {
            artistAllocation: {
              include: {
                period: true,
                artist: true,
              },
            },
          },
          orderBy: [{ createdAt: "asc" }],
        },
      },
      orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.taxTrueUp.findMany({
      where: { shopId, ...dateWindow("filedAt", since, until) },
      include: {
        period: true,
        appliedPeriod: true,
        redistributions: {
          include: { cause: true },
          orderBy: [{ createdAt: "asc" }],
        },
      },
      orderBy: [{ filedAt: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const payload = {
    meta: {
      exportFormat: "count-on-us-financial-v1",
      exportedAt: new Date().toISOString(),
      shopId: shop.shopId,
      shopifyDomain: shop.shopifyDomain,
      currency: shop.currency,
      since: dateString(since),
      until: dateString(until),
      notes: [
        "This export intentionally excludes order snapshots, snapshot lines, line allocations, and materialized period allocations.",
        "Use financial backfill/reporting services to recreate snapshot-derived reporting against the target shop's current configuration.",
        "Receipt file keys are exported as references only; backing storage objects are not copied by this script.",
      ],
    },
    reportingPeriods: reportingPeriods.map((row) => omitUndefined({
      _dedupeKey: periodKey(row),
      shopId: row.shopId,
      status: row.status,
      source: row.source,
      startDate: dateString(row.startDate),
      endDate: dateString(row.endDate),
      shopifyPayoutId: row.shopifyPayoutId,
      closedAt: dateString(row.closedAt),
    })),
    businessExpenses: businessExpenses.map((row) => omitUndefined({
      _dedupeKey: row.id,
      shopId: row.shopId,
      category: row.category,
      subType: row.subType,
      name: row.name,
      amount: decimalString(row.amount),
      expenseDate: dateString(row.expenseDate),
      notes: row.notes,
    })),
    shopifyChargeTransactions: shopifyChargeTransactions.map((row) => omitUndefined({
      _dedupeKey: row.shopifyTransactionId,
      shopId: row.shopId,
      shopifyTransactionId: row.shopifyTransactionId,
      periodDedupeKey: periodKey(row.period),
      period: periodRef(row.period),
      shopifyPayoutId: row.shopifyPayoutId,
      transactionType: row.transactionType,
      description: row.description,
      amount: decimalString(row.amount),
      currency: row.currency,
      processedAt: dateString(row.processedAt),
    })),
    disbursements: disbursements.map((row) => omitUndefined({
      _dedupeKey: row.id,
      shopId: row.shopId,
      periodDedupeKey: periodKey(row.period),
      period: periodRef(row.period),
      causeDedupeKey: causeKey(row.cause),
      causeName: row.cause.name,
      amount: decimalString(row.amount),
      allocatedAmount: decimalString(row.allocatedAmount),
      extraContributionAmount: decimalString(row.extraContributionAmount),
      feesCoveredAmount: decimalString(row.feesCoveredAmount),
      paidAt: dateString(row.paidAt),
      paymentMethod: row.paymentMethod,
      referenceId: row.referenceId,
      receiptFileKey: row.receiptFileKey,
      applications: row.applications.map((application) => omitUndefined({
        allocationPeriodDedupeKey: periodKey(application.causeAllocation.period),
        allocationPeriod: periodRef(application.causeAllocation.period),
        causeDedupeKey: causeKey(application.causeAllocation.cause),
        causeName: application.causeAllocation.causeName,
        amount: decimalString(application.amount),
      })),
    })),
    artistPayments: artistPayments.map((row) => omitUndefined({
      _dedupeKey: row.id,
      shopId: row.shopId,
      periodDedupeKey: periodKey(row.period),
      period: periodRef(row.period),
      artistDedupeKey: artistKey(row.artist),
      artistName: row.artistName ?? row.artist.displayName,
      creditName: row.artist.creditName,
      amount: decimalString(row.amount),
      paidAt: dateString(row.paidAt),
      paymentMethod: row.paymentMethod,
      referenceId: row.referenceId,
      notes: row.notes,
      applications: row.applications.map((application) => omitUndefined({
        allocationPeriodDedupeKey: periodKey(application.artistAllocation.period),
        allocationPeriod: periodRef(application.artistAllocation.period),
        artistDedupeKey: artistKey(application.artistAllocation.artist),
        artistName: application.artistAllocation.artistName,
        creditName: application.artistAllocation.creditName,
        amount: decimalString(application.amount),
      })),
    })),
    taxTrueUps: taxTrueUps.map((row) => omitUndefined({
      _dedupeKey: row.id,
      shopId: row.shopId,
      periodDedupeKey: periodKey(row.period),
      period: periodRef(row.period),
      appliedPeriodDedupeKey: periodKey(row.appliedPeriod),
      appliedPeriod: periodRef(row.appliedPeriod),
      estimatedTax: decimalString(row.estimatedTax),
      actualTax: decimalString(row.actualTax),
      delta: decimalString(row.delta),
      redistributionNotes: row.redistributionNotes,
      filedAt: dateString(row.filedAt),
      redistributions: row.redistributions.map((redistribution) => omitUndefined({
        causeDedupeKey: causeKey(redistribution.cause),
        causeName: redistribution.causeName,
        amount: decimalString(redistribution.amount),
      })),
    })),
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Wrote financial export to ${out}`);
  console.log(`Reporting periods: ${reportingPeriods.length}`);
  console.log(`Business expenses: ${businessExpenses.length}`);
  console.log(`Shopify charge transactions: ${shopifyChargeTransactions.length}`);
  console.log(`Disbursements: ${disbursements.length}`);
  console.log(`Artist payments: ${artistPayments.length}`);
  console.log(`Tax true-ups: ${taxTrueUps.length}`);
}

const options = parseArgs();
exportFinancial(options)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
