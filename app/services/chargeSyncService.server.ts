import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { createOrOpenReportingPeriod } from "./reportingPeriodService.server";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type ShopifyMoney = {
  amount?: string | null;
  currencyCode?: string | null;
};

type BalanceTransactionNode = {
  id: string;
  type?: string | null;
  test?: boolean | null;
  transactionDate?: string | null;
  associatedPayout?: {
    id?: string | null;
    issuedAt?: string | null;
  } | null;
  amount?: ShopifyMoney | null;
  fee?: ShopifyMoney | null;
  net?: ShopifyMoney | null;
};

type BalanceTransactionEdge = {
  cursor: string;
  node: BalanceTransactionNode;
};

type BalanceTransactionsConnection = {
  pageInfo?: { hasNextPage?: boolean };
  edges?: BalanceTransactionEdge[];
};

type BalanceTransactionsPayload = {
  data?: {
    shopifyPaymentsAccount?: {
      balanceTransactions?: BalanceTransactionsConnection | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

type SyncShopifyChargesInput = {
  shopId: string;
  admin: AdminContext;
  payoutId?: string | null;
  payoutDate?: string | null;
  since?: Date;
  until?: Date;
  db?: typeof prisma;
};

const BALANCE_TRANSACTIONS_QUERY = `#graphql
  query ShopifyPaymentsBalanceTransactions($cursor: String, $query: String!) {
    shopifyPaymentsAccount {
      balanceTransactions(first: 100, after: $cursor, query: $query) {
        pageInfo {
          hasNextPage
        }
        edges {
          cursor
          node {
            id
            type
            test
            transactionDate
            associatedPayout {
              id
              issuedAt
            }
            amount {
              amount
              currencyCode
            }
            fee {
              amount
              currencyCode
            }
            net {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function recentSyncStart() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 7);
  return date;
}

function buildBalanceTransactionQuery(input: {
  payoutId?: string | null;
  payoutDate?: string | null;
  since?: Date;
  until?: Date;
}) {
  const parts: string[] = [];

  if (input.payoutId) {
    parts.push(`payments_transfer_id:${input.payoutId}`);
  }

  if (input.payoutDate) {
    parts.push(`payout_date:${input.payoutDate}`);
  }

  if (input.since) {
    parts.push(`transaction_date:>=${toDateInput(input.since)}`);
  }

  if (input.until) {
    parts.push(`transaction_date:<${toDateInput(input.until)}`);
  }

  return parts.join(" ");
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decimalFromMoney(value: ShopifyMoney | null | undefined) {
  return new Prisma.Decimal(value?.amount ?? "0");
}

function netEffect(transaction: BalanceTransactionNode) {
  const net = decimalFromMoney(transaction.net);
  if (!net.equals(0)) return net;

  return decimalFromMoney(transaction.amount);
}

function isShopifyCharge(transaction: BalanceTransactionNode) {
  return netEffect(transaction).lessThan(0);
}

function chooseChargeAmount(transaction: BalanceTransactionNode) {
  return netEffect(transaction).abs();
}

function normalizeShopifyPayoutId(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/\/([^/]+)$/);
  return match?.[1] ?? value;
}

async function readGraphqlPayload<T>(
  admin: AdminContext,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();

  if (payload?.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${payload.errors[0]?.message ?? "Unknown error"}`);
  }

  return payload as T;
}

async function fetchBalanceTransactions(
  admin: AdminContext,
  searchQuery: string,
): Promise<BalanceTransactionNode[]> {
  const transactions: BalanceTransactionNode[] = [];
  let cursor: string | null = null;

  do {
    const payload: BalanceTransactionsPayload = await readGraphqlPayload<BalanceTransactionsPayload>(
      admin,
      BALANCE_TRANSACTIONS_QUERY,
      { cursor, query: searchQuery },
    );
    const connection: BalanceTransactionsConnection | null | undefined =
      payload.data?.shopifyPaymentsAccount?.balanceTransactions;
    const edges: BalanceTransactionEdge[] = connection?.edges ?? [];

    transactions.push(...edges.map((edge) => edge.node));
    cursor = connection?.pageInfo?.hasNextPage ? edges.at(-1)?.cursor ?? null : null;
  } while (cursor);

  return transactions;
}

async function ensurePeriodForTransaction(
  shopId: string,
  transaction: BalanceTransactionNode,
  db: typeof prisma,
) {
  const payoutId = normalizeShopifyPayoutId(transaction.associatedPayout?.id);
  const transactionDate = parseDate(transaction.transactionDate) ?? new Date();
  const payoutDate = parseDate(transaction.associatedPayout?.issuedAt) ?? transactionDate;
  const startDate = new Date(Date.UTC(transactionDate.getUTCFullYear(), transactionDate.getUTCMonth(), transactionDate.getUTCDate()));
  const endDate = new Date(Date.UTC(payoutDate.getUTCFullYear(), payoutDate.getUTCMonth(), payoutDate.getUTCDate() + 1));

  return createOrOpenReportingPeriod(
    {
      shopId,
      startDate,
      endDate: endDate > startDate ? endDate : new Date(startDate.getTime() + 24 * 60 * 60 * 1000),
      shopifyPayoutId: payoutId,
      source: payoutId ? "payout" : "charge-sync",
    },
    db,
  );
}

export async function syncShopifyCharges(input: SyncShopifyChargesInput) {
  const db = input.db ?? prisma;
  const searchQuery = buildBalanceTransactionQuery({
    payoutId: input.payoutId,
    payoutDate: input.payoutDate,
    since: input.since ?? (input.payoutId || input.payoutDate ? undefined : recentSyncStart()),
    until: input.until,
  });
  const transactions = await fetchBalanceTransactions(input.admin, searchQuery);
  let imported = 0;
  let skipped = 0;

  for (const transaction of transactions) {
    if (!isShopifyCharge(transaction)) {
      skipped += 1;
      continue;
    }

    const payoutId = normalizeShopifyPayoutId(transaction.associatedPayout?.id) ?? input.payoutId ?? null;
    const period = await ensurePeriodForTransaction(input.shopId, transaction, db);
    const created = await db.shopifyChargeTransaction.createMany({
      data: [
        {
          shopId: input.shopId,
          shopifyTransactionId: transaction.id,
          periodId: period.id,
          shopifyPayoutId: payoutId,
          transactionType: transaction.type ?? null,
          description: transaction.test ? "Test Shopify Payments transaction" : null,
          amount: chooseChargeAmount(transaction),
          currency:
            transaction.fee?.currencyCode ??
            transaction.amount?.currencyCode ??
            transaction.net?.currencyCode ??
            "USD",
          processedAt: parseDate(transaction.transactionDate),
        },
      ],
      skipDuplicates: true,
    });

    if (created.count > 0) {
      imported += created.count;
    } else {
      skipped += 1;
    }
  }

  await db.auditLog.create({
    data: {
      shopId: input.shopId,
      entity: "ShopifyChargeTransaction",
      action: "SHOPIFY_CHARGES_SYNCED",
      actor: "system",
      payload: {
        imported,
        skipped,
        query: searchQuery,
      },
    },
  });

  return { imported, skipped };
}
