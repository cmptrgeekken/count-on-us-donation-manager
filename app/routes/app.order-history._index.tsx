import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useNavigate, useRouteError, useSearchParams } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { HelpText } from "../components/HelpText";
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
const PAGE_SIZE = 50;

function normaliseOrigin(value: string | null) {
  return value === "webhook" || value === "reconciliation" ? value : "all";
}

function normaliseDate(value: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function endOfDayIso(dateString: string) {
  return new Date(`${dateString}T23:59:59.999Z`);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const url = new URL(request.url);
  const origin = normaliseOrigin(url.searchParams.get("origin"));
  const startDate = normaliseDate(url.searchParams.get("startDate"));
  const endDate = normaliseDate(url.searchParams.get("endDate"));
  const cursor = url.searchParams.get("cursor")?.trim() || "";

  const where = {
    shopId,
    ...(origin === "all" ? {} : { origin }),
    ...((startDate || endDate)
      ? {
          createdAt: {
            ...(startDate ? { gte: new Date(`${startDate}T00:00:00.000Z`) } : {}),
            ...(endDate ? { lte: endOfDayIso(endDate) } : {}),
          },
        }
      : {}),
  };

  const snapshots = await prisma.orderSnapshot.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: PAGE_SIZE + 1,
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

  const hasNextPage = snapshots.length > PAGE_SIZE;
  const pageSnapshots = hasNextPage ? snapshots.slice(0, PAGE_SIZE) : snapshots;
  const nextCursor = hasNextPage ? pageSnapshots.at(-1)?.id ?? null : null;

  return Response.json({
    origin,
    startDate,
    endDate,
    nextCursor,
    snapshots: pageSnapshots.map<SnapshotListRow>((snapshot) => ({
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

function buildOrderHistoryHref({
  origin,
  startDate,
  endDate,
  cursor,
}: {
  origin: string;
  startDate?: string;
  endDate?: string;
  cursor?: string | null;
}) {
  const params = new URLSearchParams();
  if (origin && origin !== "all") params.set("origin", origin);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/app/order-history?${query}` : "/app/order-history";
}

function FilterLink({
  currentOrigin,
  targetOrigin,
  label,
  startDate,
  endDate,
}: {
  currentOrigin: string;
  targetOrigin: string;
  label: string;
  startDate?: string;
  endDate?: string;
}) {
  const isActive = currentOrigin === targetOrigin;
  const href = buildOrderHistoryHref({
    origin: targetOrigin,
    startDate,
    endDate,
  });

  return (
    <Link
      to={href}
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
    </Link>
  );
}

export default function OrderHistoryPage() {
  const { origin, startDate, endDate, nextCursor, snapshots } = useLoaderData<typeof loader>();
  const { formatMoney } = useAppLocalization();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  function applyDateFilters(form: HTMLFormElement) {
    const formData = new FormData(form);
    const params = new URLSearchParams(searchParams);
    const nextStartDate = normaliseDate(formData.get("startDate")?.toString() ?? "");
    const nextEndDate = normaliseDate(formData.get("endDate")?.toString() ?? "");

    params.delete("cursor");

    if (nextStartDate) params.set("startDate", nextStartDate);
    else params.delete("startDate");

    if (nextEndDate) params.set("endDate", nextEndDate);
    else params.delete("endDate");

    navigate(`?${params.toString()}`);
  }

  return (
    <>
      <ui-title-bar title="Order History" />

      <s-page>
        <s-section heading="Snapshots">
          <div style={{ display: "grid", gap: "1rem" }}>
            <HelpText>Order History shows immutable financial snapshots captured at order time or later reconciliation. Net contribution here means revenue remaining after resolved production costs for the order lines.</HelpText>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <strong>Origin filter</strong>
              <FilterLink currentOrigin={origin} targetOrigin="all" label="All" startDate={startDate} endDate={endDate} />
              <FilterLink currentOrigin={origin} targetOrigin="webhook" label="Webhook" startDate={startDate} endDate={endDate} />
              <FilterLink
                currentOrigin={origin}
                targetOrigin="reconciliation"
                label="Reconciliation"
                startDate={startDate}
                endDate={endDate}
              />
            </div>

            <form
              method="get"
              style={{ display: "grid", gap: "0.75rem" }}
              onSubmit={(event) => {
                event.preventDefault();
                applyDateFilters(event.currentTarget);
              }}
            >
              {origin !== "all" ? <input type="hidden" name="origin" value={origin} /> : null}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "0.75rem",
                  alignItems: "end",
                }}
              >
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <span>Start date</span>
                  <HelpText>Show snapshots created on or after this UTC date.</HelpText>
                  <input
                    type="date"
                    name="startDate"
                    defaultValue={startDate}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "0.75rem",
                      borderRadius: "0.75rem",
                      border: "1px solid var(--p-color-border, #d2d5d8)",
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <span>End date</span>
                  <HelpText>Show snapshots created on or before this UTC date.</HelpText>
                  <input
                    type="date"
                    name="endDate"
                    defaultValue={endDate}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "0.75rem",
                      borderRadius: "0.75rem",
                      border: "1px solid var(--p-color-border, #d2d5d8)",
                    }}
                  />
                </label>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <s-button type="submit" variant="secondary">
                    Apply dates
                  </s-button>
                  <Link to={buildOrderHistoryHref({ origin })} style={{ alignSelf: "center" }}>
                    Clear dates
                  </Link>
                </div>
              </div>
            </form>

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
                        <Link to={`/app/order-history/${snapshot.id}`}>View</Link>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}

            {nextCursor ? (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Link
                  to={buildOrderHistoryHref({
                    origin,
                    startDate,
                    endDate,
                    cursor: nextCursor,
                  })}
                >
                  Next page
                </Link>
              </div>
            ) : null}
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
