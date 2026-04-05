import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRouteError } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { useAppLocalization } from "../utils/use-app-localization";

type SnapshotListRow = {
  id: string;
  orderNumber: string;
  origin: string;
  createdAt: string;
  lineCount: number;
  adjustmentCount: number;
  totalNetContribution: string;
};

const ZERO = new Prisma.Decimal(0);

function normaliseOrigin(value: string | null) {
  return value === "webhook" || value === "reconciliation" ? value : "all";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const url = new URL(request.url);
  const origin = normaliseOrigin(url.searchParams.get("origin"));

  const snapshots = await prisma.orderSnapshot.findMany({
    where: {
      shopId,
      ...(origin === "all" ? {} : { origin }),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      lines: {
        select: {
          id: true,
          netContribution: true,
          adjustments: {
            select: { netContribAdj: true },
          },
        },
      },
    },
  });

  return Response.json({
    origin,
    snapshots: snapshots.map<SnapshotListRow>((snapshot) => ({
      id: snapshot.id,
      orderNumber: snapshot.orderNumber ?? "Unnumbered order",
      origin: snapshot.origin,
      createdAt: snapshot.createdAt.toISOString(),
      lineCount: snapshot.lines.length,
      adjustmentCount: snapshot.lines.reduce((sum, line) => sum + line.adjustments.length, 0),
      totalNetContribution: snapshot.lines
        .reduce((sum, line) => {
          const adjustmentTotal = line.adjustments.reduce(
            (lineSum, adjustment) => lineSum.add(adjustment.netContribAdj),
            ZERO,
          );
          return sum.add(line.netContribution).add(adjustmentTotal);
        }, ZERO)
        .toString(),
    })),
  });
};

function FilterLink({ currentOrigin, targetOrigin, label }: { currentOrigin: string; targetOrigin: string; label: string }) {
  const isActive = currentOrigin === targetOrigin;
  const href = targetOrigin === "all" ? "/app/order-history" : `/app/order-history?origin=${targetOrigin}`;

  return (
    <a
      href={href}
      style={{
        padding: "0.55rem 0.9rem",
        borderRadius: "999px",
        textDecoration: "none",
        border: "1px solid var(--p-color-border, #d2d5d8)",
        background: isActive ? "var(--p-color-bg-fill-brand-subdued, #e3f1df)" : "var(--p-color-bg-surface, #fff)",
        color: "inherit",
        fontWeight: isActive ? 600 : 400,
      }}
    >
      {label}
    </a>
  );
}

export default function OrderHistoryPage() {
  const { origin, snapshots } = useLoaderData<typeof loader>();
  const { formatMoney } = useAppLocalization();

  return (
    <>
      <ui-title-bar title="Order History" />

      <s-page>
        <s-section heading="Snapshots">
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <strong>Origin filter</strong>
              <FilterLink currentOrigin={origin} targetOrigin="all" label="All" />
              <FilterLink currentOrigin={origin} targetOrigin="webhook" label="Webhook" />
              <FilterLink currentOrigin={origin} targetOrigin="reconciliation" label="Reconciliation" />
            </div>

            {snapshots.length === 0 ? (
              <s-banner tone="warning">
                <s-text>No snapshots found for the selected filter yet.</s-text>
              </s-banner>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Order</s-table-header>
                  <s-table-header listSlot="inline">Origin</s-table-header>
                  <s-table-header listSlot="inline">Created</s-table-header>
                  <s-table-header listSlot="secondary" format="numeric">Lines</s-table-header>
                  <s-table-header listSlot="secondary" format="numeric">Adjustments</s-table-header>
                  <s-table-header listSlot="labeled" format="currency">Net contribution</s-table-header>
                  <s-table-header>Details</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {snapshots.map((snapshot: SnapshotListRow) => (
                    <s-table-row key={snapshot.id}>
                      <s-table-cell>{snapshot.orderNumber}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={snapshot.origin === "webhook" ? "success" : "caution"}>
                          {snapshot.origin === "webhook" ? "Webhook" : "Reconciliation"}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>{new Date(snapshot.createdAt).toLocaleString()}</s-table-cell>
                      <s-table-cell>{snapshot.lineCount}</s-table-cell>
                      <s-table-cell>{snapshot.adjustmentCount}</s-table-cell>
                      <s-table-cell>{formatMoney(snapshot.totalNetContribution)}</s-table-cell>
                      <s-table-cell>
                        <a href={`/app/order-history/${snapshot.id}`}>View</a>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </div>
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[OrderHistory] ErrorBoundary caught:", error);

  return (
    <>
      <ui-title-bar title="Order History" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading Order History. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
