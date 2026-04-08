import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError, useSearchParams } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.server";
import {
  ACCEPTED_RECEIPT_CONTENT_TYPES,
  logDisbursement,
  MAX_RECEIPT_BYTES,
} from "../services/disbursementService.server";
import { closeReportingPeriod } from "../services/reportingPeriodService.server";
import { createReceiptStorage } from "../services/receiptStorage.server";
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

type DisbursementRow = {
  id: string;
  causeId: string;
  causeName: string;
  amount: string;
  paidAt: string;
  paymentMethod: string;
  referenceId: string | null;
  receiptUrl: string | null;
};

type DisbursementFormState = {
  periodId: string;
  causeId: string;
  amount: string;
  paidAt: string;
  paymentMethod: string;
  referenceId: string;
  receipt: string;
};

type ReportingActionData = {
  ok: boolean;
  message: string;
  fieldErrors?: Partial<Record<keyof DisbursementFormState, string[]>>;
};

const disbursementSchema = z.object({
  periodId: z.string().trim().cuid("Reporting period id is invalid."),
  causeId: z.string().trim().cuid("Cause id is invalid."),
  amount: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Number(value)) && Number(value) > 0, "Amount must be greater than 0."),
  paidAt: z.string().trim().min(1, "Paid date is required."),
  paymentMethod: z.string().trim().min(1, "Payment method is required."),
  referenceId: z.string().trim().optional(),
  receipt: z.string().trim().optional(),
});

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

  const selectedPeriod = periods.find((period) => period.id === requestedPeriodId) ?? periods[0];

  const [snapshotLines, closedAllocations, expensesSummary, chargesSummary, charges, disbursements] =
    await Promise.all([
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
      prisma.disbursement.findMany({
        where: {
          shopId,
          periodId: selectedPeriod.id,
        },
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          causeId: true,
          amount: true,
          paidAt: true,
          paymentMethod: true,
          referenceId: true,
          receiptFileKey: true,
          cause: {
            select: {
              name: true,
            },
          },
        },
      }),
    ]);

  const allocationMap = new Map<string, { causeId: string; causeName: string; is501c3: boolean; allocated: Prisma.Decimal }>();
  let totalNetContribution = ZERO;

  for (const line of snapshotLines) {
    const adjustmentTotal = line.adjustments.reduce((sum, adj) => sum.add(adj.netContribAdj), ZERO);
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
  const receiptStorage = createReceiptStorage();
  const disbursementRows = await Promise.all(
    disbursements.map(async (disbursement) => ({
      id: disbursement.id,
      causeId: disbursement.causeId,
      causeName: disbursement.cause.name,
      amount: disbursement.amount.toString(),
      paidAt: disbursement.paidAt.toISOString(),
      paymentMethod: disbursement.paymentMethod,
      referenceId: disbursement.referenceId ?? null,
      receiptUrl: disbursement.receiptFileKey
        ? await receiptStorage.getSignedReadUrl({
            key: disbursement.receiptFileKey,
            expiresInSeconds: 60 * 60,
          })
        : null,
    })),
  );

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
      disbursements: disbursementRows,
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

  if (intent === "log-disbursement") {
    const receiptEntry = formData.get("receipt");
    const parsed = disbursementSchema.safeParse({
      periodId: formData.get("periodId")?.toString() ?? "",
      causeId: formData.get("causeId")?.toString() ?? "",
      amount: formData.get("amount")?.toString() ?? "",
      paidAt: formData.get("paidAt")?.toString() ?? "",
      paymentMethod: formData.get("paymentMethod")?.toString() ?? "",
      referenceId: formData.get("referenceId")?.toString() ?? "",
      receipt: receiptEntry instanceof File ? receiptEntry.name : "",
    });

    if (!parsed.success) {
      return Response.json(
        {
          ok: false,
          message: parsed.error.issues[0]?.message ?? "Invalid disbursement.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    if (receiptEntry instanceof File && receiptEntry.size > MAX_RECEIPT_BYTES) {
      return Response.json(
        {
          ok: false,
          message: "Receipt file must be 10 MB or smaller.",
          fieldErrors: { receipt: ["Receipt file must be 10 MB or smaller."] },
        },
        { status: 400 },
      );
    }

    if (
      receiptEntry instanceof File &&
      receiptEntry.size > 0 &&
      !ACCEPTED_RECEIPT_CONTENT_TYPES.has(receiptEntry.type || "application/octet-stream")
    ) {
      return Response.json(
        {
          ok: false,
          message: "Receipt must be a PDF, PNG, or JPEG file.",
          fieldErrors: { receipt: ["Receipt must be a PDF, PNG, or JPEG file."] },
        },
        { status: 400 },
      );
    }

    try {
      await logDisbursement(shopId, {
        periodId: parsed.data.periodId,
        causeId: parsed.data.causeId,
        amount: parsed.data.amount,
        paidAt: new Date(parsed.data.paidAt),
        paymentMethod: parsed.data.paymentMethod,
        referenceId: parsed.data.referenceId ?? "",
        receipt:
          receiptEntry instanceof File && receiptEntry.size > 0
            ? {
                filename: receiptEntry.name,
                contentType: receiptEntry.type || "application/octet-stream",
                body: new Uint8Array(await receiptEntry.arrayBuffer()),
              }
            : null,
      });

      return Response.json({ ok: true, message: "Disbursement logged." });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          message: error instanceof Error ? error.message : "Unable to log disbursement.",
        },
        { status: 400 },
      );
    }
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

export default function ReportingPage() {
  const { periods, selectedPeriodId, summary } = useLoaderData<typeof loader>();
  const closeFetcher = useFetcher<ReportingActionData>();
  const disbursementFetcher = useFetcher<ReportingActionData>();
  const [searchParams] = useSearchParams();
  const { formatMoney, formatPct, locale } = useAppLocalization();
  const closeDialogRef = useRef<HTMLDialogElement>(null);
  const disbursementFormRef = useRef<HTMLFormElement>(null);
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

  useEffect(() => {
    if (disbursementFetcher.data?.ok) {
      disbursementFormRef.current?.reset();
    }
  }, [disbursementFetcher.data]);

  const selectedPeriod = summary?.period ?? null;
  const statusMessage = closeFetcher.data?.message ?? disbursementFetcher.data?.message ?? "";

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
    closeFetcher.submit(fd, { method: "post" });
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
  const disbursementCauseOptions = allocationRows.filter((allocation) =>
    new Prisma.Decimal(allocation.remaining).greaterThan(0),
  );
  const disbursements: DisbursementRow[] = summary.disbursements;

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
        {closeFetcher.data && !closeFetcher.data.ok && (
          <s-banner tone="critical">
            <s-text>{closeFetcher.data.message}</s-text>
          </s-banner>
        )}
        {closeFetcher.data?.ok && closeFetcher.data.message && (
          <s-banner tone="success">
            <s-text>{closeFetcher.data.message}</s-text>
          </s-banner>
        )}
        {disbursementFetcher.data && !disbursementFetcher.data.ok && (
          <s-banner tone="critical">
            <s-text>{disbursementFetcher.data.message}</s-text>
          </s-banner>
        )}
        {disbursementFetcher.data?.ok && disbursementFetcher.data.message && (
          <s-banner tone="success">
            <s-text>{disbursementFetcher.data.message}</s-text>
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
              <s-button
                variant="primary"
                onClick={() => setCloseDialogOpen(true)}
                disabled={closeFetcher.state !== "idle"}
              >
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

          {selectedPeriod?.status === "CLOSED" ? (
            <>
              <s-section heading="Log disbursement">
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <s-text color="subdued">
                    Record funds paid out to a Cause for this closed period. Remaining balances update immediately.
                  </s-text>
                  {disbursementCauseOptions.length === 0 ? (
                    <s-banner tone="info">
                      <s-text>All available allocations for this period have already been fully disbursed.</s-text>
                    </s-banner>
                  ) : (
                    <disbursementFetcher.Form
                      ref={disbursementFormRef}
                      method="post"
                      encType="multipart/form-data"
                      style={{ display: "grid", gap: "0.9rem" }}
                    >
                      <input type="hidden" name="intent" value="log-disbursement" />
                      <input type="hidden" name="periodId" value={selectedPeriod.id} />

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor="disbursement-cause">Cause</label>
                        <select id="disbursement-cause" name="causeId" defaultValue={disbursementCauseOptions[0]?.causeId ?? ""}>
                          {disbursementCauseOptions.map((allocation) => (
                            <option key={allocation.causeId} value={allocation.causeId}>
                              {allocation.causeName} ({formatMoney(allocation.remaining)} remaining)
                            </option>
                          ))}
                        </select>
                        {disbursementFetcher.data?.fieldErrors?.causeId?.map((message) => (
                          <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                        ))}
                      </div>

                      <div style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="disbursement-amount">Amount</label>
                          <input id="disbursement-amount" name="amount" type="number" min="0.01" step="0.01" />
                          {disbursementFetcher.data?.fieldErrors?.amount?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="disbursement-paid-at">Paid date</label>
                          <input id="disbursement-paid-at" name="paidAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
                          {disbursementFetcher.data?.fieldErrors?.paidAt?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="disbursement-method">Payment method</label>
                          <input id="disbursement-method" name="paymentMethod" type="text" placeholder="ACH, check, wire..." />
                          {disbursementFetcher.data?.fieldErrors?.paymentMethod?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="disbursement-reference">Reference id</label>
                          <input id="disbursement-reference" name="referenceId" type="text" placeholder="Optional payout or check id" />
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor="disbursement-receipt">Receipt</label>
                        <input id="disbursement-receipt" name="receipt" type="file" accept=".pdf,image/*" />
                        <s-text color="subdued">Optional. PDF or image, up to 10 MB.</s-text>
                        <s-text color="subdued">
                          This receipt may be publicly visible. Redact all personal information before uploading.
                        </s-text>
                        {disbursementFetcher.data?.fieldErrors?.receipt?.map((message) => (
                          <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                        ))}
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                          type="submit"
                          disabled={disbursementFetcher.state !== "idle"}
                          style={{
                            borderRadius: "999px",
                            border: "1px solid #111",
                            background: "#111",
                            color: "#fff",
                            padding: "0.65rem 1rem",
                            font: "inherit",
                            cursor: disbursementFetcher.state !== "idle" ? "not-allowed" : "pointer",
                            opacity: disbursementFetcher.state !== "idle" ? 0.6 : 1,
                          }}
                        >
                          Log disbursement
                        </button>
                      </div>
                    </disbursementFetcher.Form>
                  )}
                </div>
              </s-section>

              <s-section heading="Disbursements">
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Cause</s-table-header>
                    <s-table-header listSlot="secondary">Paid</s-table-header>
                    <s-table-header listSlot="secondary">Method</s-table-header>
                    <s-table-header listSlot="secondary">Reference</s-table-header>
                    <s-table-header listSlot="secondary">Receipt</s-table-header>
                    <s-table-header listSlot="labeled" format="currency">Amount</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {disbursements.length === 0 ? (
                      <s-table-row>
                        <s-table-cell>No disbursements logged for this period.</s-table-cell>
                        <s-table-cell></s-table-cell>
                        <s-table-cell></s-table-cell>
                        <s-table-cell></s-table-cell>
                        <s-table-cell></s-table-cell>
                        <s-table-cell></s-table-cell>
                      </s-table-row>
                    ) : (
                      disbursements.map((disbursement) => (
                        <s-table-row key={disbursement.id}>
                          <s-table-cell>{disbursement.causeName}</s-table-cell>
                          <s-table-cell>{formatDate(disbursement.paidAt, locale)}</s-table-cell>
                          <s-table-cell>{disbursement.paymentMethod}</s-table-cell>
                          <s-table-cell>{disbursement.referenceId ?? "—"}</s-table-cell>
                          <s-table-cell>
                            {disbursement.receiptUrl ? (
                              <a href={disbursement.receiptUrl} target="_blank" rel="noreferrer">
                                View receipt
                              </a>
                            ) : "—"}
                          </s-table-cell>
                          <s-table-cell>{formatMoney(disbursement.amount)}</s-table-cell>
                        </s-table-row>
                      ))
                    )}
                  </s-table-body>
                </s-table>
              </s-section>
            </>
          ) : null}

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
              disabled={closeFetcher.state !== "idle"}
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
