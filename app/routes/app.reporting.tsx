import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError, useSearchParams } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  ACCEPTED_RECEIPT_CONTENT_TYPES,
  DisbursementError,
  disbursementErrorCodes,
  logDisbursement,
  MAX_RECEIPT_BYTES,
} from "../services/disbursementService.server";
import { closeReportingPeriod } from "../services/reportingPeriodService.server";
import { buildReportingSummary } from "../services/reportingSummary.server";
import {
  recordTaxTrueUp,
  TaxTrueUpError,
  taxTrueUpErrorCodes,
} from "../services/taxTrueUpService.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { parseOptionalNonNegativeMoney } from "../utils/money-parsing";
import { useAppLocalization } from "../utils/use-app-localization";

const ZERO = new Prisma.Decimal(0);

function floorCurrency(value: string) {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR).toString();
}

function formatTaxDeductionMode(mode: string | null | undefined) {
  switch (mode) {
    case "all_causes":
      return "All causes";
    case "non_501c3_only":
      return "Non-501(c)3 causes only";
    case "dont_deduct":
      return "Don't deduct";
    default:
      return "Not configured";
  }
}

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
  allocatedAmount: string;
  extraContributionAmount: string;
  feesCoveredAmount: string;
  paidAt: string;
  paymentMethod: string;
  referenceId: string | null;
  receiptUrl: string | null;
  applications: Array<{
    periodId: string;
    periodStartDate: string;
    periodEndDate: string;
    amount: string;
  }>;
};

type ReportingActionData = {
  ok: boolean;
  message: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

type DisbursementOption = {
  causeId: string;
  label: string;
  currentOutstanding: string;
  priorOutstanding: string;
  totalOutstanding: string;
};

type CausePayablePeriodRow = {
  periodId: string;
  periodStartDate: string;
  periodEndDate: string;
  amount: string;
};

type CausePayableRow = {
  causeId: string;
  causeName: string;
  is501c3: boolean;
  currentOutstanding: string;
  priorOutstanding: string;
  totalOutstanding: string;
  overdue: boolean;
  periods: CausePayablePeriodRow[];
};

type TaxTrueUpRow = {
  id: string;
  estimatedTax: string;
  actualTax: string;
  delta: string;
  filedAt: string;
  redistributionNotes: string | null;
  appliedPeriodId: string | null;
  redistributions: Array<{
    causeId: string;
    causeName: string;
    amount: string;
  }>;
};

const disbursementSchema = z.object({
  periodId: z.string().trim().cuid("Reporting period id is invalid."),
  causeId: z.string().trim().cuid("Cause id is invalid."),
  allocatedAmount: z
    .string()
    .trim()
    .refine((value) => value === "" || (!Number.isNaN(Number(value)) && Number(value) >= 0), "Allocated amount must be 0 or greater."),
  extraContributionAmount: z
    .string()
    .trim()
    .refine((value) => value === "" || (!Number.isNaN(Number(value)) && Number(value) >= 0), "Extra contribution must be 0 or greater."),
  feesCoveredAmount: z
    .string()
    .trim()
    .refine((value) => value === "" || (!Number.isNaN(Number(value)) && Number(value) >= 0), "Fees covered must be 0 or greater."),
  paidAt: z
    .string()
    .trim()
    .min(1, "Paid date is required.")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Paid date must be a valid date."),
  paymentMethod: z.string().trim().min(1, "Payment method is required."),
  referenceId: z.string().trim().optional(),
  receipt: z.string().trim().optional(),
});

const taxTrueUpSchema = z.object({
  periodId: z.string().trim().cuid("Reporting period id is invalid."),
  actualTax: z
    .string()
    .trim()
    .min(1, "Actual tax is required.")
    .refine((value) => !Number.isNaN(Number(value)) && Number(value) >= 0, "Actual tax must be 0 or greater."),
  filedAt: z
    .string()
    .trim()
    .min(1, "Filed date is required.")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Filed date must be a valid date."),
  redistributionNotes: z.string().trim().optional(),
  confirmShortfall: z.string().trim().optional(),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const url = new URL(request.url);
  const requestedPeriodId = url.searchParams.get("periodId") ?? "";
  return Response.json(await buildReportingSummary(shopId, requestedPeriodId));
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
      allocatedAmount: formData.get("allocatedAmount")?.toString() ?? "",
      extraContributionAmount: formData.get("extraContributionAmount")?.toString() ?? "",
      feesCoveredAmount: formData.get("feesCoveredAmount")?.toString() ?? "",
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
        allocatedAmount: parsed.data.allocatedAmount || "0",
        extraContributionAmount: parsed.data.extraContributionAmount || "0",
        feesCoveredAmount: parsed.data.feesCoveredAmount || "0",
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
      const message = error instanceof Error ? error.message : "Unable to log disbursement.";
      const fieldErrors: ReportingActionData["fieldErrors"] =
        error instanceof DisbursementError
          ? error.code === disbursementErrorCodes.ALLOCATED_EXCEEDS_REMAINING
            ? { allocatedAmount: [message] }
            : error.code === disbursementErrorCodes.ZERO_TOTAL
              ? { allocatedAmount: [message] }
              : error.code === disbursementErrorCodes.RECEIPT_TOO_LARGE || error.code === disbursementErrorCodes.RECEIPT_INVALID_TYPE
                ? { receipt: [message] }
                : error.code === disbursementErrorCodes.PERIOD_NOT_CLOSED || error.code === disbursementErrorCodes.PERIOD_NOT_FOUND
                  ? { periodId: [message] }
                : error.code === disbursementErrorCodes.PAYABLE_NOT_FOUND
                    ? { causeId: [message] }
                    : undefined
          : undefined;

      return Response.json(
        {
          ok: false,
          message,
          fieldErrors,
        },
        { status: 400 },
      );
    }
  }

  if (intent === "record-tax-true-up") {
    const parsed = taxTrueUpSchema.safeParse({
      periodId: formData.get("periodId")?.toString() ?? "",
      actualTax: formData.get("actualTax")?.toString() ?? "",
      filedAt: formData.get("filedAt")?.toString() ?? "",
      redistributionNotes: formData.get("redistributionNotes")?.toString() ?? "",
      confirmShortfall: formData.get("confirmShortfall")?.toString() ?? "",
    });

    if (!parsed.success) {
      return Response.json(
        {
          ok: false,
          message: parsed.error.issues[0]?.message ?? "Invalid tax true-up.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    let actualTax: Prisma.Decimal | null;
    try {
      actualTax = parseOptionalNonNegativeMoney(parsed.data.actualTax, "Actual tax");
    } catch (error) {
      if (error instanceof Response) {
        const message = await error.text();
        return Response.json(
          {
            ok: false,
            message,
            fieldErrors: { actualTax: [message] },
          },
          { status: error.status },
        );
      }
      throw error;
    }

    const redistributions = Array.from(formData.entries())
      .filter(([key]) => key.startsWith("redistribution:"))
      .map(([key, value]) => ({
        causeId: key.replace("redistribution:", ""),
        amount: value.toString(),
      }))
      .filter((entry) => entry.amount.trim() !== "" && entry.amount.trim() !== "0");

    try {
      await recordTaxTrueUp(shopId, {
        periodId: parsed.data.periodId,
        actualTax: actualTax ?? ZERO,
        filedAt: new Date(parsed.data.filedAt),
        redistributionNotes: parsed.data.redistributionNotes ?? "",
        confirmShortfall: parsed.data.confirmShortfall === "on",
        redistributions,
      });

      return Response.json({ ok: true, message: "Tax true-up recorded." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to record tax true-up.";
      const fieldErrors: ReportingActionData["fieldErrors"] =
        error instanceof TaxTrueUpError
          ? error.code === taxTrueUpErrorCodes.REDISTRIBUTION_MISMATCH || error.code === taxTrueUpErrorCodes.REDISTRIBUTION_REQUIRED
            ? { redistributions: [message] }
            : error.code === taxTrueUpErrorCodes.SHORTFALL_CONFIRMATION_REQUIRED
              ? { confirmShortfall: [message] }
              : error.code === taxTrueUpErrorCodes.PERIOD_NOT_CLOSED ||
                  error.code === taxTrueUpErrorCodes.PERIOD_NOT_FOUND ||
                  error.code === taxTrueUpErrorCodes.TRUE_UP_ALREADY_EXISTS
                ? { periodId: [message] }
                : error.code === taxTrueUpErrorCodes.OPEN_PERIOD_REQUIRED
                  ? { periodId: [message] }
                  : undefined
          : undefined;

      return Response.json(
        {
          ok: false,
          message,
          fieldErrors,
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
  const trueUpFetcher = useFetcher<ReportingActionData>();
  const [searchParams] = useSearchParams();
  const { formatMoney, formatPct, locale } = useAppLocalization();
  const closeDialogRef = useRef<HTMLDialogElement>(null);
  const disbursementFormRef = useRef<HTMLFormElement>(null);
  const trueUpFormRef = useRef<HTMLFormElement>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"csv" | "pdf" | null>(null);
  const [exportError, setExportError] = useState("");

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

  useEffect(() => {
    if (trueUpFetcher.data?.ok) {
      trueUpFormRef.current?.reset();
    }
  }, [trueUpFetcher.data]);

  useEffect(() => {
    if (!exportingFormat) return;
    const timeout = window.setTimeout(() => setExportingFormat(null), 2000);
    return () => window.clearTimeout(timeout);
  }, [exportingFormat]);

  const selectedPeriod = summary?.period ?? null;
  const statusMessage = closeFetcher.data?.message ?? disbursementFetcher.data?.message ?? trueUpFetcher.data?.message ?? "";
  const disbursementStatusMessage =
    disbursementFetcher.data && !disbursementFetcher.data.ok ? disbursementFetcher.data.message : "";
  const trueUpStatusMessage = trueUpFetcher.data && !trueUpFetcher.data.ok ? trueUpFetcher.data.message : "";

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

  async function exportPeriod(format: "csv" | "pdf") {
    if (!selectedPeriod) return;
    setExportError("");
    setExportingFormat(format);
    try {
      const params = new URLSearchParams(searchParams);
      params.set("periodId", selectedPeriod.id);
      params.set("format", format);

      const response = await fetch(`/app/reporting-export?${params.toString()}`, {
        credentials: "same-origin",
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Unable to export ${format.toUpperCase()}.`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `reporting-period.${format}`;
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : `Unable to export ${format.toUpperCase()}.`);
    } finally {
      setExportingFormat(null);
    }
  }

  const allocationRows: AllocationRow[] = summary
    ? summary.track1.allocations.map((allocation: AllocationRow) => {
        const remaining = new Prisma.Decimal(allocation.allocated)
          .sub(new Prisma.Decimal(allocation.disbursed))
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR);
        return {
          causeId: allocation.causeId,
          causeName: allocation.causeName,
          is501c3: allocation.is501c3,
          allocated: allocation.allocated,
          disbursed: allocation.disbursed,
          remaining: remaining.toString(),
        };
      })
    : [];
  const causePayables: CausePayableRow[] = summary?.causePayables ?? [];
  const disbursementCauseOptions = causePayables.filter((allocation) =>
    new Prisma.Decimal(allocation.totalOutstanding).greaterThan(0),
  );
  const disbursements: DisbursementRow[] = summary?.disbursements ?? [];
  const taxTrueUps: TaxTrueUpRow[] = summary?.taxTrueUps ?? [];
  const disbursementOptions = disbursementCauseOptions.map<DisbursementOption>((allocation) => ({
    causeId: allocation.causeId,
    label: `${allocation.causeName} (${formatMoney(allocation.totalOutstanding)} outstanding)`,
    currentOutstanding: allocation.currentOutstanding,
    priorOutstanding: allocation.priorOutstanding,
    totalOutstanding: allocation.totalOutstanding,
  }));
  const [selectedDisbursementCauseId, setSelectedDisbursementCauseId] = useState(
    disbursementOptions[0]?.causeId ?? "",
  );
  const disbursementFieldStyle: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    minHeight: "2.75rem",
    padding: "0.65rem 0.8rem",
    borderRadius: "0.7rem",
    border: "1px solid var(--p-color-border, #c9cccf)",
    background: "var(--p-color-bg-surface, #fff)",
    color: "var(--p-color-text, #303030)",
    font: "inherit",
  };
  const disbursementFileStyle: CSSProperties = {
    ...disbursementFieldStyle,
    padding: "0.5rem 0.65rem",
  };
  const disbursementSubmitStyle: CSSProperties = {
    borderRadius: "0.85rem",
    border: "1px solid #111",
    background: "#111",
    color: "#fff",
    padding: "0.7rem 1rem",
    font: "inherit",
    fontWeight: 600,
    cursor: disbursementFetcher.state !== "idle" ? "not-allowed" : "pointer",
    opacity: disbursementFetcher.state !== "idle" ? 0.6 : 1,
  };
  const selectedDisbursementOption =
    disbursementOptions.find((option) => option.causeId === selectedDisbursementCauseId) ??
    disbursementOptions[0] ??
    null;
  const selectedTotalOutstandingAmount = floorCurrency(selectedDisbursementOption?.totalOutstanding ?? "0");
  const selectedRemainingAmountInputMax = selectedTotalOutstandingAmount;
  const disbursementTwoColumnGridStyle: CSSProperties = {
    display: "grid",
    gap: "0.9rem",
    gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
    alignItems: "start",
  };
  const disbursementHelpTextStyle: CSSProperties = {
    color: "var(--p-color-text-subdued, #6d7175)",
    minHeight: "2.6rem",
  };
  const trueUpCauseOptions =
    summary?.activeCauses?.map((cause: { id: string; name: string }) => ({
      causeId: cause.id,
      causeName: cause.name,
    })) ?? [];

  useEffect(() => {
    if (disbursementOptions.length === 0) {
      setSelectedDisbursementCauseId("");
      return;
    }

    const currentStillValid = disbursementOptions.some(
      (option) => option.causeId === selectedDisbursementCauseId,
    );

    if (!currentStillValid) {
      setSelectedDisbursementCauseId(disbursementOptions[0]?.causeId ?? "");
    }
  }, [selectedPeriodId, selectedDisbursementCauseId, disbursementOptions]);

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
        {trueUpFetcher.data && !trueUpFetcher.data.ok && (
          <s-banner tone="critical">
            <s-text>{trueUpFetcher.data.message}</s-text>
          </s-banner>
        )}
        {trueUpFetcher.data?.ok && trueUpFetcher.data.message && (
          <s-banner tone="success">
            <s-text>{trueUpFetcher.data.message}</s-text>
          </s-banner>
        )}
        {exportError ? (
          <s-banner tone="critical">
            <s-text>{exportError}</s-text>
          </s-banner>
        ) : null}

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
            {selectedPeriod ? (
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  aria-label="Export reporting period as CSV"
                  onClick={() => void exportPeriod("csv")}
                  disabled={exportingFormat !== null}
                  style={disbursementSubmitStyle}
                >
                  {exportingFormat === "csv" ? "Exporting CSV..." : "Export CSV"}
                </button>
                <button
                  type="button"
                  aria-label="Export reporting period as PDF"
                  onClick={() => void exportPeriod("pdf")}
                  disabled={exportingFormat !== null}
                  style={disbursementSubmitStyle}
                >
                  {exportingFormat === "pdf" ? "Exporting PDF..." : "Export PDF"}
                </button>
              </div>
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
                  <strong>Donation pool (after carry-forward)</strong>
                  <s-text color="subdued">{formatMoney(summary.track1.donationPool)}</s-text>
                </div>
              </div>
              <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                <div>
                  <strong>Surplus added from prior true-ups</strong>
                  <s-text color="subdued">{formatMoney(summary.track1.taxTrueUpSurplusApplied)}</s-text>
                </div>
                <div>
                  <strong>Shortfall deducted from prior true-ups</strong>
                  <s-text color="subdued">{formatMoney(summary.track1.taxTrueUpShortfallApplied)}</s-text>
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

          <s-section heading="Outstanding cause payables">
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <s-text color="subdued">
                This view rolls prior unpaid cause balances into the current period so overdue obligations are easy to spot and settle.
              </s-text>
              {causePayables.some((payable) => payable.overdue) ? (
                <s-banner tone="warning">
                  <s-text>Prior-period outstanding balances are still unpaid and should be disbursed as soon as possible.</s-text>
                </s-banner>
              ) : null}
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Cause</s-table-header>
                  <s-table-header listSlot="inline">Overdue</s-table-header>
                  <s-table-header listSlot="secondary">Current period</s-table-header>
                  <s-table-header listSlot="secondary">Prior periods</s-table-header>
                  <s-table-header listSlot="secondary">Outstanding by period</s-table-header>
                  <s-table-header listSlot="labeled" format="currency">Total outstanding</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {causePayables.length === 0 ? (
                    <s-table-row>
                      <s-table-cell>No outstanding cause payables yet.</s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                    </s-table-row>
                  ) : (
                    causePayables.map((payable) => (
                      <s-table-row key={payable.causeId}>
                        <s-table-cell>{payable.causeName}</s-table-cell>
                        <s-table-cell>{payable.overdue ? "Needs attention" : "Current only"}</s-table-cell>
                        <s-table-cell>{formatMoney(payable.currentOutstanding)}</s-table-cell>
                        <s-table-cell>{formatMoney(payable.priorOutstanding)}</s-table-cell>
                        <s-table-cell>
                          <div style={{ display: "grid", gap: "0.2rem" }}>
                            {payable.periods.map((period) => (
                              <span key={`${payable.causeId}-${period.periodId}`}>
                                {formatDateRange(period.periodStartDate, period.periodEndDate, locale)}: {formatMoney(period.amount)}
                              </span>
                            ))}
                          </div>
                        </s-table-cell>
                        <s-table-cell>{formatMoney(payable.totalOutstanding)}</s-table-cell>
                      </s-table-row>
                    ))
                  )}
                </s-table-body>
              </s-table>
            </div>
          </s-section>

          {selectedPeriod?.status === "CLOSED" ? (
            <>
              <s-section heading="Log disbursement">
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <s-text color="subdued">
                    Record funds paid out to a Cause for this closed period. Allocated amounts auto-apply to the oldest outstanding closed balances first.
                  </s-text>
                  {disbursementCauseOptions.length === 0 ? (
                    <s-banner tone="info">
                      <s-text>All closed-period cause payables through this reporting period have already been fully disbursed.</s-text>
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
                      <div
                        aria-live="polite"
                        aria-atomic="true"
                        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
                      >
                        {disbursementStatusMessage}
                      </div>

                      {disbursementFetcher.data && !disbursementFetcher.data.ok ? (
                        <s-banner tone="critical">
                          <s-text>{disbursementFetcher.data.message}</s-text>
                        </s-banner>
                      ) : null}

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor="disbursement-cause">Cause</label>
                        <select
                          id="disbursement-cause"
                          name="causeId"
                          value={selectedDisbursementCauseId}
                          onChange={(event) => setSelectedDisbursementCauseId(event.currentTarget.value)}
                          style={disbursementFieldStyle}
                        >
                          {disbursementOptions.map((option) => (
                            <option key={option.causeId} value={option.causeId}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {selectedDisbursementOption ? (
                          <div style={{ display: "grid", gap: "0.2rem" }}>
                            <s-text color="subdued">
                              Current period outstanding: {formatMoney(selectedDisbursementOption.currentOutstanding)}
                            </s-text>
                            <s-text color="subdued">
                              Prior-period outstanding: {formatMoney(selectedDisbursementOption.priorOutstanding)}
                            </s-text>
                            <s-text color="subdued">
                              Total outstanding eligible for auto-application: {formatMoney(selectedDisbursementOption.totalOutstanding)}
                            </s-text>
                          </div>
                        ) : null}
                        {disbursementFetcher.data?.fieldErrors?.causeId?.map((message) => (
                          <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                        ))}
                      </div>

                      <div style={disbursementTwoColumnGridStyle}>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="disbursement-allocated-amount">Allocated amount</label>
                          <input
                            id="disbursement-allocated-amount"
                            name="allocatedAmount"
                            type="number"
                            min="0"
                            max={selectedRemainingAmountInputMax}
                            step="0.01"
                            style={disbursementFieldStyle}
                          />
                          <s-text color="subdued" style={disbursementHelpTextStyle}>
                            Auto-applies FIFO against closed outstanding balances through this period. Max {formatMoney(selectedTotalOutstandingAmount)}.
                          </s-text>
                          {disbursementFetcher.data?.fieldErrors?.allocatedAmount?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="disbursement-paid-at">Paid date</label>
                          <input
                            id="disbursement-paid-at"
                            name="paidAt"
                            type="date"
                            defaultValue={new Date().toISOString().slice(0, 10)}
                            style={disbursementFieldStyle}
                          />
                          <s-text color="subdued" style={disbursementHelpTextStyle}>
                            Use the date the funds were actually sent to the cause.
                          </s-text>
                          {disbursementFetcher.data?.fieldErrors?.paidAt?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                      </div>

                      <div style={disbursementTwoColumnGridStyle}>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="disbursement-extra-contribution">Extra contribution</label>
                          <input
                            id="disbursement-extra-contribution"
                            name="extraContributionAmount"
                            type="number"
                            min="0"
                            step="0.01"
                            style={disbursementFieldStyle}
                          />
                          <s-text color="subdued" style={disbursementHelpTextStyle}>
                            Additional gift above the allocated amount. Does not reduce future allocations.
                          </s-text>
                          {disbursementFetcher.data?.fieldErrors?.extraContributionAmount?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="disbursement-fees-covered">Fees covered</label>
                          <input
                            id="disbursement-fees-covered"
                            name="feesCoveredAmount"
                            type="number"
                            min="0"
                            step="0.01"
                            style={disbursementFieldStyle}
                          />
                          <s-text color="subdued" style={disbursementHelpTextStyle}>
                            Extra amount to help cover the cause&apos;s processing or operating costs.
                          </s-text>
                          {disbursementFetcher.data?.fieldErrors?.feesCoveredAmount?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                      </div>

                      <div style={disbursementTwoColumnGridStyle}>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="disbursement-method">Payment method</label>
                          <input
                            id="disbursement-method"
                            name="paymentMethod"
                            type="text"
                            placeholder="ACH, check, wire..."
                            style={disbursementFieldStyle}
                          />
                          {disbursementFetcher.data?.fieldErrors?.paymentMethod?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="disbursement-reference">Reference id</label>
                          <input
                            id="disbursement-reference"
                            name="referenceId"
                            type="text"
                            placeholder="Optional payout or check id"
                            style={disbursementFieldStyle}
                          />
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor="disbursement-receipt">Receipt</label>
                        <input
                          id="disbursement-receipt"
                          name="receipt"
                          type="file"
                          accept=".pdf,image/*"
                          style={disbursementFileStyle}
                        />
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
                          style={disbursementSubmitStyle}
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
                    <s-table-header listSlot="secondary">Applied to</s-table-header>
                    <s-table-header listSlot="secondary">Allocated</s-table-header>
                    <s-table-header listSlot="secondary">Extra</s-table-header>
                    <s-table-header listSlot="secondary">Fees</s-table-header>
                    <s-table-header listSlot="secondary">Method</s-table-header>
                    <s-table-header listSlot="secondary">Reference</s-table-header>
                    <s-table-header listSlot="secondary">Receipt</s-table-header>
                    <s-table-header listSlot="labeled" format="currency">Total paid</s-table-header>
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
                          <s-table-cell>
                            {disbursement.applications.length > 0 ? (
                              <div style={{ display: "grid", gap: "0.2rem" }}>
                                {disbursement.applications.map((application) => (
                                  <span key={`${disbursement.id}-${application.periodId}`}>
                                    {formatDateRange(application.periodStartDate, application.periodEndDate, locale)}: {formatMoney(application.amount)}
                                  </span>
                                ))}
                              </div>
                            ) : "None"}
                          </s-table-cell>
                          <s-table-cell>{formatMoney(disbursement.allocatedAmount)}</s-table-cell>
                          <s-table-cell>{formatMoney(disbursement.extraContributionAmount)}</s-table-cell>
                          <s-table-cell>{formatMoney(disbursement.feesCoveredAmount)}</s-table-cell>
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

              <s-section heading="Tax true-up">
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <s-text color="subdued">
                    Record the actual tax paid for this closed period. Any surplus or shortfall is applied to the current open period.
                  </s-text>

                  {taxTrueUps.length === 0 ? (
                    <trueUpFetcher.Form
                      ref={trueUpFormRef}
                      method="post"
                      style={{ display: "grid", gap: "0.9rem" }}
                    >
                      <input type="hidden" name="intent" value="record-tax-true-up" />
                      <input type="hidden" name="periodId" value={selectedPeriod.id} />
                      <div
                        aria-live="polite"
                        aria-atomic="true"
                        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
                      >
                        {trueUpStatusMessage}
                      </div>

                      {trueUpFetcher.data && !trueUpFetcher.data.ok ? (
                        <s-banner tone="critical">
                          <s-text>{trueUpFetcher.data.message}</s-text>
                        </s-banner>
                      ) : null}

                      <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                        <div>
                          <strong>Estimated reserve</strong>
                          <s-text color="subdued">{formatMoney(summary.track2.estimatedTaxReserve)}</s-text>
                        </div>
                        <div>
                          <strong>Applied to active period</strong>
                          <s-text color="subdued">
                            {periods.some((period: PeriodRow) => period.status === "OPEN" && period.id !== selectedPeriod.id) ? "Yes" : "Only if exact match"}
                          </s-text>
                        </div>
                      </div>

                      <div style={disbursementTwoColumnGridStyle}>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="true-up-actual-tax">Actual tax paid</label>
                          <input
                            id="true-up-actual-tax"
                            name="actualTax"
                            type="number"
                            min="0"
                            step="0.01"
                            style={disbursementFieldStyle}
                          />
                          {trueUpFetcher.data?.fieldErrors?.actualTax?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="true-up-filed-at">Filed date</label>
                          <input
                            id="true-up-filed-at"
                            name="filedAt"
                            type="date"
                            defaultValue={new Date().toISOString().slice(0, 10)}
                            style={disbursementFieldStyle}
                          />
                          {trueUpFetcher.data?.fieldErrors?.filedAt?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor="true-up-notes">Redistribution notes</label>
                        <textarea
                          id="true-up-notes"
                          name="redistributionNotes"
                          rows={3}
                          placeholder="Optional notes for how any surplus should be handled."
                          style={{ ...disbursementFieldStyle, minHeight: "7rem", resize: "vertical" }}
                        />
                      </div>

                      <div style={{ display: "grid", gap: "0.5rem" }}>
                        <strong>Surplus redistribution</strong>
                        <s-text color="subdued">
                          If actual tax is lower than the estimate, enter how the surplus should be redistributed across causes. Leave blank otherwise.
                        </s-text>
                        {trueUpCauseOptions.map((cause: { causeId: string; causeName: string }) => (
                          <div key={cause.causeId} style={disbursementTwoColumnGridStyle}>
                            <div style={{ display: "grid", gap: "0.25rem" }}>
                              <span>{cause.causeName}</span>
                            </div>
                            <div style={{ display: "grid", gap: "0.25rem" }}>
                              <input
                                name={`redistribution:${cause.causeId}`}
                                type="number"
                                min="0"
                                step="0.01"
                                style={disbursementFieldStyle}
                              />
                            </div>
                          </div>
                        ))}
                        {trueUpFetcher.data?.fieldErrors?.redistributions?.map((message) => (
                          <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                        ))}
                      </div>

                      <label style={{ display: "flex", gap: "0.5rem", alignItems: "start" }}>
                        <input type="checkbox" name="confirmShortfall" />
                        <span>Confirm any shortfall should be deducted from the current open period&apos;s donation pool.</span>
                      </label>
                      {trueUpFetcher.data?.fieldErrors?.confirmShortfall?.map((message) => (
                        <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                      ))}

                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                          type="submit"
                          disabled={trueUpFetcher.state !== "idle"}
                          style={{
                            ...disbursementSubmitStyle,
                            cursor: trueUpFetcher.state !== "idle" ? "not-allowed" : "pointer",
                            opacity: trueUpFetcher.state !== "idle" ? 0.6 : 1,
                          }}
                        >
                          Record tax true-up
                        </button>
                      </div>
                    </trueUpFetcher.Form>
                  ) : (
                    <s-banner tone="success">
                      <s-text>A tax true-up has already been recorded for this reporting period.</s-text>
                    </s-banner>
                  )}

                  <s-table>
                    <s-table-header-row>
                      <s-table-header listSlot="secondary">Filed</s-table-header>
                      <s-table-header listSlot="secondary">Estimated</s-table-header>
                      <s-table-header listSlot="secondary">Actual</s-table-header>
                      <s-table-header listSlot="secondary">Delta</s-table-header>
                      <s-table-header listSlot="primary">Notes</s-table-header>
                    </s-table-header-row>
                    <s-table-body>
                      {taxTrueUps.length === 0 ? (
                        <s-table-row>
                          <s-table-cell>No tax true-up recorded for this period.</s-table-cell>
                          <s-table-cell></s-table-cell>
                          <s-table-cell></s-table-cell>
                          <s-table-cell></s-table-cell>
                          <s-table-cell></s-table-cell>
                        </s-table-row>
                      ) : (
                        taxTrueUps.map((trueUp) => (
                          <s-table-row key={trueUp.id}>
                            <s-table-cell>{formatDate(trueUp.filedAt, locale)}</s-table-cell>
                            <s-table-cell>{formatMoney(trueUp.estimatedTax)}</s-table-cell>
                            <s-table-cell>{formatMoney(trueUp.actualTax)}</s-table-cell>
                            <s-table-cell>{formatMoney(trueUp.delta)}</s-table-cell>
                            <s-table-cell>{trueUp.redistributionNotes ?? "—"}</s-table-cell>
                          </s-table-row>
                        ))
                      )}
                    </s-table-body>
                  </s-table>
                </div>
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
                  <strong>Taxable base</strong>
                  <s-text color="subdued">{formatMoney(summary.track2.taxableBase)}</s-text>
                </div>
                <div>
                  <strong>Estimated tax reserve</strong>
                  <s-text color="subdued">{formatMoney(summary.track2.estimatedTaxReserve)}</s-text>
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
                  <s-text color="subdued">{formatTaxDeductionMode(summary.track2.taxDeductionMode)}</s-text>
                </div>
                <div>
                  <strong>Taxable weight</strong>
                  <s-text color="subdued">{formatPct(summary.track2.taxableWeight)}</s-text>
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
