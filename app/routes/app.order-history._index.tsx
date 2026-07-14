import { jsonResponse } from "~/utils/json-response.server";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigate, useRouteError, useSearchParams } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { HelpText } from "../components/HelpText";
import { prisma } from "../db.server";
import { bulkReviewOrderLifecycles } from "../services/orderLifecycle.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { shopifyAdminOrderUrl } from "../utils/shopify-admin-url";
import { useAppLocalization } from "../utils/use-app-localization";

type SnapshotListRow = {
  id: string;
  orderNumber: string;
  customerDisplayName: string | null;
  shopifyAdminUrl: string | null;
  origin: string;
  createdAt: string;
  lineCount: number;
  adjustmentCount: number;
  totalNetContribution: string;
  lifecycleState: string;
  lifecycleReviewReason: string | null;
};

const ZERO = new Prisma.Decimal(0);
const PAGE_SIZE = 50;

const bulkLifecycleReviewSchema = z.object({
  snapshotIds: z.array(z.string().trim().min(1)).min(1, "Select at least one order.").max(PAGE_SIZE),
  lifecycleState: z.enum(["active", "fully_refunded", "canceled"]),
  confirmLifecycle: z.literal("on", { error: "Confirm that you reviewed the selected orders in Shopify." }),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const formData = await request.formData();

  if (formData.get("intent")?.toString() !== "bulk-resolve-lifecycle") {
    return jsonResponse({ ok: false, message: "Unknown action." }, { status: 400 });
  }

  const parsed = bulkLifecycleReviewSchema.safeParse({
    snapshotIds: formData.getAll("snapshotIds").map((value) => value.toString()),
    lifecycleState: formData.get("lifecycleState")?.toString(),
    confirmLifecycle: formData.get("confirmLifecycle")?.toString(),
  });
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid lifecycle review." },
      { status: 400 },
    );
  }

  const result = await bulkReviewOrderLifecycles({
    shopId,
    snapshotIds: parsed.data.snapshotIds,
    state: parsed.data.lifecycleState,
  });
  if (result.reviewed === 0) {
    return jsonResponse(
      { ok: false, message: "None of the selected orders still require lifecycle review. Refresh the page and try again." },
      { status: 409 },
    );
  }

  const skippedMessage = result.skipped > 0
    ? ` ${result.skipped} order(s) were skipped because they were already resolved or unavailable.`
    : "";
  return jsonResponse({
    ok: true,
    message: `${result.reviewed} order lifecycle(s) confirmed.${skippedMessage} Production usage updates immediately; rebuild affected reporting periods to refresh derived obligations.`,
  });
};

function normaliseOrigin(value: string | null) {
  return value === "webhook" || value === "reconciliation" || value === "historical_import" ? value : "all";
}

function formatOrigin(origin: string) {
  if (origin === "webhook") return "Webhook";
  if (origin === "historical_import") return "Historical import";
  return "Reconciliation";
}

function originTone(origin: string) {
  if (origin === "webhook") return "success";
  if (origin === "historical_import") return "info";
  return "caution";
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
  const review = url.searchParams.get("review") === "required" ? "required" : "all";

  const where = {
    shopId,
    currentForOrderRecord: { isNot: null },
    ...(origin === "all" ? {} : { origin }),
    ...(review === "required"
      ? {
          orderRecord: {
            OR: [
              { lifecycle: { is: null } },
              { lifecycle: { is: { state: { in: ["unknown", "review_required"] } } } },
            ],
          },
        }
      : {}),
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
      orderRecord: {
        select: {
          lifecycle: { select: { state: true, reviewReason: true } },
        },
      },
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

  return jsonResponse({
    origin,
    startDate,
    endDate,
    review,
    nextCursor,
    snapshots: pageSnapshots.map<SnapshotListRow>((snapshot) => ({
      id: snapshot.id,
      orderNumber: snapshot.orderNumber ?? "Unnumbered order",
      customerDisplayName: snapshot.customerDisplayName ?? null,
      shopifyAdminUrl: shopifyAdminOrderUrl(shopId, snapshot.shopifyOrderId),
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
      lifecycleState: snapshot.orderRecord.lifecycle?.state ?? "unknown",
      lifecycleReviewReason: snapshot.orderRecord.lifecycle?.reviewReason ?? null,
    })),
  });
};

function buildOrderHistoryHref({
  origin,
  startDate,
  endDate,
  cursor,
  playwrightShop,
  review,
}: {
  origin: string;
  startDate?: string;
  endDate?: string;
  cursor?: string | null;
  playwrightShop?: string | null;
  review?: string;
}) {
  const params = new URLSearchParams();
  if (origin && origin !== "all") params.set("origin", origin);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (cursor) params.set("cursor", cursor);
  if (playwrightShop) params.set("__playwrightShop", playwrightShop);
  if (review === "required") params.set("review", "required");
  const query = params.toString();
  return query ? `/app/order-history?${query}` : "/app/order-history";
}

function FilterLink({
  currentOrigin,
  targetOrigin,
  label,
  startDate,
  endDate,
  playwrightShop,
  review,
}: {
  currentOrigin: string;
  targetOrigin: string;
  label: string;
  startDate?: string;
  endDate?: string;
  playwrightShop?: string | null;
  review?: string;
}) {
  const isActive = currentOrigin === targetOrigin;
  const href = buildOrderHistoryHref({
    origin: targetOrigin,
    startDate,
    endDate,
    playwrightShop,
    review,
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
  const { origin, startDate, endDate, review, nextCursor, snapshots } = useLoaderData<typeof loader>();
  const { formatMoney } = useAppLocalization();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const playwrightShop = searchParams.get("__playwrightShop");
  const actionData = useActionData<typeof action>();
  const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<Set<string>>(() => new Set());
  const reviewableSnapshotIds = snapshots
    .filter((snapshot: SnapshotListRow) => snapshot.lifecycleState === "unknown" || snapshot.lifecycleState === "review_required")
    .map((snapshot: SnapshotListRow) => snapshot.id);
  const allReviewableSelected = reviewableSnapshotIds.length > 0
    && reviewableSnapshotIds.every((snapshotId: string) => selectedSnapshotIds.has(snapshotId));

  function setSnapshotSelected(snapshotId: string, selected: boolean) {
    setSelectedSnapshotIds((current) => {
      const next = new Set(current);
      if (selected) next.add(snapshotId);
      else next.delete(snapshotId);
      return next;
    });
  }

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

    const query = params.toString();
    navigate(query ? `?${query}` : ".");
  }

  return (
    <>
      <ui-title-bar title="Order History" />

      <s-page>
        <s-section heading="Snapshots">
          <div style={{ display: "grid", gap: "1rem" }}>
            <HelpText>Order History shows immutable financial snapshots captured at order time or later reconciliation. Net contribution here means revenue remaining after resolved production costs for the order lines.</HelpText>
            {review === "required" ? (
              <s-banner tone="warning">
                <s-text>Showing orders excluded from finalized reporting because lifecycle evidence needs merchant review. Open an order to confirm whether it is active, canceled, or refunded.</s-text>
              </s-banner>
            ) : null}
            {actionData ? (
              <s-banner tone={actionData.ok ? "success" : "critical"}>
                <s-text>{actionData.message}</s-text>
              </s-banner>
            ) : null}
            <div
              aria-live="polite"
              style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}
            >
              {actionData?.message ?? ""}
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <strong>Origin filter</strong>
              <FilterLink
                currentOrigin={origin}
                targetOrigin="all"
                label="All"
                startDate={startDate}
                endDate={endDate}
                playwrightShop={playwrightShop}
                review={review}
              />
              <Link
                to={buildOrderHistoryHref({ origin, startDate, endDate, review: review === "required" ? "all" : "required", playwrightShop })}
              >
                {review === "required" ? "Show all lifecycle states" : "Review excluded orders"}
              </Link>
              <FilterLink
                currentOrigin={origin}
                targetOrigin="webhook"
                label="Webhook"
                startDate={startDate}
                endDate={endDate}
                playwrightShop={playwrightShop}
                review={review}
              />
              <FilterLink
                currentOrigin={origin}
                targetOrigin="reconciliation"
                label="Reconciliation"
                startDate={startDate}
                endDate={endDate}
                playwrightShop={playwrightShop}
                review={review}
              />
              <FilterLink
                currentOrigin={origin}
                targetOrigin="historical_import"
                label="Historical import"
                startDate={startDate}
                endDate={endDate}
                playwrightShop={playwrightShop}
                review={review}
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
                  <Link to={buildOrderHistoryHref({ origin, playwrightShop })} style={{ alignSelf: "center" }}>
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
              <Form method="post" style={{ display: "grid", gap: "1rem" }}>
                <input type="hidden" name="intent" value="bulk-resolve-lifecycle" />
                {reviewableSnapshotIds.map((snapshotId: string) => selectedSnapshotIds.has(snapshotId) ? (
                  <input key={snapshotId} type="hidden" name="snapshotIds" value={snapshotId} />
                ) : null)}
                {reviewableSnapshotIds.length > 0 ? (
                  <div style={{ display: "grid", gap: "0.75rem", padding: "1rem", border: "1px solid var(--p-color-border, #d2d5d8)", borderRadius: "0.75rem" }}>
                    <strong>Bulk lifecycle review</strong>
                    <HelpText>Select orders below, choose the lifecycle they share, and confirm that you reviewed them in Shopify. Partially refunded orders must be reviewed individually because line-level refund quantities are required.</HelpText>
                    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end" }}>
                      <label style={{ display: "grid", gap: "0.35rem", minWidth: "220px" }}>
                        <span>Lifecycle status</span>
                        <select name="lifecycleState" defaultValue="active" style={{ padding: "0.65rem", borderRadius: "0.5rem" }}>
                          <option value="active">Active</option>
                          <option value="fully_refunded">Fully refunded</option>
                          <option value="canceled">Canceled</option>
                        </select>
                      </label>
                      <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", flex: "1 1 320px" }}>
                        <input type="checkbox" name="confirmLifecycle" />
                        <span>I reviewed the selected orders in Shopify and confirm this status.</span>
                      </label>
                      <s-button type="submit" variant="primary">Confirm selected orders</s-button>
                    </div>
                  </div>
                ) : null}
                <s-table>
                <s-table-header-row>
                  <s-table-header>
                    <input
                      type="checkbox"
                      aria-label="Select all orders requiring lifecycle review on this page"
                      checked={allReviewableSelected}
                      disabled={reviewableSnapshotIds.length === 0}
                      onChange={(event) => {
                        const selected = event.currentTarget.checked;
                        setSelectedSnapshotIds((current) => {
                          const next = new Set(current);
                          for (const snapshotId of reviewableSnapshotIds) {
                            if (selected) next.add(snapshotId);
                            else next.delete(snapshotId);
                          }
                          return next;
                        });
                      }}
                    />
                  </s-table-header>
                  <s-table-header listSlot="primary">Order</s-table-header>
                  <s-table-header listSlot="inline">Customer</s-table-header>
                  <s-table-header listSlot="inline">Origin</s-table-header>
                  <s-table-header listSlot="inline">Created</s-table-header>
                  <s-table-header listSlot="inline">Lifecycle</s-table-header>
                  <s-table-header listSlot="secondary" format="numeric">Lines</s-table-header>
                  <s-table-header listSlot="secondary" format="numeric">Adjustments</s-table-header>
                  <s-table-header listSlot="labeled" format="currency">Net contribution</s-table-header>
                  <s-table-header>Details</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {snapshots.map((snapshot: SnapshotListRow) => (
                    <s-table-row key={snapshot.id}>
                      <s-table-cell>
                        {snapshot.lifecycleState === "unknown" || snapshot.lifecycleState === "review_required" ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${snapshot.orderNumber} for lifecycle review`}
                            checked={selectedSnapshotIds.has(snapshot.id)}
                            onChange={(event) => setSnapshotSelected(snapshot.id, event.currentTarget.checked)}
                          />
                        ) : null}
                      </s-table-cell>
                      <s-table-cell>
                        <div style={{ display: "grid", gap: "0.25rem" }}>
                          <span>{snapshot.orderNumber}</span>
                          {snapshot.shopifyAdminUrl ? (
                            <a href={snapshot.shopifyAdminUrl} target="_blank" rel="noreferrer">Open in Shopify</a>
                          ) : null}
                        </div>
                      </s-table-cell>
                      <s-table-cell>{snapshot.customerDisplayName ?? "-"}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={originTone(snapshot.origin)}>{formatOrigin(snapshot.origin)}</s-badge>
                      </s-table-cell>
                      <s-table-cell>{new Date(snapshot.createdAt).toLocaleString()}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={snapshot.lifecycleState === "active" || snapshot.lifecycleState === "partially_refunded" ? "success" : snapshot.lifecycleState === "unknown" || snapshot.lifecycleState === "review_required" ? "caution" : "neutral"}>
                          {snapshot.lifecycleState.replaceAll("_", " ")}
                        </s-badge>
                      </s-table-cell>
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
              </Form>
            )}

            {nextCursor ? (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Link
                  to={buildOrderHistoryHref({
                    origin,
                    startDate,
                    endDate,
                    cursor: nextCursor,
                    playwrightShop,
                    review,
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
