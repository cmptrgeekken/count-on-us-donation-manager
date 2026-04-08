import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError, useSearchParams } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { closeReportingPeriod } from "../services/reportingPeriodService.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { useAppLocalization } from "../utils/use-app-localization";

const ZERO = new Prisma.Decimal(0);
const ADJUSTMENT_RATIO_GUARD = new Prisma.Decimal(10);

type PeriodRow = {
  id: string;
  status: string;
  source: string;
  startDate: string;
  endDate: string;
  shopifyPayoutId: string | null;
  closedAt: string | null;
};

type AllocationRow = {
  causeId: string;
  causeName: string;
  is501c3: boolean;
  allocated: string;
  disbursed: string;
  remaining: string;
};

type ChargeRow = {
  id: string;
  description: string;
  amount: string;
  processedAt: string | null;
};

function addAllocation(
  allocations: Map<string, { causeId: string; causeName: string; is501c3: boolean; allocated: Prisma.Decimal }>,
  allocation: { causeId: string; causeName: string; is501c3: boolean; allocated: Prisma.Decimal },
) {
  const current = allocations.get(allocation.causeId);
  if (!current) {
    allocations.set(allocation.causeId, allocation);
    return;
  }

  allocations.set(allocation.causeId, {
    ...current,
    allocated: current.allocated.add(allocation.allocated),
  });
}

function computeAdjustedAllocationAmount({
  baseAmount,
  lineNetContribution,
  lineAdjustmentTotal,
}: {
  baseAmount: Prisma.Decimal;
  lineNetContribution: Prisma.Decimal;
  lineAdjustmentTotal: Prisma.Decimal;
}) {
  if (lineNetContribution.equals(0) || lineAdjustmentTotal.equals(0)) {
    return baseAmount;
  }

  const ratio = lineAdjustmentTotal.div(lineNetContribution);
  if (ratio.abs().greaterThan(ADJUSTMENT_RATIO_GUARD)) {
    return baseAmount;
  }

  return baseAmount.add(baseAmount.mul(ratio));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const url = new URL(request.url);
  const requestedPeriodId = url.searchParams.get("periodId") ?? "";

  const periods = await prisma.reportingPeriod.findMany({
    where: { shopId },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      source: true,
      startDate: true,
      endDate: true,
      shopifyPayoutId: true,
      closedAt: true,
    },
  });

  if (periods.length === 0) {
    return Response.json({
      periods: [],
      selectedPeriodId: null,
      summary: null,
    });
  }

  const selectedPeriod =
    periods.find((period) => period.id === requestedPeriodId) ?? periods[0];

  const [snapshotLines, closedAllocations, expensesSummary, chargesSummary, charges] = await Promise.all([
    prisma.orderSnapshotLine.findMany({
      where: {
        shopId,
        snapshot: {
          createdAt: {
            gte: selectedPeriod.startDate,
            lt: selectedPeriod.endDate,
          },
        },
      },
      select: {
        netContribution: true,
        adjustments: { select: { netContribAdj: true } },
        causeAllocations: {
          select: { causeId: true, causeName: true, is501c3: true, amount: true },
        },
      },
    }),
    prisma.causeAllocation.findMany({
      where: {
        shopId,
        periodId: selectedPeriod.id,
      },
      select: {
        causeId: true,
        causeName: true,
        is501c3: true,
        allocated: true,
        disbursed: true,
      },
    }),
    prisma.businessExpense.aggregate({
      where: {
        shopId,
        expenseDate: {
          gte: selectedPeriod.startDate,
          lt: selectedPeriod.endDate,
        },
      },
      _sum: { amount: true },
    }),
    prisma.shopifyChargeTransaction.aggregate({
      where: {
        shopId,
        OR: [
          { periodId: selectedPeriod.id },
          {
            periodId: null,
            processedAt: {
              gte: selectedPeriod.startDate,
              lt: selectedPeriod.endDate,
            },
          },
        ],
      },
      _sum: { amount: true },
    }),
    prisma.shopifyChargeTransaction.findMany({
      where: {
        shopId,
        OR: [
          { periodId: selectedPeriod.id },
          {
            periodId: null,
            processedAt: {
              gte: selectedPeriod.startDate,
              lt: selectedPeriod.endDate,
            },
          },
        ],
      },
      orderBy: [{ processedAt: "desc" }, { createdAt: "desc" }],
      take: 15,
      select: {
        id: true,
        description: true,
        amount: true,
        processedAt: true,
      },
    }),
  ]);

  const allocationMap = new Map<string, { causeId: string; causeName: string; is501c3: boolean; allocated: Prisma.Decimal }>();

  let totalNetContribution = ZERO;

  for (const line of snapshotLines) {
    const adjustmentTotal = line.adjustments.reduce(
      (sum, adj) => sum.add(adj.netContribAdj),
      ZERO,
    );
    totalNetContribution = totalNetContribution.add(line.netContribution).add(adjustmentTotal);

    for (const allocation of line.causeAllocations) {
      const adjusted = computeAdjustedAllocationAmount({
        baseAmount: allocation.amount,
        lineNetContribution: line.netContribution,
        lineAdjustmentTotal: adjustmentTotal,
      });

      addAllocation(allocationMap, {
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        allocated: adjusted,
      });
    }
  }

  const expenseTotal = expensesSummary._sum.amount ?? ZERO;
  const shopifyCharges = chargesSummary._sum.amount ?? ZERO;

  const useClosedAllocations = selectedPeriod.status === "CLOSED" && closedAllocations.length > 0;
  const allocationRows = useClosedAllocations
    ? closedAllocations.map((allocation) => ({
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        allocated: allocation.allocated,
        disbursed: allocation.disbursed,
      }))
    : Array.from(allocationMap.values()).map((allocation) => ({
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        is501c3: allocation.is501c3,
        allocated: allocation.allocated,
        disbursed: ZERO,
      }));

  const allocation501c3Total = allocationRows.reduce(
    (sum, allocation) => (allocation.is501c3 ? sum.add(allocation.allocated) : sum),
    ZERO,
  );

  const deductionPool = expenseTotal.add(allocation501c3Total);
  const taxableExposure = totalNetContribution.sub(deductionPool);
  const widgetTaxSuppressed = taxableExposure.lessThanOrEqualTo(0);

  return Response.json({
    periods: periods.map<PeriodRow>((period) => ({
      id: period.id,
      status: period.status,
      source: period.source,
      startDate: period.startDate.toISOString(),
      endDate: period.endDate.toISOString(),
      shopifyPayoutId: period.shopifyPayoutId ?? null,
      closedAt: period.closedAt?.toISOString() ?? null,
    })),
    selectedPeriodId: selectedPeriod.id,
    summary: {
      period: {
        id: selectedPeriod.id,
        status: selectedPeriod.status,
        startDate: selectedPeriod.startDate.toISOString(),
        endDate: selectedPeriod.endDate.toISOString(),
        shopifyPayoutId: selectedPeriod.shopifyPayoutId ?? null,
        closedAt: selectedPeriod.closedAt?.toISOString() ?? null,
      },
      track1: {
        totalNetContribution: totalNetContribution.toString(),
        shopifyCharges: shopifyCharges.toString(),
        donationPool: totalNetContribution.sub(shopifyCharges).toString(),
        allocations: allocationRows.map((allocation) => ({
          causeId: allocation.causeId,
          causeName: allocation.causeName,
          is501c3: allocation.is501c3,
          allocated: allocation.allocated.toString(),
          disbursed: allocation.disbursed.toString(),
        })),
      },
      track2: {
        deductionPool: deductionPool.toString(),
        taxableExposure: taxableExposure.toString(),
        widgetTaxSuppressed,
        effectiveTaxRate: null,
        taxDeductionMode: null,
        businessExpenseTotal: expenseTotal.toString(),
        allocation501c3Total: allocation501c3Total.toString(),
      },
      charges: charges.map<ChargeRow>((charge) => ({
        id: charge.id,
        description: charge.description ?? "Shopify charge",
        amount: charge.amount.toString(),
        processedAt: charge.processedAt?.toISOString() ?? null,
      })),
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "close-period") {
    const periodId = formData.get("periodId")?.toString() ?? "";
    if (!periodId) {
      return Response.json({ ok: false, message: "Reporting period id is required." }, { status: 400 });
    }

    await closeReportingPeriod(shopId, periodId);
    return Response.json({ ok: true, message: "Reporting period closed." });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

export default function ReportingPage() {
  const { periods, selectedPeriodId, summary } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const [searchParams] = useSearchParams();
  const { formatMoney, formatPct, locale } = useAppLocalization();
  const closeDialogRef = useRef<HTMLDialogElement>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  useEffect(() => {
    const dialog = closeDialogRef.current;
    if (!dialog) return;
    if (closeDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!closeDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [closeDialogOpen]);

  const selectedPeriod = summary?.period ?? null;
  const statusMessage = fetcher.data?.message ?? "";

  const periodOptions = useMemo(
    () =>
      periods.map((period: PeriodRow) => ({
        id: period.id,
        label: `${formatDateRange(period.startDate, period.endDate, locale)} · ${period.status}`,
      })),
    [periods, locale],
  );

  function setPeriod(periodId: string) {
    const params = new URLSearchParams(searchParams);
    params.set("periodId", periodId);
    window.location.search = params.toString();
  }

  function closePeriod() {
    if (!selectedPeriod) return;
    const fd = new FormData();
    fd.append("intent", "close-period");
    fd.append("periodId", selectedPeriod.id);
    fetcher.submit(fd, { method: "post" });
    setCloseDialogOpen(false);
  }

  if (!summary) {
    return (
      <>
        <ui-title-bar title="Reporting" />
        <s-page>
          <s-section heading="No reporting periods yet">
            <s-text>Reporting periods will appear once a Shopify payout is synced.</s-text>
          </s-section>
        </s-page>
      </>
    );
  }

  const allocationRows: AllocationRow[] = summary.track1.allocations.map((allocation: AllocationRow) => {
    const remaining = new Prisma.Decimal(allocation.allocated).sub(new Prisma.Decimal(allocation.disbursed));
    return {
      causeId: allocation.causeId,
      causeName: allocation.causeName,
      is501c3: allocation.is501c3,
      allocated: allocation.allocated,
      disbursed: allocation.disbursed,
      remaining: remaining.toString(),
    };
  });

  return (
    <>
      <ui-title-bar title="Reporting" />

      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
        }}
      >
        {statusMessage}
      </div>

      <s-page>
        {fetcher.data && !fetcher.data.ok && (
          <s-banner tone="critical">
            <s-text>{fetcher.data.message}</s-text>
          </s-banner>
        )}
        {fetcher.data?.ok && fetcher.data.message && (
          <s-banner tone="success">
            <s-text>{fetcher.data.message}</s-text>
          </s-banner>
        )}

        <s-section>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <strong>Reporting period</strong>
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <label htmlFor="reporting-period-select">Select period</label>
              <select
                id="reporting-period-select"
                value={selectedPeriodId ?? ""}
                onChange={(event) => setPeriod(event.currentTarget.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "0.75rem",
                  borderRadius: "0.75rem",
                  border: "1px solid var(--p-color-border, #d2d5d8)",
                  background: "var(--p-color-bg-surface, #fff)",
                  color: "var(--p-color-text, #303030)",
                  font: "inherit",
                }}
              >
                {periodOptions.map((option: { id: string; label: string }) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
            {selectedPeriod ? (
              <s-text color="subdued">
                {formatDateRange(selectedPeriod.startDate, selectedPeriod.endDate, locale)} · {selectedPeriod.status}
              </s-text>
            ) : null}
          </div>
        </s-section>

        {selectedPeriod?.status === "OPEN" ? (
          <s-section>
            <s-banner tone="info">
              <s-text>This period is open. Closing will materialize cause allocations and lock the period.</s-text>
            </s-banner>
            <div style={{ marginTop: "0.75rem" }}>
              <s-button variant="primary" onClick={() => setCloseDialogOpen(true)} disabled={fetcher.state !== "idle"}>
                Close reporting period
              </s-button>
            </div>
          </s-section>
        ) : null}

        <div style={{ display: "grid", gap: "1.5rem" }}>
          <s-section heading="Track 1 — Donation pool">
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <strong>Total net contribution</strong>
                  <s-text color="subdued">{formatMoney(summary.track1.totalNetContribution)}</s-text>
                </div>
                <div>
                  <strong>Shopify charges</strong>
                  <s-text color="subdued">{formatMoney(summary.track1.shopifyCharges)}</s-text>
                </div>
                <div>
                  <strong>Donation pool (after charges)</strong>
                  <s-text color="subdued">{formatMoney(summary.track1.donationPool)}</s-text>
                </div>
              </div>
            </div>
          </s-section>

          <s-section heading="Cause allocations">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Cause</s-table-header>
                <s-table-header listSlot="inline">501(c)3</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Allocated</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Disbursed</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Remaining</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {allocationRows.length === 0 ? (
                  <s-table-row>
                    <s-table-cell>No allocations yet.</s-table-cell>
                    <s-table-cell></s-table-cell>
                    <s-table-cell></s-table-cell>
                    <s-table-cell></s-table-cell>
                    <s-table-cell></s-table-cell>
                  </s-table-row>
                ) : (
                  allocationRows.map((allocation) => (
                    <s-table-row key={allocation.causeId}>
                      <s-table-cell>{allocation.causeName}</s-table-cell>
                      <s-table-cell>{allocation.is501c3 ? "Yes" : "No"}</s-table-cell>
                      <s-table-cell>{formatMoney(allocation.allocated)}</s-table-cell>
                      <s-table-cell>{formatMoney(allocation.disbursed)}</s-table-cell>
                      <s-table-cell>{formatMoney(allocation.remaining)}</s-table-cell>
                    </s-table-row>
                  ))
                )}
              </s-table-body>
            </s-table>
          </s-section>

          <s-section heading="Shopify charges">
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <s-text color="subdued">Charges deducted from the donation pool for this period.</s-text>
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Description</s-table-header>
                  <s-table-header listSlot="secondary">Processed</s-table-header>
                  <s-table-header listSlot="labeled" format="currency">Amount</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {summary.charges.length === 0 ? (
                    <s-table-row>
                      <s-table-cell>No charges synced for this period.</s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                    </s-table-row>
                  ) : (
                    summary.charges.map((charge: ChargeRow) => (
                      <s-table-row key={charge.id}>
                        <s-table-cell>{charge.description}</s-table-cell>
                        <s-table-cell>{charge.processedAt ? formatDate(charge.processedAt, locale) : "—"}</s-table-cell>
                        <s-table-cell>{formatMoney(charge.amount)}</s-table-cell>
                      </s-table-row>
                    ))
                  )}
                </s-table-body>
              </s-table>
            </div>
          </s-section>

          <s-section heading="Track 2 — Tax estimation">
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                <div>
                  <strong>Deduction pool</strong>
                  <s-text color="subdued">{formatMoney(summary.track2.deductionPool)}</s-text>
                </div>
                <div>
                  <strong>Taxable exposure</strong>
                  <s-text color="subdued">{formatMoney(summary.track2.taxableExposure)}</s-text>
                </div>
                <div>
                  <strong>Widget tax suppressed</strong>
                  <s-text color="subdued">{summary.track2.widgetTaxSuppressed ? "Yes" : "No"}</s-text>
                </div>
              </div>

              <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                <div>
                  <strong>Effective tax rate</strong>
                  <s-text color="subdued">
                    {summary.track2.effectiveTaxRate ? formatPct(summary.track2.effectiveTaxRate) : "Not configured"}
                  </s-text>
                </div>
                <div>
                  <strong>Tax deduction mode</strong>
                  <s-text color="subdued">{summary.track2.taxDeductionMode ?? "Not configured"}</s-text>
                </div>
              </div>

              <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                <div>
                  <strong>Business expenses total</strong>
                  <s-text color="subdued">{formatMoney(summary.track2.businessExpenseTotal)}</s-text>
                </div>
                <div>
                  <strong>501(c)3 allocation total</strong>
                  <s-text color="subdued">{formatMoney(summary.track2.allocation501c3Total)}</s-text>
                </div>
              </div>
            </div>
          </s-section>
        </div>
      </s-page>

      <dialog
        ref={closeDialogRef}
        onClose={() => setCloseDialogOpen(false)}
        style={{
          border: "none",
          borderRadius: "1rem",
          padding: 0,
          maxWidth: "32rem",
          width: "calc(100% - 2rem)",
        }}
      >
        <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>Close reporting period?</strong>
              <s-text color="subdued">
                This will materialize allocations and lock the period.
              </s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={() => setCloseDialogOpen(false)}
              style={{
                border: "none",
                background: "transparent",
                fontSize: "1.5rem",
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>

          <s-text>
            Are you sure you want to close this reporting period? You will not be able to edit allocations or charges afterwards.
          </s-text>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
            <s-button variant="secondary" onClick={() => setCloseDialogOpen(false)}>Cancel</s-button>
            <s-button
              variant="primary"
              tone="critical"
              disabled={fetcher.state !== "idle"}
              onClick={closePeriod}
            >
              Close period
            </s-button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Reporting] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Reporting" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading reporting. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}

function formatDateRange(startIso: string, endIso: string, locale: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function formatDate(iso: string, locale: string) {
  const date = new Date(iso);
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" });
  return formatter.format(date);
}
