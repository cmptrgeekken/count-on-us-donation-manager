import { jsonResponse } from "~/utils/json-response.server";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigate, useRevalidator, useRouteError, useSearchParams } from "@remix-run/react";
import { z } from "zod";
import { MetricCard, SectionHeader, StatusBanners, WorkflowTabs } from "../components/admin-ui";
import { prisma } from "../db.server";
import {
  ArtistPaymentError,
  artistPaymentErrorCodes,
  logArtistPayment,
} from "../services/artistPaymentService.server";
import { queueAnalyticalRecalculation } from "../services/analyticalRecalculation.server";
import {
  ACCEPTED_RECEIPT_CONTENT_TYPES,
  DisbursementError,
  disbursementErrorCodes,
  logDisbursement,
  MAX_RECEIPT_BYTES,
  updateDisbursement,
} from "../services/disbursementService.server";
import { closeReportingPeriod } from "../services/reportingPeriodService.server";
import { buildReportingSummary } from "../services/reportingSummary.server";
import {
  confirmOrderSettlement,
  ignoreOrderSettlement,
} from "../services/orderSettlement.server";
import {
  recordTaxTrueUp,
  TaxTrueUpError,
  taxTrueUpErrorCodes,
} from "../services/taxTrueUpService.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { parseOptionalNonNegativeMoney } from "../utils/money-parsing";
import { useAppLocalization } from "../utils/use-app-localization";

function moneyNumber(value: string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function floorCurrency(value: string) {
  return (Math.floor(moneyNumber(value) * 100) / 100).toFixed(2);
}

function subtractCurrency(left: string, right: string) {
  return floorCurrency((moneyNumber(left) - moneyNumber(right)).toString());
}

function sumCurrency(values: string[]) {
  return values.reduce((sum, value) => sum + moneyNumber(value), 0).toFixed(2);
}

const autocompleteFieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "0.68rem 0.75rem",
  border: "1px solid var(--p-color-border, #d2d5d8)",
  borderRadius: "0.6rem",
  background: "var(--p-color-bg-surface, #fff)",
  color: "var(--p-color-text, #303030)",
  font: "inherit",
};

function PaymentMethodAutocomplete({
  id,
  methods,
  defaultValue = "",
}: {
  id: string;
  methods: string[];
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const normalized = value.trim().toLowerCase();
  const matches = methods.filter((method) =>
    !normalized || method.toLowerCase().includes(normalized),
  );

  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        name="paymentMethod"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setValue(event.currentTarget.value);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 100)}
        placeholder="ACH, check, wire..."
        style={autocompleteFieldStyle}
      />
      {open && matches.length > 0 ? (
        <div
          id={`${id}-options`}
          role="listbox"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 0.35rem)",
            left: 0,
            right: 0,
            overflow: "hidden",
            border: "1px solid var(--p-color-border, #d2d5d8)",
            borderRadius: "0.75rem",
            background: "var(--p-color-bg-surface, #fff)",
            boxShadow: "0 12px 24px rgba(0, 0, 0, 0.12)",
          }}
        >
          {matches.map((method) => (
            <button
              key={method}
              type="button"
              role="option"
              aria-selected={method === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setValue(method);
                setOpen(false);
              }}
              style={{
                width: "100%",
                padding: "0.7rem 0.85rem",
                border: 0,
                borderBottom: "1px solid var(--p-color-border-subdued, #ebebeb)",
                background: "var(--p-color-bg-surface, #fff)",
                color: "inherit",
                textAlign: "left",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              {method}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function isGreaterThanZero(value: string | null | undefined) {
  return moneyNumber(value) > 0;
}

function isLessThanZero(value: string | null | undefined) {
  return moneyNumber(value) < 0;
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
  details: Array<{
    kind: "order_line" | "true_up" | "tax_reserve";
    label: string | null;
    orderSnapshotId?: string;
    shopifyOrderId?: string;
    orderNumber: string | null;
    shopifyLineItemId?: string;
    productTitle?: string;
    variantTitle?: string;
    quantity?: number;
    grossLineAmount: string | null;
    netContributionAmount: string | null;
    allocatedAmount: string;
  }>;
};

type ChargeRow = {
  id: string;
  description: string;
  amount: string;
  processedAt: string | null;
};

type ExternalSettlementRow = {
  id: string;
  shopifyOrderId: string;
  orderNumber: string | null;
  source: string;
  status: string;
  grossOrderAmount: string;
  shopifyPaidAmount: string | null;
  amountReceived: string | null;
  feeAmount: string;
  currency: string;
  paidAt: string | null;
  referenceId: string | null;
  notes: string | null;
  detectedReason: string | null;
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
  paymentMethod: string | null;
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

type ArtistPaymentOption = {
  artistId: string;
  label: string;
  currentOutstanding: string;
  priorOutstanding: string;
  totalOutstanding: string;
};

type ReportingTab = "details" | "cause-payments" | "artist-payments" | "tax" | "diagnostics";

const REPORTING_TABS: Array<{ value: ReportingTab; label: string }> = [
  { value: "details", label: "Details" },
  { value: "cause-payments", label: "Cause Payments" },
  { value: "artist-payments", label: "Artist Payments" },
  { value: "tax", label: "Tax" },
  { value: "diagnostics", label: "Diagnostics" },
];

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

type ArtistPayableRow = {
  artistId: string;
  artistName: string;
  creditName: string;
  currentOutstanding: string;
  priorOutstanding: string;
  totalOutstanding: string;
  overdue: boolean;
  periods: CausePayablePeriodRow[];
};

type ArtistAllocationRow = {
  artistId: string;
  artistName: string;
  creditName: string;
  allocated: string;
  paid: string;
};

type ArtistPaymentRow = {
  id: string;
  artistId: string;
  artistName: string;
  creditName: string;
  amount: string;
  paidAt: string;
  paymentMethod: string;
  referenceId: string | null;
  notes: string | null;
  applications: Array<{
    periodId: string;
    periodStartDate: string;
    periodEndDate: string;
    amount: string;
  }>;
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

type AnalyticalRecalculationSummary = {
  period: {
    authoritativeNetContribution: string;
    recalculatedNetContribution: string;
    netContributionDelta: string;
    authoritativeDonationPool: string;
    recalculatedDonationPool: string;
    donationPoolDelta: string;
    shopifyCharges: string;
  };
  causes: Array<{
    causeId: string;
    causeName: string;
    authoritativeAllocated: string;
    recalculatedAllocated: string;
    delta: string;
  }>;
};

const disbursementSchema = z.object({
  periodId: z.string().trim().cuid("Reporting period id is invalid."),
  causeId: z.string().trim().cuid("Cause id is invalid."),
  allocatedAmount: z
    .string()
    .trim()
    .refine((value) => value === "" || (!Number.isNaN(Number(value)) && Number(value) >= 0), "Allocated amount must be 0 or greater."),
  feesCoveredAmount: z
    .string()
    .trim()
    .refine((value) => value === "" || (!Number.isNaN(Number(value)) && Number(value) >= 0), "Fees covered must be 0 or greater."),
  paidAt: z
    .string()
    .trim()
    .min(1, "Paid date is required.")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Paid date must be a valid date."),
  paymentMethod: z.string().trim().optional(),
  referenceId: z.string().trim().optional(),
  receipt: z.string().trim().optional(),
});
const editDisbursementSchema = disbursementSchema.extend({
  disbursementId: z.string().uuid("Disbursement id is invalid."),
});

const artistPaymentSchema = z.object({
  periodId: z.string().trim().cuid("Reporting period id is invalid."),
  artistId: z.string().trim().cuid("Artist id is invalid."),
  amount: z
    .string()
    .trim()
    .min(1, "Amount is required.")
    .refine((value) => !Number.isNaN(Number(value)) && Number(value) > 0, "Amount must be greater than 0."),
  paidAt: z
    .string()
    .trim()
    .min(1, "Paid date is required.")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Paid date must be a valid date."),
  paymentMethod: z.string().trim().min(1, "Payment method is required."),
  referenceId: z.string().trim().optional(),
  notes: z.string().trim().optional(),
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

const periodIdSchema = z.string().trim().cuid("Reporting period id is invalid.");
const settlementIdSchema = z.string().trim().cuid("Settlement review id is invalid.");
const confirmSettlementSchema = z.object({
  settlementId: settlementIdSchema,
  amountReceived: z
    .string()
    .trim()
    .min(1, "Amount received is required.")
    .refine((value) => !Number.isNaN(Number(value)) && Number(value) >= 0, "Amount received must be 0 or greater."),
  paidAt: z
    .string()
    .trim()
    .optional()
    .refine((value) => !value || !Number.isNaN(Date.parse(value)), "Paid date must be a valid date."),
  source: z.string().trim().optional(),
  referenceId: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});
const ignoreSettlementSchema = z.object({
  settlementId: settlementIdSchema,
  ignoreReason: z.string().trim().min(8, "Ignoring a settlement review requires a reason."),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const url = new URL(request.url);
  const requestedPeriodId = url.searchParams.get("periodId") ?? "";
  const reporting = await buildReportingSummary(shopId, requestedPeriodId);
  const [analyticalRecalculationRun, paymentMethodRows] = await Promise.all([reporting.selectedPeriodId
    ? await prisma.analyticalRecalculationRun.findFirst({
        where: {
          shopId,
          periodId: reporting.selectedPeriodId,
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          errorMessage: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          summary: true,
        },
      })
    : null,
  prisma.disbursement.findMany({
    where: { shopId, paymentMethod: { not: null } },
    distinct: ["paymentMethod"],
    orderBy: { createdAt: "desc" },
    select: { paymentMethod: true },
  })]);

  return jsonResponse({
    ...reporting,
    paymentMethods: paymentMethodRows
      .map((row) => row.paymentMethod?.trim())
      .filter((method): method is string => Boolean(method)),
    analyticalRecalculationRun: analyticalRecalculationRun
      ? {
          ...analyticalRecalculationRun,
          createdAt: analyticalRecalculationRun.createdAt.toISOString(),
          startedAt: analyticalRecalculationRun.startedAt?.toISOString() ?? null,
          completedAt: analyticalRecalculationRun.completedAt?.toISOString() ?? null,
          summary: analyticalRecalculationRun.summary as AnalyticalRecalculationSummary | null,
        }
      : null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "close-period") {
    const periodId = formData.get("periodId")?.toString() ?? "";
    const parsedPeriodId = periodIdSchema.safeParse(periodId);
    if (!parsedPeriodId.success) {
      return jsonResponse({ ok: false, message: parsedPeriodId.error.issues[0]?.message ?? "Reporting period id is required." }, { status: 400 });
    }

    await closeReportingPeriod(shopId, parsedPeriodId.data);
    return jsonResponse({ ok: true, message: "Reporting period closed." });
  }

  if (intent === "run-analytical-recalculation") {
    const periodId = formData.get("periodId")?.toString() ?? "";
    const parsedPeriodId = periodIdSchema.safeParse(periodId);
    if (!parsedPeriodId.success) {
      return jsonResponse({ ok: false, message: parsedPeriodId.error.issues[0]?.message ?? "Reporting period id is required." }, { status: 400 });
    }

    await queueAnalyticalRecalculation(shopId, parsedPeriodId.data);
    return jsonResponse({ ok: true, message: "Analytical recalculation queued." });
  }

  if (intent === "confirm-order-settlement") {
    const parsed = confirmSettlementSchema.safeParse({
      settlementId: formData.get("settlementId")?.toString() ?? "",
      amountReceived: formData.get("amountReceived")?.toString() ?? "",
      paidAt: formData.get("paidAt")?.toString() ?? "",
      source: formData.get("source")?.toString() ?? "",
      referenceId: formData.get("referenceId")?.toString() ?? "",
      notes: formData.get("notes")?.toString() ?? "",
    });

    if (!parsed.success) {
      return jsonResponse(
        {
          ok: false,
          message: parsed.error.issues[0]?.message ?? "Invalid settlement review.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const amountReceived = parseOptionalNonNegativeMoney(parsed.data.amountReceived, "Amount received");
    if (!amountReceived) {
      return jsonResponse(
        {
          ok: false,
          message: "Amount received is required.",
          fieldErrors: { amountReceived: ["Amount received is required."] },
        },
        { status: 400 },
      );
    }

    await confirmOrderSettlement({
      shopId,
      settlementId: parsed.data.settlementId,
      amountReceived,
      paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : null,
      source: parsed.data.source ?? "",
      referenceId: parsed.data.referenceId ?? "",
      notes: parsed.data.notes ?? "",
    });
    return jsonResponse({ ok: true, message: "External settlement confirmed." });
  }

  if (intent === "ignore-order-settlement") {
    const parsed = ignoreSettlementSchema.safeParse({
      settlementId: formData.get("settlementId")?.toString() ?? "",
      ignoreReason: formData.get("ignoreReason")?.toString() ?? "",
    });

    if (!parsed.success) {
      return jsonResponse(
        {
          ok: false,
          message: parsed.error.issues[0]?.message ?? "Invalid settlement review.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    await ignoreOrderSettlement({
      shopId,
      settlementId: parsed.data.settlementId,
      ignoreReason: parsed.data.ignoreReason,
    });
    return jsonResponse({ ok: true, message: "External settlement review ignored." });
  }

  if (intent === "log-disbursement") {
    const receiptEntry = formData.get("receipt");
    const parsed = disbursementSchema.safeParse({
      periodId: formData.get("periodId")?.toString() ?? "",
      causeId: formData.get("causeId")?.toString() ?? "",
      allocatedAmount: formData.get("allocatedAmount")?.toString() ?? "",
      feesCoveredAmount: formData.get("feesCoveredAmount")?.toString() ?? "",
      paidAt: formData.get("paidAt")?.toString() ?? "",
      paymentMethod: formData.get("paymentMethod")?.toString() ?? "",
      referenceId: formData.get("referenceId")?.toString() ?? "",
      receipt: receiptEntry instanceof File ? receiptEntry.name : "",
    });

    if (!parsed.success) {
      return jsonResponse(
        {
          ok: false,
          message: parsed.error.issues[0]?.message ?? "Invalid disbursement.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    if (receiptEntry instanceof File && receiptEntry.size > MAX_RECEIPT_BYTES) {
      return jsonResponse(
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
      return jsonResponse(
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

      return jsonResponse({ ok: true, message: "Disbursement logged." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to log disbursement.";
      const fieldErrors: ReportingActionData["fieldErrors"] =
        error instanceof DisbursementError
          ? error.code === disbursementErrorCodes.ZERO_TOTAL
            ? { allocatedAmount: [message] }
            : error.code === disbursementErrorCodes.RECEIPT_TOO_LARGE || error.code === disbursementErrorCodes.RECEIPT_INVALID_TYPE
              ? { receipt: [message] }
              : error.code === disbursementErrorCodes.PERIOD_NOT_CLOSED || error.code === disbursementErrorCodes.PERIOD_NOT_FOUND
                ? { periodId: [message] }
                : error.code === disbursementErrorCodes.PAYABLE_NOT_FOUND
                  ? { causeId: [message] }
                  : undefined
          : undefined;

      return jsonResponse(
        {
          ok: false,
          message,
          fieldErrors,
        },
        { status: 400 },
      );
    }
  }

  if (intent === "edit-disbursement") {
    const receiptEntry = formData.get("receipt");
    const parsed = editDisbursementSchema.safeParse({
      disbursementId: formData.get("disbursementId")?.toString() ?? "",
      periodId: formData.get("periodId")?.toString() ?? "",
      causeId: formData.get("causeId")?.toString() ?? "",
      allocatedAmount: formData.get("allocatedAmount")?.toString() ?? "",
      feesCoveredAmount: formData.get("feesCoveredAmount")?.toString() ?? "",
      paidAt: formData.get("paidAt")?.toString() ?? "",
      paymentMethod: formData.get("paymentMethod")?.toString() ?? "",
      referenceId: formData.get("referenceId")?.toString() ?? "",
      receipt: receiptEntry instanceof File ? receiptEntry.name : "",
    });
    if (!parsed.success) {
      return jsonResponse({
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Invalid disbursement.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      }, { status: 400 });
    }
    if (receiptEntry instanceof File && receiptEntry.size > MAX_RECEIPT_BYTES) {
      return jsonResponse({
        ok: false,
        message: "Receipt file must be 10 MB or smaller.",
        fieldErrors: { receipt: ["Receipt file must be 10 MB or smaller."] },
      }, { status: 400 });
    }
    if (
      receiptEntry instanceof File &&
      receiptEntry.size > 0 &&
      !ACCEPTED_RECEIPT_CONTENT_TYPES.has(receiptEntry.type || "application/octet-stream")
    ) {
      return jsonResponse({
        ok: false,
        message: "Receipt must be a PDF, PNG, or JPEG file.",
        fieldErrors: { receipt: ["Receipt must be a PDF, PNG, or JPEG file."] },
      }, { status: 400 });
    }

    try {
      await updateDisbursement(shopId, {
        disbursementId: parsed.data.disbursementId,
        allocatedAmount: parsed.data.allocatedAmount || "0",
        feesCoveredAmount: parsed.data.feesCoveredAmount || "0",
        paidAt: new Date(parsed.data.paidAt),
        paymentMethod: parsed.data.paymentMethod,
        referenceId: parsed.data.referenceId,
        receipt:
          receiptEntry instanceof File && receiptEntry.size > 0
            ? {
                filename: receiptEntry.name,
                contentType: receiptEntry.type || "application/octet-stream",
                body: new Uint8Array(await receiptEntry.arrayBuffer()),
              }
            : null,
      });
      return jsonResponse({ ok: true, message: "Disbursement updated." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update disbursement.";
      return jsonResponse({ ok: false, message }, { status: 400 });
    }
  }

  if (intent === "log-artist-payment") {
    const parsed = artistPaymentSchema.safeParse({
      periodId: formData.get("periodId")?.toString() ?? "",
      artistId: formData.get("artistId")?.toString() ?? "",
      amount: formData.get("amount")?.toString() ?? "",
      paidAt: formData.get("paidAt")?.toString() ?? "",
      paymentMethod: formData.get("paymentMethod")?.toString() ?? "",
      referenceId: formData.get("referenceId")?.toString() ?? "",
      notes: formData.get("notes")?.toString() ?? "",
    });

    if (!parsed.success) {
      return jsonResponse(
        {
          ok: false,
          message: parsed.error.issues[0]?.message ?? "Invalid artist payment.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    try {
      await logArtistPayment(shopId, {
        periodId: parsed.data.periodId,
        artistId: parsed.data.artistId,
        amount: parsed.data.amount,
        paidAt: new Date(parsed.data.paidAt),
        paymentMethod: parsed.data.paymentMethod,
        referenceId: parsed.data.referenceId ?? "",
        notes: parsed.data.notes ?? "",
      });

      return jsonResponse({ ok: true, message: "Artist payment logged." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to log artist payment.";
      const fieldErrors: ReportingActionData["fieldErrors"] =
        error instanceof ArtistPaymentError
          ? error.code === artistPaymentErrorCodes.AMOUNT_EXCEEDS_REMAINING ||
            error.code === artistPaymentErrorCodes.ZERO_TOTAL ||
            error.code === artistPaymentErrorCodes.NEGATIVE_AMOUNT
            ? { amount: [message] }
            : error.code === artistPaymentErrorCodes.PERIOD_NOT_CLOSED || error.code === artistPaymentErrorCodes.PERIOD_NOT_FOUND
              ? { periodId: [message] }
              : error.code === artistPaymentErrorCodes.PAYABLE_NOT_FOUND
                ? { artistId: [message] }
                : undefined
          : undefined;

      return jsonResponse(
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
      return jsonResponse(
        {
          ok: false,
          message: parsed.error.issues[0]?.message ?? "Invalid tax true-up.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    let actualTax;
    try {
      actualTax = parseOptionalNonNegativeMoney(parsed.data.actualTax, "Actual tax") ?? parseOptionalNonNegativeMoney("0", "Actual tax");
    } catch (error) {
      if (error instanceof Response) {
        const message = await error.text();
        return jsonResponse(
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
    if (!actualTax) {
      return jsonResponse(
        {
          ok: false,
          message: "Actual tax is required.",
          fieldErrors: { actualTax: ["Actual tax is required."] },
        },
        { status: 400 },
      );
    }

    const redistributions = Array.from(formData.entries())
      .filter(([key]) => key.startsWith("redistribution:"))
      .map(([key, value]) => ({
        causeId: key.replace("redistribution:", ""),
        amount: value.toString(),
      }))
      .filter(
        (entry) =>
          z.string().cuid().safeParse(entry.causeId).success &&
          entry.amount.trim() !== "" &&
          entry.amount.trim() !== "0",
      );

    try {
      await recordTaxTrueUp(shopId, {
        periodId: parsed.data.periodId,
        actualTax,
        filedAt: new Date(parsed.data.filedAt),
        redistributionNotes: parsed.data.redistributionNotes ?? "",
        confirmShortfall: parsed.data.confirmShortfall === "on",
        redistributions,
      });

      return jsonResponse({ ok: true, message: "Tax true-up recorded." });
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

      return jsonResponse(
        {
          ok: false,
          message,
          fieldErrors,
        },
        { status: 400 },
      );
    }
  }

  return jsonResponse({ ok: false, message: "Unknown action." }, { status: 400 });
};

export default function ReportingPage() {
  const { periods, selectedPeriodId, summary, analyticalRecalculationRun, paymentMethods } = useLoaderData<typeof loader>();
  const closeFetcher = useFetcher<ReportingActionData>();
  const disbursementFetcher = useFetcher<ReportingActionData>();
  const artistPaymentFetcher = useFetcher<ReportingActionData>();
  const trueUpFetcher = useFetcher<ReportingActionData>();
  const recalculationFetcher = useFetcher<ReportingActionData>();
  const settlementFetcher = useFetcher<ReportingActionData>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { formatMoney, formatPct, locale } = useAppLocalization();
  const closeDialogRef = useRef<HTMLDialogElement>(null);
  const artistPaymentDialogRef = useRef<HTMLDialogElement>(null);
  const taxTrueUpDialogRef = useRef<HTMLDialogElement>(null);
  const editDisbursementDialogRef = useRef<HTMLDialogElement>(null);
  const disbursementFormRef = useRef<HTMLFormElement>(null);
  const artistPaymentFormRef = useRef<HTMLFormElement>(null);
  const trueUpFormRef = useRef<HTMLFormElement>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [artistPaymentDialogOpen, setArtistPaymentDialogOpen] = useState(false);
  const [taxTrueUpDialogOpen, setTaxTrueUpDialogOpen] = useState(false);
  const [editDisbursement, setEditDisbursement] = useState<DisbursementRow | null>(null);
  const editDisbursementFetcher = useFetcher<ReportingActionData>();
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
    const dialog = artistPaymentDialogRef.current;
    if (!dialog) return;
    if (artistPaymentDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!artistPaymentDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [artistPaymentDialogOpen]);

  useEffect(() => {
    const dialog = taxTrueUpDialogRef.current;
    if (!dialog) return;
    if (taxTrueUpDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!taxTrueUpDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [taxTrueUpDialogOpen]);

  useEffect(() => {
    const dialog = editDisbursementDialogRef.current;
    if (!dialog) return;
    if (editDisbursement && !dialog.open) dialog.showModal();
    if (!editDisbursement && dialog.open) dialog.close();
  }, [editDisbursement]);

  useEffect(() => {
    if (editDisbursementFetcher.data?.ok) setEditDisbursement(null);
  }, [editDisbursementFetcher.data]);

  useEffect(() => {
    if (disbursementFetcher.data?.ok) {
      disbursementFormRef.current?.reset();
    }
  }, [disbursementFetcher.data]);

  useEffect(() => {
    if (artistPaymentFetcher.data?.ok) {
      artistPaymentFormRef.current?.reset();
      setArtistPaymentDialogOpen(false);
      setActiveReportingTab("artist-payments");
    }
  }, [artistPaymentFetcher.data]);

  useEffect(() => {
    if (trueUpFetcher.data?.ok) {
      trueUpFormRef.current?.reset();
      setTaxTrueUpDialogOpen(false);
      setActiveReportingTab("tax");
    }
  }, [trueUpFetcher.data]);

  useEffect(() => {
    if (!exportingFormat) return;
    const timeout = window.setTimeout(() => setExportingFormat(null), 2000);
    return () => window.clearTimeout(timeout);
  }, [exportingFormat]);

  useEffect(() => {
    if (!analyticalRecalculationRun) return;
    if (analyticalRecalculationRun.status !== "queued" && analyticalRecalculationRun.status !== "running") return;

    const timeout = window.setTimeout(() => {
      revalidator.revalidate();
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [analyticalRecalculationRun, revalidator]);

  const selectedPeriod = summary?.period ?? null;
  const statusMessage =
    closeFetcher.data?.message ??
    disbursementFetcher.data?.message ??
    artistPaymentFetcher.data?.message ??
    trueUpFetcher.data?.message ??
    settlementFetcher.data?.message ??
    recalculationFetcher.data?.message ??
    "";
  const disbursementStatusMessage =
    disbursementFetcher.data && !disbursementFetcher.data.ok ? disbursementFetcher.data.message : "";
  const artistPaymentStatusMessage =
    artistPaymentFetcher.data && !artistPaymentFetcher.data.ok ? artistPaymentFetcher.data.message : "";
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
    navigate(`/app/reporting?${params.toString()}`);
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
        return {
          causeId: allocation.causeId,
          causeName: allocation.causeName,
          is501c3: allocation.is501c3,
          allocated: allocation.allocated,
          disbursed: allocation.disbursed,
          remaining: subtractCurrency(allocation.allocated, allocation.disbursed),
          details: allocation.details ?? [],
        };
      })
    : [];
  const causePayables: CausePayableRow[] = summary?.causePayables ?? [];
  const disbursementCauseOptions = causePayables.filter((allocation) =>
    isGreaterThanZero(allocation.totalOutstanding),
  );
  const artistAllocations: ArtistAllocationRow[] = summary?.artistAllocations ?? [];
  const artistPayables: ArtistPayableRow[] = summary?.artistPayables ?? [];
  const artistPaymentArtistOptions = artistPayables.filter((allocation) =>
    isGreaterThanZero(allocation.totalOutstanding),
  );
  const disbursements: DisbursementRow[] = summary?.disbursements ?? [];
  const artistPayments: ArtistPaymentRow[] = summary?.artistPayments ?? [];
  const taxTrueUps: TaxTrueUpRow[] = summary?.taxTrueUps ?? [];
  const externalSettlements: ExternalSettlementRow[] = summary?.externalSettlements ?? [];
  const unresolvedExternalSettlements = externalSettlements.filter((settlement) => settlement.status === "needs_review");
  const confirmedExternalSettlements = externalSettlements.filter((settlement) => settlement.status === "confirmed");
  const externalSettlementFeesArePositive = isGreaterThanZero(summary?.track1.externalSettlementFees ?? "0");
  const recalculationSummary = analyticalRecalculationRun?.summary ?? null;
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
  const artistPaymentOptions = artistPaymentArtistOptions.map<ArtistPaymentOption>((allocation) => ({
    artistId: allocation.artistId,
    label: `${allocation.creditName} (${formatMoney(allocation.totalOutstanding)} outstanding)`,
    currentOutstanding: allocation.currentOutstanding,
    priorOutstanding: allocation.priorOutstanding,
    totalOutstanding: allocation.totalOutstanding,
  }));
  const [selectedArtistPaymentArtistId, setSelectedArtistPaymentArtistId] = useState(
    artistPaymentOptions[0]?.artistId ?? "",
  );
  const [activeReportingTab, setActiveReportingTab] = useState<ReportingTab>("details");
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
  const selectedArtistPaymentOption =
    artistPaymentOptions.find((option) => option.artistId === selectedArtistPaymentArtistId) ??
    artistPaymentOptions[0] ??
    null;
  const selectedArtistPaymentTotalOutstandingAmount = floorCurrency(selectedArtistPaymentOption?.totalOutstanding ?? "0");
  const totalCauseOutstanding = sumCurrency(causePayables.map((payable) => payable.totalOutstanding));
  const totalArtistOutstanding = sumCurrency(artistPayables.map((payable) => payable.totalOutstanding));
  const overdueCauseCount = causePayables.filter((payable) => payable.overdue).length;
  const overdueArtistCount = artistPayables.filter((payable) => payable.overdue).length;
  const donationPoolIsNegative = isLessThanZero(summary.track1.donationPool);
  const shopifyChargesArePositive = isGreaterThanZero(summary.track1.shopifyCharges);
  const artistPayoutsArePositive = isGreaterThanZero(summary.track1.artistPayoutTotal ?? "0");
  const trueUpShortfallIsPositive = isGreaterThanZero(summary.track1.taxTrueUpShortfallApplied);
  const selectCauseForPayment = (causeId: string) => {
    setSelectedDisbursementCauseId(causeId);
    setActiveReportingTab("cause-payments");
  };
  const selectArtistForPayment = (artistId: string) => {
    setSelectedArtistPaymentArtistId(artistId);
    setArtistPaymentDialogOpen(true);
  };
  const dashboardActionStyle = (primary: boolean, disabled: boolean): CSSProperties => ({
    borderRadius: "0.5rem",
    border: primary ? "1px solid #111" : "1px solid var(--p-color-border, #d2d5d8)",
    background: disabled ? "var(--p-color-bg-fill-disabled, #f1f1f1)" : primary ? "#111" : "var(--p-color-bg-surface, #fff)",
    color: disabled ? "var(--p-color-text-disabled, #8c9196)" : primary ? "#fff" : "var(--p-color-text, #303030)",
    padding: "0.55rem 0.8rem",
    font: "inherit",
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.7 : 1,
  });
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

  useEffect(() => {
    if (artistPaymentOptions.length === 0) {
      setSelectedArtistPaymentArtistId("");
      return;
    }

    const currentStillValid = artistPaymentOptions.some(
      (option) => option.artistId === selectedArtistPaymentArtistId,
    );

    if (!currentStillValid) {
      setSelectedArtistPaymentArtistId(artistPaymentOptions[0]?.artistId ?? "");
    }
  }, [selectedPeriodId, selectedArtistPaymentArtistId, artistPaymentOptions]);

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
        <StatusBanners
          items={[
            closeFetcher.data,
            disbursementFetcher.data,
            artistPaymentFetcher.data,
            trueUpFetcher.data,
            settlementFetcher.data,
            recalculationFetcher.data,
          ]}
        />
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
          </div>
        </s-section>

        <s-section heading="What needs attention">
          <div style={{ display: "grid", gap: "1rem" }}>
            <SectionHeader
              title={selectedPeriod?.status === "OPEN" ? "Open reporting period" : "Payables dashboard"}
              description={
                selectedPeriod?.status === "OPEN"
                  ? "Close this period when the payout window is final, then use the payable actions to record payments."
                  : "Use this summary to decide which cause or artist balances need payment next."
              }
              actions={(
                <>
                  {selectedPeriod?.status === "OPEN" ? (
                    <s-button
                      variant="primary"
                      onClick={() => setCloseDialogOpen(true)}
                      disabled={closeFetcher.state !== "idle"}
                    >
                      Close reporting period
                    </s-button>
                  ) : null}
                  <s-button
                    variant="secondary"
                    onClick={() => void exportPeriod("csv")}
                    disabled={exportingFormat !== null}
                  >
                    {exportingFormat === "csv" ? "Exporting CSV..." : "Export CSV"}
                  </s-button>
                  <s-button
                    variant="secondary"
                    onClick={() => void exportPeriod("pdf")}
                    disabled={exportingFormat !== null}
                  >
                    {exportingFormat === "pdf" ? "Exporting PDF..." : "Export PDF"}
                  </s-button>
                </>
              )}
            />

            {unresolvedExternalSettlements.length > 0 ? (
              <s-banner tone="warning">
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <s-text>
                    {unresolvedExternalSettlements.length} order{unresolvedExternalSettlements.length === 1 ? "" : "s"} appear to have been paid outside Shopify. Confirm the actual payout before closing this period.
                  </s-text>
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    {unresolvedExternalSettlements.map((settlement) => (
                      <div
                        key={settlement.id}
                        style={{
                          display: "grid",
                          gap: "0.65rem",
                          padding: "0.75rem",
                          border: "1px solid var(--p-color-border, #d2d5d8)",
                          borderRadius: "0.5rem",
                          background: "var(--p-color-bg-surface, #fff)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                          <strong>{settlement.orderNumber ?? settlement.shopifyOrderId}</strong>
                          <span>Gross {formatMoney(settlement.grossOrderAmount)} · Shopify paid {formatMoney(settlement.shopifyPaidAmount ?? "0")}</span>
                        </div>
                        {settlement.detectedReason ? <s-text color="subdued">{settlement.detectedReason}</s-text> : null}
                        <settlementFetcher.Form method="post" style={{ display: "grid", gap: "0.65rem" }}>
                          <input type="hidden" name="intent" value="confirm-order-settlement" />
                          <input type="hidden" name="settlementId" value={settlement.id} />
                          <div style={{ display: "grid", gap: "0.65rem", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))" }}>
                            <div style={{ display: "grid", gap: "0.3rem" }}>
                              <label htmlFor={`settlement-source-${settlement.id}`}>Source</label>
                              <input id={`settlement-source-${settlement.id}`} name="source" defaultValue={settlement.source} style={disbursementFieldStyle} />
                            </div>
                            <div style={{ display: "grid", gap: "0.3rem" }}>
                              <label htmlFor={`settlement-amount-${settlement.id}`}>Amount received</label>
                              <input id={`settlement-amount-${settlement.id}`} name="amountReceived" type="number" min="0" step="0.01" style={disbursementFieldStyle} />
                            </div>
                            <div style={{ display: "grid", gap: "0.3rem" }}>
                              <label htmlFor={`settlement-paid-at-${settlement.id}`}>Paid date</label>
                              <input id={`settlement-paid-at-${settlement.id}`} name="paidAt" type="date" style={disbursementFieldStyle} />
                            </div>
                            <div style={{ display: "grid", gap: "0.3rem" }}>
                              <label htmlFor={`settlement-reference-${settlement.id}`}>Reference</label>
                              <input id={`settlement-reference-${settlement.id}`} name="referenceId" style={disbursementFieldStyle} />
                            </div>
                          </div>
                          <div style={{ display: "grid", gap: "0.3rem" }}>
                            <label htmlFor={`settlement-notes-${settlement.id}`}>Notes</label>
                            <input id={`settlement-notes-${settlement.id}`} name="notes" style={disbursementFieldStyle} />
                          </div>
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button type="submit" disabled={settlementFetcher.state !== "idle"} style={dashboardActionStyle(true, false)}>
                              Confirm payout
                            </button>
                          </div>
                        </settlementFetcher.Form>
                        <settlementFetcher.Form method="post" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "end" }}>
                          <input type="hidden" name="intent" value="ignore-order-settlement" />
                          <input type="hidden" name="settlementId" value={settlement.id} />
                          <div style={{ display: "grid", gap: "0.3rem", flex: "1 1 16rem" }}>
                            <label htmlFor={`settlement-ignore-${settlement.id}`}>Ignore reason</label>
                            <input id={`settlement-ignore-${settlement.id}`} name="ignoreReason" placeholder="Required" style={disbursementFieldStyle} />
                          </div>
                          <button type="submit" disabled={settlementFetcher.state !== "idle"} style={dashboardActionStyle(false, false)}>
                            Ignore
                          </button>
                        </settlementFetcher.Form>
                      </div>
                    ))}
                  </div>
                </div>
              </s-banner>
            ) : null}

            {activeReportingTab === "cause-payments" && selectedPeriod?.status === "CLOSED" ? (
              <div id="log-disbursement" style={{ display: "grid", gap: "0.9rem" }}>
                <h2 style={{ margin: 0, fontSize: "1rem" }}>Log disbursement</h2>
                <SectionHeader
                  title="Log cause disbursement"
                  description="Record funds paid out to the selected cause. Allocated amounts auto-apply to the oldest outstanding closed balances first."
                  actions={(
                    <button
                      type="button"
                      style={dashboardActionStyle(false, false)}
                      onClick={() => setActiveReportingTab("details")}
                    >
                      Back to payables
                    </button>
                  )}
                />
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
                        <label htmlFor="disbursement-allocated-amount">Actual payout amount</label>
                        <input
                          id="disbursement-allocated-amount"
                          name="allocatedAmount"
                          type="number"
                          min="0"
                          step="0.01"
                          style={disbursementFieldStyle}
                        />
                        <s-text color="subdued" style={disbursementHelpTextStyle}>
                          Up to {formatMoney(selectedTotalOutstandingAmount)} auto-applies to outstanding allocations. Any excess is recorded as an extra contribution.
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
                        <label htmlFor="disbursement-method">Payment method (optional)</label>
                        <PaymentMethodAutocomplete id="disbursement-method" methods={paymentMethods} />
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
                    <s-table-header listSlot="secondary">Actions</s-table-header>
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
                          <s-table-cell>{disbursement.paymentMethod ?? "—"}</s-table-cell>
                          <s-table-cell>{disbursement.referenceId ?? "—"}</s-table-cell>
                          <s-table-cell>
                            {disbursement.receiptUrl ? (
                              <a href={disbursement.receiptUrl} target="_blank" rel="noreferrer">
                                View receipt
                              </a>
                            ) : "—"}
                          </s-table-cell>
                          <s-table-cell>{formatMoney(disbursement.amount)}</s-table-cell>
                          <s-table-cell>
                            <s-button variant="secondary" onClick={() => setEditDisbursement(disbursement)}>Edit</s-button>
                          </s-table-cell>
                        </s-table-row>
                      ))
                    )}
                  </s-table-body>
                </s-table>
              </div>
            ) : null}

            {activeReportingTab === "details" ? (
            <>
            <div
              style={{
                display: "grid",
                gap: "1rem",
                gridTemplateColumns: "repeat(auto-fit, minmax(20rem, 1fr))",
                alignItems: "start",
              }}
            >
              <div style={{ display: "grid", gap: "0.75rem" }}>
                <SectionHeader
                  title="Causes to pay"
                  description={`${causePayables.length} cause${causePayables.length === 1 ? "" : "s"} outstanding · ${formatMoney(totalCauseOutstanding)} total`}
                />
                {overdueCauseCount > 0 ? (
                  <s-banner tone="warning">
                    <s-text>{overdueCauseCount} cause{overdueCauseCount === 1 ? "" : "s"} include prior-period balances.</s-text>
                  </s-banner>
                ) : null}
                <div style={{ display: "grid", gap: "0.5rem", maxHeight: "24rem", overflowY: "auto", paddingRight: "0.15rem" }}>
                  {causePayables.length === 0 ? (
                    <div style={{ padding: "0.85rem", border: "1px solid var(--p-color-border, #d2d5d8)", borderRadius: "0.5rem" }}>
                      <s-text color="subdued">No causes need payment for this period.</s-text>
                    </div>
                  ) : (
                    causePayables.map((payable) => (
                      <div
                        key={payable.causeId}
                        style={{
                          display: "grid",
                          gap: "0.55rem",
                          padding: "0.85rem",
                          border: payable.overdue ? "1px solid #c26a00" : "1px solid var(--p-color-border, #d2d5d8)",
                          borderRadius: "0.5rem",
                          background: "var(--p-color-bg-surface, #fff)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
                          <div style={{ display: "grid", gap: "0.2rem" }}>
                            <strong>{payable.causeName}</strong>
                            <s-text color="subdued">{payable.is501c3 ? "501(c)3" : "Not marked 501(c)3"} · {payable.overdue ? "Prior-period balance" : "Current period only"}</s-text>
                          </div>
                          <strong style={{ color: payable.overdue ? "#8a3f00" : "inherit" }}>{formatMoney(payable.totalOutstanding)}</strong>
                        </div>
                        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                          <span>Current: {formatMoney(payable.currentOutstanding)}</span>
                          <span>Prior: {formatMoney(payable.priorOutstanding)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                          <s-text color="subdued">{payable.periods.length} reporting period{payable.periods.length === 1 ? "" : "s"}</s-text>
                          <button
                            type="button"
                            style={dashboardActionStyle(selectedPeriod?.status === "CLOSED", selectedPeriod?.status !== "CLOSED")}
                            disabled={selectedPeriod?.status !== "CLOSED"}
                            onClick={() => selectCauseForPayment(payable.causeId)}
                          >
                            Pay cause
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gap: "0.75rem" }}>
                <SectionHeader
                  title="Artists to pay"
                  description={`${artistPayables.length} artist${artistPayables.length === 1 ? "" : "s"} outstanding · ${formatMoney(totalArtistOutstanding)} total`}
                />
                {overdueArtistCount > 0 ? (
                  <s-banner tone="warning">
                    <s-text>{overdueArtistCount} artist{overdueArtistCount === 1 ? "" : "s"} include prior-period balances.</s-text>
                  </s-banner>
                ) : null}
                <div style={{ display: "grid", gap: "0.5rem", maxHeight: "24rem", overflowY: "auto", paddingRight: "0.15rem" }}>
                  {artistPayables.length === 0 ? (
                    <div style={{ padding: "0.85rem", border: "1px solid var(--p-color-border, #d2d5d8)", borderRadius: "0.5rem" }}>
                      <s-text color="subdued">No artists need payment for this period.</s-text>
                    </div>
                  ) : (
                    artistPayables.map((payable) => (
                      <div
                        key={payable.artistId}
                        style={{
                          display: "grid",
                          gap: "0.55rem",
                          padding: "0.85rem",
                          border: payable.overdue ? "1px solid #c26a00" : "1px solid var(--p-color-border, #d2d5d8)",
                          borderRadius: "0.5rem",
                          background: "var(--p-color-bg-surface, #fff)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
                          <div style={{ display: "grid", gap: "0.2rem" }}>
                            <strong>{payable.creditName}</strong>
                            <s-text color="subdued">{payable.artistName} · {payable.overdue ? "Prior-period balance" : "Current period only"}</s-text>
                          </div>
                          <strong style={{ color: payable.overdue ? "#8a3f00" : "inherit" }}>{formatMoney(payable.totalOutstanding)}</strong>
                        </div>
                        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                          <span>Current: {formatMoney(payable.currentOutstanding)}</span>
                          <span>Prior: {formatMoney(payable.priorOutstanding)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                          <s-text color="subdued">{payable.periods.length} reporting period{payable.periods.length === 1 ? "" : "s"}</s-text>
                          <button
                            type="button"
                            style={dashboardActionStyle(selectedPeriod?.status === "CLOSED", selectedPeriod?.status !== "CLOSED")}
                            disabled={selectedPeriod?.status !== "CLOSED"}
                            onClick={() => selectArtistForPayment(payable.artistId)}
                          >
                            Pay artist
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                type="button"
                style={dashboardActionStyle(false, selectedPeriod?.status !== "CLOSED")}
                disabled={selectedPeriod?.status !== "CLOSED"}
                onClick={() => setTaxTrueUpDialogOpen(true)}
              >
                Record tax true-up
              </button>
            </div>
            </>
            ) : null}
          </div>
        </s-section>

        <s-section>
          <div style={{ display: "grid", gap: "1rem" }}>
            <SectionHeader
              title="Reporting workspace"
              description="Switch between payment workflows and supporting reporting details without relying on page jumps."
            />
            <WorkflowTabs
              label="Reporting workspace"
              tabs={REPORTING_TABS}
              value={activeReportingTab}
              onChange={setActiveReportingTab}
            />
          </div>
        </s-section>

        <div style={{ display: "grid", gap: "1.5rem" }}>
          {activeReportingTab === "details" ? (
            <>
          <s-section heading="Donation pool math">
            <div style={{ display: "grid", gap: "1rem" }}>
              <SectionHeader
                title="Available for cause allocation"
                description="Track 1 starts with contribution dollars, subtracts operational obligations, applies prior tax true-ups, then produces the pool available for causes."
              />
              {donationPoolIsNegative ? (
                <s-banner tone="warning">
                  <s-text>
                    This period&apos;s donation pool is negative because Shopify charges, external settlement fees, artist payouts, or prior true-up shortfalls exceeded contribution dollars. Review the math below before closing or paying allocations.
                  </s-text>
                </s-banner>
              ) : null}
              <div
                style={{
                  display: "grid",
                  gap: "0.75rem",
                  gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))",
                }}
              >
                <MetricCard
                  label="Net contribution"
                  value={formatMoney(summary.track1.totalNetContribution)}
                  detail="Contribution dollars after line-level donation math."
                />
                <MetricCard
                  label="Shopify charges"
                  value={shopifyChargesArePositive ? `-${formatMoney(summary.track1.shopifyCharges)}` : formatMoney(summary.track1.shopifyCharges)}
                  tone={shopifyChargesArePositive ? "warning" : "subdued"}
                  detail="Fees and charge adjustments reduce the pool."
                />
                <MetricCard
                  label="External settlement fees"
                  value={externalSettlementFeesArePositive ? `-${formatMoney(summary.track1.externalSettlementFees ?? "0")}` : formatMoney(summary.track1.externalSettlementFees ?? "0")}
                  tone={externalSettlementFeesArePositive ? "warning" : "subdued"}
                  detail="Marketplace deductions entered outside Shopify."
                />
                <MetricCard
                  label="Artist payouts"
                  value={artistPayoutsArePositive ? `-${formatMoney(summary.track1.artistPayoutTotal ?? "0")}` : formatMoney(summary.track1.artistPayoutTotal ?? "0")}
                  tone={artistPayoutsArePositive ? "warning" : "subdued"}
                  detail="Artist obligations are paid before cause allocation."
                />
                <MetricCard
                  label="Tax true-up carry-forward"
                  value={`${formatMoney(summary.track1.taxTrueUpSurplusApplied)} / ${trueUpShortfallIsPositive ? `-${formatMoney(summary.track1.taxTrueUpShortfallApplied)}` : formatMoney(summary.track1.taxTrueUpShortfallApplied)}`}
                  detail="Surplus adds to the pool; shortfall reduces it."
                />
                <MetricCard
                  label="Donation pool available"
                  value={formatMoney(summary.track1.donationPool)}
                  tone={donationPoolIsNegative ? "critical" : "success"}
                  detail="Final Track 1 amount available for cause allocations."
                />
              </div>
              <div style={{ display: "grid", gap: "0.45rem" }}>
                <strong>Other reference amounts</strong>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  <span>Sales tax collected: {formatMoney(summary.track1.salesTaxCollected ?? "0")}</span>
                  <span>Surplus added: {formatMoney(summary.track1.taxTrueUpSurplusApplied)}</span>
                  <span>Shortfall deducted: {formatMoney(summary.track1.taxTrueUpShortfallApplied)}</span>
                </div>
              </div>
            </div>
          </s-section>

          <s-section heading="Packaging reconciliation">
            <div style={{ display: "grid", gap: "1rem" }}>
              {summary.packaging.reviewItems.length > 0 ? (
                <s-banner tone="warning">
                  <s-text>{summary.packaging.reviewItems.length} order(s) need packaging review for this reporting period.</s-text>
                </s-banner>
              ) : null}
              {summary.packaging.allocations.length === 0 ? (
                <s-text color="subdued">No package allocations have been recorded for this reporting period yet.</s-text>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header>Order</s-table-header>
                    <s-table-header>Package</s-table-header>
                    <s-table-header>Qty</s-table-header>
                    <s-table-header>Confidence</s-table-header>
                    <s-table-header format="currency">Material cost</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {summary.packaging.allocations.map((allocation: (typeof summary.packaging.allocations)[number]) => (
                      <s-table-row key={allocation.id}>
                        <s-table-cell>
                          <Link to={`/app/order-history/${allocation.snapshotId}`}>{allocation.orderNumber}</Link>
                        </s-table-cell>
                        <s-table-cell>
                          <strong>{allocation.packageName}</strong>
                          {allocation.reason ? <div><s-text color="subdued">{allocation.reason}</s-text></div> : null}
                        </s-table-cell>
                        <s-table-cell>{allocation.quantity}</s-table-cell>
                        <s-table-cell>{allocation.confidence}</s-table-cell>
                        <s-table-cell>{formatMoney(allocation.materialCost)}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
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
                  allocationRows.flatMap((allocation) => [
                    <s-table-row key={allocation.causeId}>
                      <s-table-cell>{allocation.causeName}</s-table-cell>
                      <s-table-cell>{allocation.is501c3 ? "Yes" : "No"}</s-table-cell>
                      <s-table-cell>{formatMoney(allocation.allocated)}</s-table-cell>
                      <s-table-cell>{formatMoney(allocation.disbursed)}</s-table-cell>
                      <s-table-cell>{formatMoney(allocation.remaining)}</s-table-cell>
                    </s-table-row>,
                    <s-table-row key={`${allocation.causeId}-details`}>
                      <s-table-cell>
                        <div style={{ display: "grid", gap: "0.45rem", paddingBlock: "0.25rem" }}>
                          <strong>Contributing order lines</strong>
                          {allocation.details.length === 0 ? (
                            <s-text color="subdued">No line-level allocation detail is available for this cause.</s-text>
                          ) : (
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(25rem, 3fr) minmax(7rem, 1fr) minmax(7rem, 1fr)",
                                gap: "0.5rem 1rem",
                                alignItems: "start",
                              }}
                            >
                              <strong>Order / line item</strong>
                              <strong>Gross</strong>
                              <strong>Allocated</strong>
                              {allocation.details.map((detail, detailIndex) => (
                                <div
                                  key={`${allocation.causeId}-${detail.kind}-${detail.orderSnapshotId ?? "adjustment"}-${detail.shopifyLineItemId ?? detailIndex}`}
                                  style={{ display: "contents" }}
                                >
                                  <span>
                                    {detail.kind === "true_up" ? (
                                      detail.label ?? "Allocation adjustment"
                                    ) : (
                                      <>
                                        {(detail.orderNumber ?? detail.shopifyOrderId)} · {detail.productTitle}
                                        {detail.variantTitle ? ` / ${detail.variantTitle}` : ""} · Qty {detail.quantity}
                                      </>
                                    )}
                                  </span>
                                  <span>{detail.grossLineAmount ? formatMoney(detail.grossLineAmount) : "--"}</span>
                                  <span>{formatMoney(detail.allocatedAmount)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                    </s-table-row>,
                  ])
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

          <s-section heading="Artist payout allocations">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Artist</s-table-header>
                <s-table-header listSlot="secondary">Credit</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Allocated</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Paid</s-table-header>
                <s-table-header listSlot="labeled" format="currency">Remaining</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {artistAllocations.length === 0 ? (
                  <s-table-row>
                    <s-table-cell>No artist payout allocations for this period.</s-table-cell>
                    <s-table-cell></s-table-cell>
                    <s-table-cell></s-table-cell>
                    <s-table-cell></s-table-cell>
                    <s-table-cell></s-table-cell>
                  </s-table-row>
                ) : (
                  artistAllocations.map((allocation) => {
                    const remaining = subtractCurrency(allocation.allocated, allocation.paid);
                    return (
                      <s-table-row key={allocation.artistId}>
                        <s-table-cell>{allocation.artistName}</s-table-cell>
                        <s-table-cell>{allocation.creditName}</s-table-cell>
                        <s-table-cell>{formatMoney(allocation.allocated)}</s-table-cell>
                        <s-table-cell>{formatMoney(allocation.paid)}</s-table-cell>
                        <s-table-cell>{formatMoney(remaining)}</s-table-cell>
                      </s-table-row>
                    );
                  })
                )}
              </s-table-body>
            </s-table>
          </s-section>

          <s-section heading="Outstanding artist payables">
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <s-text color="subdued">
                Artist payables are tracked separately from Cause disbursements and roll forward until paid.
              </s-text>
              {artistPayables.some((payable) => payable.overdue) ? (
                <s-banner tone="warning">
                  <s-text>Prior-period artist payout balances are still unpaid.</s-text>
                </s-banner>
              ) : null}
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Artist</s-table-header>
                  <s-table-header listSlot="inline">Overdue</s-table-header>
                  <s-table-header listSlot="secondary">Current period</s-table-header>
                  <s-table-header listSlot="secondary">Prior periods</s-table-header>
                  <s-table-header listSlot="secondary">Outstanding by period</s-table-header>
                  <s-table-header listSlot="labeled" format="currency">Total outstanding</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {artistPayables.length === 0 ? (
                    <s-table-row>
                      <s-table-cell>No outstanding artist payables yet.</s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                    </s-table-row>
                  ) : (
                    artistPayables.map((payable) => (
                      <s-table-row key={payable.artistId}>
                        <s-table-cell>{payable.creditName}</s-table-cell>
                        <s-table-cell>{payable.overdue ? "Needs attention" : "Current only"}</s-table-cell>
                        <s-table-cell>{formatMoney(payable.currentOutstanding)}</s-table-cell>
                        <s-table-cell>{formatMoney(payable.priorOutstanding)}</s-table-cell>
                        <s-table-cell>
                          <div style={{ display: "grid", gap: "0.2rem" }}>
                            {payable.periods.map((period) => (
                              <span key={`${payable.artistId}-${period.periodId}`}>
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

            </>
          ) : null}

          {activeReportingTab === "diagnostics" ? (
          <s-section heading="Analytical recalculation">
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <s-banner tone="info">
                <s-text>
                  Analytical only. This compares the current configuration to authoritative historical snapshot figures without mutating snapshots, allocations, disbursements, or closed periods.
                </s-text>
              </s-banner>

              <recalculationFetcher.Form method="post">
                <input type="hidden" name="intent" value="run-analytical-recalculation" />
                <input type="hidden" name="periodId" value={selectedPeriod.id} />
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "grid", gap: "0.25rem" }}>
                    <strong>Latest run</strong>
                    <s-text color="subdued">
                      {analyticalRecalculationRun
                        ? `${analyticalRecalculationRun.status} · requested ${formatDate(analyticalRecalculationRun.createdAt, locale)}`
                        : "No analytical recalculation has been run for this period yet."}
                    </s-text>
                  </div>
                  <s-button
                    type="submit"
                    disabled={
                      recalculationFetcher.state !== "idle" ||
                      analyticalRecalculationRun?.status === "queued" ||
                      analyticalRecalculationRun?.status === "running"
                    }
                  >
                    Run recalculation
                  </s-button>
                </div>
              </recalculationFetcher.Form>

              {analyticalRecalculationRun?.status === "failed" ? (
                <s-banner tone="critical">
                  <s-text>{analyticalRecalculationRun.errorMessage ?? "Analytical recalculation failed."}</s-text>
                </s-banner>
              ) : null}

              {analyticalRecalculationRun?.status === "queued" || analyticalRecalculationRun?.status === "running" ? (
                <s-banner tone="info">
                  <s-text>Analytical recalculation is running. This page will refresh when the result is ready.</s-text>
                </s-banner>
              ) : null}

              {recalculationSummary ? (
                <>
                  <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                    <div>
                      <strong>Authoritative net contribution</strong>
                      <s-text color="subdued">{formatMoney(recalculationSummary.period.authoritativeNetContribution)}</s-text>
                    </div>
                    <div>
                      <strong>Recalculated net contribution</strong>
                      <s-text color="subdued">{formatMoney(recalculationSummary.period.recalculatedNetContribution)}</s-text>
                    </div>
                    <div>
                      <strong>Net contribution delta</strong>
                      <s-text color="subdued">{formatMoney(recalculationSummary.period.netContributionDelta)}</s-text>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                    <div>
                      <strong>Authoritative donation pool</strong>
                      <s-text color="subdued">{formatMoney(recalculationSummary.period.authoritativeDonationPool)}</s-text>
                    </div>
                    <div>
                      <strong>Recalculated donation pool</strong>
                      <s-text color="subdued">{formatMoney(recalculationSummary.period.recalculatedDonationPool)}</s-text>
                    </div>
                    <div>
                      <strong>Donation pool delta</strong>
                      <s-text color="subdued">{formatMoney(recalculationSummary.period.donationPoolDelta)}</s-text>
                    </div>
                  </div>

                  <s-table>
                    <s-table-header-row>
                      <s-table-header listSlot="primary">Cause</s-table-header>
                      <s-table-header listSlot="secondary">Authoritative allocated</s-table-header>
                      <s-table-header listSlot="secondary">Recalculated allocated</s-table-header>
                      <s-table-header listSlot="labeled" format="currency">Delta</s-table-header>
                    </s-table-header-row>
                    <s-table-body>
                      {recalculationSummary.causes.length === 0 ? (
                        <s-table-row>
                          <s-table-cell>No cause deltas available.</s-table-cell>
                          <s-table-cell></s-table-cell>
                          <s-table-cell></s-table-cell>
                          <s-table-cell></s-table-cell>
                        </s-table-row>
                      ) : (
                        recalculationSummary.causes.map((cause: AnalyticalRecalculationSummary["causes"][number]) => (
                          <s-table-row key={cause.causeId}>
                            <s-table-cell>{cause.causeName}</s-table-cell>
                            <s-table-cell>{formatMoney(cause.authoritativeAllocated)}</s-table-cell>
                            <s-table-cell>{formatMoney(cause.recalculatedAllocated)}</s-table-cell>
                            <s-table-cell>{formatMoney(cause.delta)}</s-table-cell>
                          </s-table-row>
                        ))
                      )}
                    </s-table-body>
                  </s-table>
                </>
              ) : null}
            </div>
          </s-section>
          ) : null}

          {activeReportingTab === "cause-payments" && selectedPeriod?.status !== "CLOSED" ? (
            <s-section heading="Cause payments">
              <s-banner tone="info">
                <s-text>Close this reporting period before logging cause disbursements.</s-text>
              </s-banner>
            </s-section>
          ) : null}

          {activeReportingTab === "cause-payments" && selectedPeriod?.status === "CLOSED" && disbursementCauseOptions.length === 0 ? (
            <>
              <s-section id="log-disbursement" heading="Log disbursement">
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
                          <label htmlFor="disbursement-allocated-amount">Actual payout amount</label>
                          <input
                            id="disbursement-allocated-amount"
                            name="allocatedAmount"
                            type="number"
                            min="0"
                            step="0.01"
                            style={disbursementFieldStyle}
                          />
                          <s-text color="subdued" style={disbursementHelpTextStyle}>
                            Up to {formatMoney(selectedTotalOutstandingAmount)} auto-applies to outstanding allocations. Any excess is recorded as an extra contribution.
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
                          <label htmlFor="disbursement-method">Payment method (optional)</label>
                          <PaymentMethodAutocomplete id="disbursement-method-empty" methods={paymentMethods} />
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
                    <s-table-header listSlot="secondary">Actions</s-table-header>
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
                          <s-table-cell>{disbursement.paymentMethod ?? "—"}</s-table-cell>
                          <s-table-cell>{disbursement.referenceId ?? "—"}</s-table-cell>
                          <s-table-cell>
                            {disbursement.receiptUrl ? (
                              <a href={disbursement.receiptUrl} target="_blank" rel="noreferrer">
                                View receipt
                              </a>
                            ) : "—"}
                          </s-table-cell>
                          <s-table-cell>{formatMoney(disbursement.amount)}</s-table-cell>
                          <s-table-cell>
                            <s-button variant="secondary" onClick={() => setEditDisbursement(disbursement)}>Edit</s-button>
                          </s-table-cell>
                        </s-table-row>
                      ))
                    )}
                  </s-table-body>
                </s-table>
              </s-section>
            </>
          ) : null}

          {activeReportingTab === "artist-payments" && selectedPeriod?.status !== "CLOSED" ? (
            <s-section heading="Artist payments">
              <s-banner tone="info">
                <s-text>Close this reporting period before logging artist payments.</s-text>
              </s-banner>
            </s-section>
          ) : null}

          {activeReportingTab === "artist-payments" && selectedPeriod?.status === "CLOSED" ? (
            <>

              <s-section id="log-artist-payment" heading="Log artist payment">
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <s-text color="subdued">
                    Record artist payouts for this closed period. Payments auto-apply to the oldest outstanding artist payable first.
                  </s-text>
                  {artistPaymentArtistOptions.length === 0 ? (
                    <s-banner tone="info">
                      <s-text>All closed-period artist payables through this reporting period have already been fully paid.</s-text>
                    </s-banner>
                  ) : (
                    <artistPaymentFetcher.Form
                      ref={artistPaymentFormRef}
                      method="post"
                      style={{ display: "grid", gap: "0.9rem" }}
                    >
                      <input type="hidden" name="intent" value="log-artist-payment" />
                      <input type="hidden" name="periodId" value={selectedPeriod.id} />
                      <div
                        aria-live="polite"
                        aria-atomic="true"
                        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
                      >
                        {artistPaymentStatusMessage}
                      </div>

                      {artistPaymentFetcher.data && !artistPaymentFetcher.data.ok ? (
                        <s-banner tone="critical">
                          <s-text>{artistPaymentFetcher.data.message}</s-text>
                        </s-banner>
                      ) : null}

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor="artist-payment-artist">Artist</label>
                        <select
                          id="artist-payment-artist"
                          name="artistId"
                          value={selectedArtistPaymentArtistId}
                          onChange={(event) => setSelectedArtistPaymentArtistId(event.currentTarget.value)}
                          style={disbursementFieldStyle}
                        >
                          {artistPaymentOptions.map((option) => (
                            <option key={option.artistId} value={option.artistId}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {selectedArtistPaymentOption ? (
                          <div style={{ display: "grid", gap: "0.2rem" }}>
                            <s-text color="subdued">
                              Current period outstanding: {formatMoney(selectedArtistPaymentOption.currentOutstanding)}
                            </s-text>
                            <s-text color="subdued">
                              Prior-period outstanding: {formatMoney(selectedArtistPaymentOption.priorOutstanding)}
                            </s-text>
                            <s-text color="subdued">
                              Total outstanding eligible for auto-application: {formatMoney(selectedArtistPaymentOption.totalOutstanding)}
                            </s-text>
                          </div>
                        ) : null}
                        {artistPaymentFetcher.data?.fieldErrors?.artistId?.map((message) => (
                          <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                        ))}
                      </div>

                      <div style={disbursementTwoColumnGridStyle}>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="artist-payment-amount">Amount</label>
                          <input
                            id="artist-payment-amount"
                            name="amount"
                            type="number"
                            min="0"
                            max={selectedArtistPaymentTotalOutstandingAmount}
                            step="0.01"
                            style={disbursementFieldStyle}
                          />
                          <s-text color="subdued" style={disbursementHelpTextStyle}>
                            Max {formatMoney(selectedArtistPaymentTotalOutstandingAmount)}.
                          </s-text>
                          {artistPaymentFetcher.data?.fieldErrors?.amount?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="artist-payment-paid-at">Paid date</label>
                          <input
                            id="artist-payment-paid-at"
                            name="paidAt"
                            type="date"
                            defaultValue={new Date().toISOString().slice(0, 10)}
                            style={disbursementFieldStyle}
                          />
                          {artistPaymentFetcher.data?.fieldErrors?.paidAt?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                      </div>

                      <div style={disbursementTwoColumnGridStyle}>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="artist-payment-method">Payment method</label>
                          <input
                            id="artist-payment-method"
                            name="paymentMethod"
                            type="text"
                            placeholder="ACH, check, PayPal..."
                            style={disbursementFieldStyle}
                          />
                          {artistPaymentFetcher.data?.fieldErrors?.paymentMethod?.map((message) => (
                            <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                          ))}
                        </div>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor="artist-payment-reference">Reference id</label>
                          <input
                            id="artist-payment-reference"
                            name="referenceId"
                            type="text"
                            placeholder="Optional payout or check id"
                            style={disbursementFieldStyle}
                          />
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor="artist-payment-notes">Notes</label>
                        <textarea
                          id="artist-payment-notes"
                          name="notes"
                          rows={2}
                          style={{ ...disbursementFieldStyle, minHeight: "5rem", resize: "vertical" }}
                        />
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                          type="submit"
                          disabled={artistPaymentFetcher.state !== "idle"}
                          style={{
                            ...disbursementSubmitStyle,
                            cursor: artistPaymentFetcher.state !== "idle" ? "not-allowed" : "pointer",
                            opacity: artistPaymentFetcher.state !== "idle" ? 0.6 : 1,
                          }}
                        >
                          Log artist payment
                        </button>
                      </div>
                    </artistPaymentFetcher.Form>
                  )}
                </div>
              </s-section>

              <s-section heading="Artist payments">
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Artist</s-table-header>
                    <s-table-header listSlot="secondary">Paid</s-table-header>
                    <s-table-header listSlot="secondary">Applied to</s-table-header>
                    <s-table-header listSlot="secondary">Method</s-table-header>
                    <s-table-header listSlot="secondary">Reference</s-table-header>
                    <s-table-header listSlot="labeled" format="currency">Amount</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {artistPayments.length === 0 ? (
                      <s-table-row>
                        <s-table-cell>No artist payments logged for this period.</s-table-cell>
                        <s-table-cell></s-table-cell>
                        <s-table-cell></s-table-cell>
                        <s-table-cell></s-table-cell>
                        <s-table-cell></s-table-cell>
                        <s-table-cell></s-table-cell>
                      </s-table-row>
                    ) : (
                      artistPayments.map((payment) => (
                        <s-table-row key={payment.id}>
                          <s-table-cell>{payment.creditName}</s-table-cell>
                          <s-table-cell>{formatDate(payment.paidAt, locale)}</s-table-cell>
                          <s-table-cell>
                            {payment.applications.length > 0 ? (
                              <div style={{ display: "grid", gap: "0.2rem" }}>
                                {payment.applications.map((application) => (
                                  <span key={`${payment.id}-${application.periodId}`}>
                                    {formatDateRange(application.periodStartDate, application.periodEndDate, locale)}: {formatMoney(application.amount)}
                                  </span>
                                ))}
                              </div>
                            ) : "None"}
                          </s-table-cell>
                          <s-table-cell>{payment.paymentMethod}</s-table-cell>
                          <s-table-cell>{payment.referenceId ?? "-"}</s-table-cell>
                          <s-table-cell>{formatMoney(payment.amount)}</s-table-cell>
                        </s-table-row>
                      ))
                    )}
                  </s-table-body>
                </s-table>
              </s-section>
            </>
          ) : null}

          {activeReportingTab === "tax" && selectedPeriod?.status !== "CLOSED" ? (
            <s-section heading="Tax true-up">
              <s-banner tone="info">
                <s-text>Close this reporting period before recording a tax true-up.</s-text>
              </s-banner>
            </s-section>
          ) : null}

          {activeReportingTab === "tax" && selectedPeriod?.status === "CLOSED" ? (
            <>

              <s-section id="tax-true-up" heading="Tax true-up">
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

          {activeReportingTab === "details" ? (
          <>
          <s-section heading="External settlements">
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <s-text color="subdued">Marketplace or manual settlement fees deducted separately from Shopify charges.</s-text>
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Order</s-table-header>
                  <s-table-header listSlot="secondary">Source</s-table-header>
                  <s-table-header listSlot="secondary">Status</s-table-header>
                  <s-table-header listSlot="secondary">Received</s-table-header>
                  <s-table-header listSlot="secondary">Reference</s-table-header>
                  <s-table-header listSlot="labeled" format="currency">Gross</s-table-header>
                  <s-table-header listSlot="labeled" format="currency">Fee</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {externalSettlements.length === 0 ? (
                    <s-table-row>
                      <s-table-cell>No external settlements recorded for this period.</s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                    </s-table-row>
                  ) : (
                    externalSettlements.map((settlement) => (
                      <s-table-row key={settlement.id}>
                        <s-table-cell>{settlement.orderNumber ?? settlement.shopifyOrderId}</s-table-cell>
                        <s-table-cell>{settlement.source}</s-table-cell>
                        <s-table-cell>{settlement.status}</s-table-cell>
                        <s-table-cell>
                          {settlement.amountReceived ? formatMoney(settlement.amountReceived) : "—"}
                          {settlement.paidAt ? ` · ${formatDate(settlement.paidAt, locale)}` : ""}
                        </s-table-cell>
                        <s-table-cell>{settlement.referenceId ?? "—"}</s-table-cell>
                        <s-table-cell>{formatMoney(settlement.grossOrderAmount)}</s-table-cell>
                        <s-table-cell>{formatMoney(settlement.feeAmount)}</s-table-cell>
                      </s-table-row>
                    ))
                  )}
                </s-table-body>
              </s-table>
              {confirmedExternalSettlements.length > 0 ? (
                <s-text color="subdued">
                  Confirmed settlement fees deducted this period: {formatMoney(summary.track1.externalSettlementFees ?? "0")}
                </s-text>
              ) : null}
            </div>
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
          </>
          ) : null}

          {activeReportingTab === "tax" ? (
          <s-section heading="Track 2 — Tax estimation for selected period">
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
          ) : null}
        </div>
      </s-page>

      {editDisbursement ? (
        <dialog
          ref={editDisbursementDialogRef}
          onClose={() => setEditDisbursement(null)}
          style={{ border: "none", borderRadius: "1rem", padding: 0, maxWidth: "36rem", width: "calc(100% - 2rem)" }}
        >
          <editDisbursementFetcher.Form method="post" encType="multipart/form-data" style={{ display: "grid", gap: "0.9rem" }}>
            <input type="hidden" name="intent" value="edit-disbursement" />
            <input type="hidden" name="disbursementId" value={editDisbursement.id} />
            <input type="hidden" name="periodId" value={selectedPeriod?.id ?? ""} />
            <input type="hidden" name="causeId" value={editDisbursement.causeId} />
            <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
                <div style={{ display: "grid", gap: "0.25rem" }}>
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Edit disbursement</h2>
                  <s-text color="subdued">{editDisbursement.causeName}</s-text>
                </div>
                <button
                  type="button"
                  aria-label="Close edit disbursement dialog"
                  onClick={() => setEditDisbursement(null)}
                  style={{ border: "none", background: "transparent", fontSize: "1.5rem", lineHeight: 1, cursor: "pointer" }}
                >×</button>
              </div>
              {editDisbursementFetcher.data && !editDisbursementFetcher.data.ok ? (
                <s-banner tone="critical"><s-text>{editDisbursementFetcher.data.message}</s-text></s-banner>
              ) : null}
              <div style={disbursementTwoColumnGridStyle}>
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor="edit-disbursement-amount">Actual payout amount</label>
                  <input
                    id="edit-disbursement-amount"
                    name="allocatedAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={sumCurrency([editDisbursement.allocatedAmount, editDisbursement.extraContributionAmount])}
                    style={disbursementFieldStyle}
                  />
                  <s-text color="subdued">The applied and extra portions will be recalculated automatically.</s-text>
                </div>
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor="edit-disbursement-fees">Fees covered</label>
                  <input id="edit-disbursement-fees" name="feesCoveredAmount" type="number" min="0" step="0.01" defaultValue={editDisbursement.feesCoveredAmount} style={disbursementFieldStyle} />
                </div>
              </div>
              <div style={disbursementTwoColumnGridStyle}>
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor="edit-disbursement-date">Paid date</label>
                  <input id="edit-disbursement-date" name="paidAt" type="date" defaultValue={editDisbursement.paidAt.slice(0, 10)} style={disbursementFieldStyle} />
                </div>
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor="edit-disbursement-method">Payment method (optional)</label>
                  <PaymentMethodAutocomplete
                    key={editDisbursement.id}
                    id="edit-disbursement-method"
                    methods={paymentMethods}
                    defaultValue={editDisbursement.paymentMethod ?? ""}
                  />
                </div>
              </div>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <label htmlFor="edit-disbursement-reference">Reference id</label>
                <input id="edit-disbursement-reference" name="referenceId" defaultValue={editDisbursement.referenceId ?? ""} style={disbursementFieldStyle} />
              </div>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <label htmlFor="edit-disbursement-receipt">Receipt</label>
                <input
                  id="edit-disbursement-receipt"
                  name="receipt"
                  type="file"
                  accept=".pdf,image/*"
                  style={disbursementFileStyle}
                />
                <s-text color="subdued">Optional replacement. PDF or image, up to 10 MB.</s-text>
                {editDisbursement.receiptUrl ? (
                  <a href={editDisbursement.receiptUrl} target="_blank" rel="noreferrer">View current receipt</a>
                ) : null}
                {editDisbursementFetcher.data?.fieldErrors?.receipt?.map((message) => (
                  <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
                <s-button variant="secondary" onClick={() => setEditDisbursement(null)}>Cancel</s-button>
                <s-button variant="primary" type="submit" disabled={editDisbursementFetcher.state !== "idle"}>Save changes</s-button>
              </div>
            </div>
          </editDisbursementFetcher.Form>
        </dialog>
      ) : null}

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
            Are you sure you want to close this reporting period? You will not be able to edit allocations or charges afterwards. External settlement reviews must be confirmed or ignored first.
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

      {artistPaymentDialogOpen ? (
        <dialog
          ref={artistPaymentDialogRef}
          onClose={() => setArtistPaymentDialogOpen(false)}
          style={{
            border: "none",
            borderRadius: "1rem",
            padding: 0,
            maxWidth: "44rem",
            width: "calc(100% - 2rem)",
          }}
        >
          <div id="log-artist-payment" style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
              <div style={{ display: "grid", gap: "0.25rem" }}>
                <h2 style={{ margin: 0, fontSize: "1rem" }}>Log artist payment</h2>
                <s-text color="subdued">
                  Record artist payouts from the selected payable without leaving the payables dashboard.
                </s-text>
              </div>
              <div>
                <button
                  type="button"
                  aria-label="Close artist payment dialog"
                  onClick={() => setArtistPaymentDialogOpen(false)}
                  style={{ border: "none", background: "transparent", fontSize: "1.5rem", lineHeight: 1, cursor: "pointer" }}
                >
                  ×
                </button>
              </div>
            </div>
            {artistPaymentArtistOptions.length === 0 ? (
              <s-banner tone="info">
                <s-text>All closed-period artist payables through this reporting period have already been fully paid.</s-text>
              </s-banner>
            ) : (
              <artistPaymentFetcher.Form
                ref={artistPaymentFormRef}
                method="post"
                style={{ display: "grid", gap: "0.9rem" }}
              >
                <input type="hidden" name="intent" value="log-artist-payment" />
                <input type="hidden" name="periodId" value={selectedPeriod.id} />
                <div
                  aria-live="polite"
                  aria-atomic="true"
                  style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
                >
                  {artistPaymentStatusMessage}
                </div>

                {artistPaymentFetcher.data && !artistPaymentFetcher.data.ok ? (
                  <s-banner tone="critical">
                    <s-text>{artistPaymentFetcher.data.message}</s-text>
                  </s-banner>
                ) : null}

                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor="artist-payment-artist">Artist</label>
                  <select
                    id="artist-payment-artist"
                    name="artistId"
                    value={selectedArtistPaymentArtistId}
                    onChange={(event) => setSelectedArtistPaymentArtistId(event.currentTarget.value)}
                    style={disbursementFieldStyle}
                  >
                    {artistPaymentOptions.map((option) => (
                      <option key={option.artistId} value={option.artistId}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {selectedArtistPaymentOption ? (
                    <div style={{ display: "grid", gap: "0.2rem" }}>
                      <s-text color="subdued">
                        Current period outstanding: {formatMoney(selectedArtistPaymentOption.currentOutstanding)}
                      </s-text>
                      <s-text color="subdued">
                        Prior-period outstanding: {formatMoney(selectedArtistPaymentOption.priorOutstanding)}
                      </s-text>
                      <s-text color="subdued">
                        Total outstanding eligible for auto-application: {formatMoney(selectedArtistPaymentOption.totalOutstanding)}
                      </s-text>
                    </div>
                  ) : null}
                  {artistPaymentFetcher.data?.fieldErrors?.artistId?.map((message) => (
                    <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                  ))}
                </div>

                <div style={disbursementTwoColumnGridStyle}>
                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    <label htmlFor="artist-payment-amount">Amount</label>
                    <input
                      id="artist-payment-amount"
                      name="amount"
                      type="number"
                      min="0"
                      max={selectedArtistPaymentTotalOutstandingAmount}
                      step="0.01"
                      style={disbursementFieldStyle}
                    />
                    <s-text color="subdued" style={disbursementHelpTextStyle}>
                      Max {formatMoney(selectedArtistPaymentTotalOutstandingAmount)}.
                    </s-text>
                    {artistPaymentFetcher.data?.fieldErrors?.amount?.map((message) => (
                      <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    <label htmlFor="artist-payment-paid-at">Paid date</label>
                    <input
                      id="artist-payment-paid-at"
                      name="paidAt"
                      type="date"
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      style={disbursementFieldStyle}
                    />
                    {artistPaymentFetcher.data?.fieldErrors?.paidAt?.map((message) => (
                      <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                    ))}
                  </div>
                </div>

                <div style={disbursementTwoColumnGridStyle}>
                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    <label htmlFor="artist-payment-method">Payment method</label>
                    <input
                      id="artist-payment-method"
                      name="paymentMethod"
                      type="text"
                      placeholder="ACH, check, PayPal..."
                      style={disbursementFieldStyle}
                    />
                    {artistPaymentFetcher.data?.fieldErrors?.paymentMethod?.map((message) => (
                      <div key={message} style={{ color: "#8e1f0b", fontSize: "0.9rem" }}>{message}</div>
                    ))}
                  </div>
                  <div style={{ display: "grid", gap: "0.35rem" }}>
                    <label htmlFor="artist-payment-reference">Reference id</label>
                    <input
                      id="artist-payment-reference"
                      name="referenceId"
                      type="text"
                      placeholder="Optional payout or check id"
                      style={disbursementFieldStyle}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor="artist-payment-notes">Notes</label>
                  <textarea
                    id="artist-payment-notes"
                    name="notes"
                    rows={2}
                    style={{ ...disbursementFieldStyle, minHeight: "5rem", resize: "vertical" }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={dashboardActionStyle(false, false)}
                    onClick={() => setArtistPaymentDialogOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={artistPaymentFetcher.state !== "idle"}
                    style={{
                      ...disbursementSubmitStyle,
                      cursor: artistPaymentFetcher.state !== "idle" ? "not-allowed" : "pointer",
                      opacity: artistPaymentFetcher.state !== "idle" ? 0.6 : 1,
                    }}
                  >
                    Log artist payment
                  </button>
                </div>
              </artistPaymentFetcher.Form>
            )}
          </div>
        </dialog>
      ) : null}

      {taxTrueUpDialogOpen ? (
        <dialog
          ref={taxTrueUpDialogRef}
          onClose={() => setTaxTrueUpDialogOpen(false)}
          style={{
            border: "none",
            borderRadius: "1rem",
            padding: 0,
            maxWidth: "44rem",
            width: "calc(100% - 2rem)",
          }}
        >
          <div id="tax-true-up" style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
              <div style={{ display: "grid", gap: "0.25rem" }}>
                <h2 style={{ margin: 0, fontSize: "1rem" }}>Tax true-up</h2>
                <s-text color="subdued">
                  Record actual tax paid from the payables dashboard without leaving the current worklist.
                </s-text>
              </div>
              <div>
                <button
                  type="button"
                  aria-label="Close tax true-up dialog"
                  onClick={() => setTaxTrueUpDialogOpen(false)}
                  style={{ border: "none", background: "transparent", fontSize: "1.5rem", lineHeight: 1, cursor: "pointer" }}
                >
                  ×
                </button>
              </div>
            </div>

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

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={dashboardActionStyle(false, false)}
                    onClick={() => setTaxTrueUpDialogOpen(false)}
                  >
                    Cancel
                  </button>
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
          </div>
        </dialog>
      ) : null}
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
