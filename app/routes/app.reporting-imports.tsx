import { jsonResponse } from "~/utils/json-response.server";
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useRouteError, useSubmit } from "@remix-run/react";
import { AssignmentPicker } from "../components/AssignmentControls";
import { prisma } from "../db.server";
import {
  importHistoricalCharges,
  importHistoricalOrders,
  importHistoricalPayouts,
  parseHistoricalImportRows,
  rebuildAllReporting,
  rebuildReportingPeriod,
  replaceOrderSnapshots,
} from "../services/historicalBackfill.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { useAppLocalization } from "../utils/use-app-localization";

type ActionData = {
  ok: boolean;
  message: string;
  actionKind?: "import" | "rebuild" | "replacement";
  summary?: unknown;
  importPayload?: string;
  importKind?: string | null;
  sourceName?: string | null;
  mappingOverrides?: Record<string, string>;
  replacementReason?: string;
  forceClosed?: boolean;
};

type LineMappingRequest = {
  key: string;
  title: string;
  variantTitle: string;
  sku: string | null;
  reason: "unresolved" | "ambiguous";
  candidates: Array<{
    shopifyVariantId: string;
    label: string;
    matchReason: string;
  }>;
};

type VariantOption = {
  shopifyId: string;
  label: string;
};

type PeriodOption = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
  source: string;
  shopifyPayoutId: string | null;
};

type ImportBatchRow = {
  id: string;
  kind: string;
  status: string;
  sourceName: string | null;
  sourceType: string | null;
  summary: unknown;
  createdAt: string;
  completedAt: string | null;
};

type LoaderData = {
  periods: PeriodOption[];
  batches: ImportBatchRow[];
  variants: VariantOption[];
};

type RebuildMetricSnapshot = {
  orderLineCount: number;
  grossSales: string;
  totalCost: string;
  totalNetContribution: string;
  shopifyCharges: string;
  donationPool: string;
  causeAllocationTotal: string;
  artistPayoutTotal: string;
  causeAllocationCount: number;
  artistAllocationCount: number;
};

type RebuildMetricDelta = RebuildMetricSnapshot;

type RebuildPeriodResult = {
  periodId: string;
  periodStartDate: string;
  periodEndDate: string;
  before: RebuildMetricSnapshot;
  after: RebuildMetricSnapshot;
  delta: RebuildMetricDelta;
};

const TIP_MAPPING_VALUE = "__TIP__";
const CUSTOM_MAPPING_VALUE = "__CUSTOM__";

function actionJson(data: ActionData, init?: ResponseInit) {
  return jsonResponse(data, init);
}

function actionKindForIntent(intent: string | undefined): ActionData["actionKind"] {
  if (intent === "dry-run-import" || intent === "apply-import") return "import";
  if (intent === "rebuild-period" || intent === "rebuild-all") return "rebuild";
  if (intent === "dry-run-replace-snapshots" || intent === "replace-snapshots") return "replacement";
  return undefined;
}

function importOutcomeMessage(
  label: string,
  summary: {
    totalRows: number;
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ row: number }>;
    lineMappingRequests?: unknown[];
  },
  dryRun: boolean,
): string {
  const affectedRows = new Set(summary.errors.map((error) => error.row)).size;
  const mappingCount = summary.lineMappingRequests?.length ?? 0;
  const readyOrImported = summary.created + summary.updated;
  if (dryRun) {
    if (mappingCount > 0) {
      return `${label} dry run found ${mappingCount} line mapping(s) that need attention. Review them below before importing.`;
    }
    return affectedRows > 0
      ? `${label} dry run found ${affectedRows} row(s) that need attention. ${readyOrImported} of ${summary.totalRows} rows are ready.`
      : `${label} dry run complete. All ${summary.totalRows} rows are ready.`;
  }
  return affectedRows > 0
    ? `${label} import completed with issues. ${readyOrImported} of ${summary.totalRows} rows were imported; ${affectedRows} need attention${summary.skipped > 0 ? `; ${summary.skipped} were skipped` : ""}.`
    : `${label} import complete. ${readyOrImported} rows were imported${summary.skipped > 0 ? ` and ${summary.skipped} were skipped` : ""}.`;
}

function formatDate(value: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

type ImportIssue = { row: number; message: string };
type ReplacementResult = {
  row: number;
  shopifyOrderId: string;
  orderNumber: string | null;
  status: string;
  lineCount: number;
  totalCost: string;
  netContribution: string;
};
type ReadableImportSummary = {
  kind: string;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  warnings: ImportIssue[];
  errors: ImportIssue[];
  lineMappingRequests: LineMappingRequest[];
  replacementResults: ReplacementResult[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readCount(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readIssues(value: unknown): ImportIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((issue) => {
    if (!isRecord(issue) || typeof issue.row !== "number" || typeof issue.message !== "string") return [];
    return [{ row: issue.row, message: issue.message }];
  });
}

function readImportSummary(summary: unknown): ReadableImportSummary | null {
  if (!isRecord(summary) || typeof summary.kind !== "string") return null;
  const mappings = Array.isArray(summary.lineMappingRequests)
    ? summary.lineMappingRequests.filter((request): request is LineMappingRequest => (
        isRecord(request) && typeof request.key === "string" && typeof request.title === "string"
      ))
    : [];
  const replacementResults = Array.isArray(summary.replacementResults)
    ? summary.replacementResults.filter((result): result is ReplacementResult => (
        isRecord(result) &&
        typeof result.row === "number" &&
        typeof result.shopifyOrderId === "string" &&
        typeof result.status === "string" &&
        typeof result.lineCount === "number" &&
        typeof result.totalCost === "string" &&
        typeof result.netContribution === "string"
      ))
    : [];

  return {
    kind: summary.kind,
    totalRows: readCount(summary, "totalRows"),
    created: readCount(summary, "created"),
    updated: readCount(summary, "updated"),
    skipped: readCount(summary, "skipped"),
    warnings: readIssues(summary.warnings),
    errors: readIssues(summary.errors),
    lineMappingRequests: mappings,
    replacementResults,
  };
}

function importActionTone(data: ActionData): "success" | "warning" | "critical" {
  if (data.ok) return "success";
  const summary = readImportSummary(data.summary);
  if (summary && (summary.created > 0 || summary.updated > 0 || summary.lineMappingRequests.length > 0)) {
    return "warning";
  }
  return "critical";
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatRowRanges(rows: number[]): string {
  const sorted = [...new Set(rows)].sort((left, right) => left - right);
  const ranges: string[] = [];
  let start = sorted[0];
  let end = start;
  for (const row of sorted.slice(1)) {
    if (row === (end ?? row) + 1) {
      end = row;
      continue;
    }
    if (start !== undefined && end !== undefined) ranges.push(start === end ? `${start}` : `${start}–${end}`);
    start = row;
    end = row;
  }
  if (start !== undefined && end !== undefined) ranges.push(start === end ? `${start}` : `${start}–${end}`);
  return ranges.join(", ");
}

function groupedIssues(issues: ImportIssue[]): Array<{ message: string; rows: number[] }> {
  const groups = new Map<string, number[]>();
  for (const issue of issues) groups.set(issue.message, [...(groups.get(issue.message) ?? []), issue.row]);
  return Array.from(groups, ([message, rows]) => ({ message, rows }));
}

function resolutionForIssue(message: string): { text: string; href?: string; linkLabel?: string } {
  const normalized = message.toLowerCase();
  if (normalized.includes("line item mapping") || normalized.includes("could not be matched") || normalized.includes("unresolved line")) {
    return { text: "In Historical import, run the order dry run again, then map the line to a variant or classify it as a tip or custom item." };
  }
  if (normalized.includes("not synced in count on us") || normalized.includes("missing variant id") || normalized.includes("no variant id")) {
    return { text: "Sync the Shopify catalog, return here, and run the dry run again. If the line is intentionally non-catalog, classify it as a tip or custom item.", href: "/app/products", linkLabel: "Sync Shopify catalog" };
  }
  if (normalized.includes("no cost configuration")) {
    return { text: "Configure production costs for the named variant, then replace the affected snapshot so its financial values are recalculated.", href: "/app/variants", linkLabel: "Open variants" };
  }
  if (normalized.includes("no cause or artist routing")) {
    return { text: "Assign Cause or Artist routing to the named product, then replace the affected snapshot to freeze the corrected routing.", href: "/app/products", linkLabel: "Open products" };
  }
  if (normalized.includes("lifecycle evidence") || normalized.includes("payment, cancellation, or refund status")) {
    return { text: "Review the affected order and confirm whether it is active, canceled, or fully refunded.", href: "/app/order-history?review=required", linkLabel: "Review order lifecycles" };
  }
  if (normalized.includes("reporting period")) {
    return { text: "Import a payout/reporting period covering the row date, then rebuild that period so the imported record is attached to it." };
  }
  if (normalized.includes("no existing snapshot") || normalized.includes("no existing snapshot was found")) {
    return { text: "Import this order through Historical import first. After its initial snapshot exists, rerun Snapshot replacement." };
  }
  if (normalized.includes("closed period")) {
    return { text: "Review the dry run, enable Force closed-period replacement, enter REPLACE, and rebuild the affected period afterward." };
  }
  if (normalized.includes("payout id") || normalized.includes("stable payout")) {
    return { text: "Use a Shopify Payments export containing the Payout ID column, or add shopifyPayoutId to the JSON row, then retry." };
  }
  if (normalized.includes("order id") || normalized.includes("admin_graphql_api_id")) {
    return { text: "Use a Shopify Orders export containing the ID column, or add admin_graphql_api_id with the Shopify order GID to the JSON row." };
  }
  if (normalized.includes("startdate") || normalized.includes("enddate")) {
    return { text: "Correct startDate and endDate using valid dates, with endDate later than startDate, then retry." };
  }
  if (normalized.includes("amount")) {
    return { text: "Correct the row amount to a positive monetary value and rerun the dry run before importing." };
  }
  if (normalized.includes("no line items")) {
    return { text: "Export the order again with Shopify line-item columns included. If it genuinely has no merchandise, remove it from this import." };
  }
  if (normalized.includes("custom line")) {
    return { text: "Confirm that zero production cost and no product-specific routing are intended. Otherwise map the line to a synced variant." };
  }
  return { text: "Use the listed row numbers to correct the source data, then run Dry run again. If the message remains, retain the source filename and batch date when contacting support." };
}

function IssueDetails({ label, issues, open }: { label: string; issues: ImportIssue[]; open: boolean }) {
  if (issues.length === 0) return null;
  return (
    <details open={open}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>{label} ({issues.length})</summary>
      <ul style={{ margin: "0.6rem 0 0", paddingLeft: "1.25rem", display: "grid", gap: "0.45rem" }}>
        {groupedIssues(issues).map((group) => (
          <li key={group.message}>
            <div>{group.message} <span style={{ color: "var(--p-color-text-secondary, #616161)" }}>Rows {formatRowRanges(group.rows)}</span></div>
            {(() => {
              const resolution = resolutionForIssue(group.message);
              return (
                <div style={{ marginTop: "0.2rem", color: "var(--p-color-text-secondary, #616161)" }}>
                  <strong>How to resolve:</strong> {resolution.text}{" "}
                  {resolution.href ? <Link to={resolution.href}>{resolution.linkLabel ?? "Open resolution page"}</Link> : null}
                </div>
              );
            })()}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ImportSummaryDisplay({
  summary,
  compact = false,
  formatMoney,
}: {
  summary: unknown;
  compact?: boolean;
  formatMoney: (value: string | number) => string;
}) {
  const readable = readImportSummary(summary);
  if (!readable) return <s-text>Summary details are unavailable for this entry.</s-text>;

  const metrics = [
    ["Rows", readable.totalRows],
    ["Created", readable.created],
    ["Updated", readable.updated],
    ["Skipped", readable.skipped],
    ["Errors", readable.errors.length],
    ["Warnings", readable.warnings.length],
  ] as const;

  return (
    <div style={{ display: "grid", gap: "0.65rem", marginTop: compact ? 0 : "0.75rem", minWidth: compact ? "24rem" : undefined }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem 1rem" }}>
        {metrics.map(([label, value]) => (
          <span key={label}><strong>{label}:</strong> {value.toLocaleString()}</span>
        ))}
      </div>
      {readable.errors.length === 0 && readable.warnings.length === 0 ? (
        <span>No errors or warnings.</span>
      ) : null}
      <IssueDetails label="Errors" issues={readable.errors} open={!compact} />
      <IssueDetails label="Warnings" issues={readable.warnings} open={false} />
      {readable.lineMappingRequests.length > 0 ? (
        <details open={!compact}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Line mappings required ({readable.lineMappingRequests.length})
          </summary>
          <ul style={{ margin: "0.6rem 0 0", paddingLeft: "1.25rem" }}>
            {readable.lineMappingRequests.map((request) => (
              <li key={request.key}>
                {request.title} — {request.variantTitle}{request.sku ? ` (${request.sku})` : ""}: {humanize(request.reason)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {readable.replacementResults.length > 0 ? (
        <details open={!compact}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            Snapshot replacement results ({readable.replacementResults.length})
          </summary>
          <div style={{ overflowX: "auto", marginTop: "0.6rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead><tr><th>Row</th><th>Order</th><th>Result</th><th>Lines</th><th>Cost</th><th>Net contribution</th></tr></thead>
              <tbody>
                {readable.replacementResults.map((result) => (
                  <tr key={`${result.row}:${result.shopifyOrderId}`}>
                    <td>{result.row}</td>
                    <td>{result.orderNumber ?? result.shopifyOrderId}</td>
                    <td>{humanize(result.status)}</td>
                    <td>{result.lineCount}</td>
                    <td>{formatMoney(result.totalCost)}</td>
                    <td>{formatMoney(result.netContribution)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function actionableFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "The operation failed for an unknown reason.";
  return `${detail} If that message does not identify a correction, refresh the page and rerun the dry run. If it happens again, contact support with the source filename, import type, and time of the attempt.`;
}

function isRebuildPeriodResult(value: unknown): value is RebuildPeriodResult {
  return Boolean(
    value &&
    typeof value === "object" &&
    "periodStartDate" in value &&
    "periodEndDate" in value &&
    "before" in value &&
    "after" in value &&
    "delta" in value,
  );
}

function rebuildPeriodResults(summary: unknown): RebuildPeriodResult[] {
  if (isRebuildPeriodResult(summary)) return [summary];
  if (!Array.isArray(summary)) return [];
  return summary.filter(isRebuildPeriodResult);
}

function lineMappingRequests(summary: unknown): LineMappingRequest[] {
  if (!summary || typeof summary !== "object" || !("lineMappingRequests" in summary)) return [];
  const requests = (summary as { lineMappingRequests?: unknown }).lineMappingRequests;
  return Array.isArray(requests) ? (requests as LineMappingRequest[]) : [];
}

function buildMappingOptions(request: LineMappingRequest, variants: VariantOption[]) {
  const candidateIds = new Set(request.candidates.map((candidate) => candidate.shopifyVariantId));
  return [
    {
      value: TIP_MAPPING_VALUE,
      label: "Treat as tip / non-merchandise",
      description: "Keep in order totals, but exclude from product costs, packaging, discounts, and donation routing.",
    },
    {
      value: CUSTOM_MAPPING_VALUE,
      label: "Treat as custom merchandise",
      description: "Import with zero recorded production cost and no product-specific donation routing.",
    },
    ...request.candidates.map((candidate) => ({
      value: candidate.shopifyVariantId,
      label: `${candidate.label} (${candidate.matchReason})`,
      description: "Suggested product / variant match",
    })),
    ...variants
      .filter((variant) => !candidateIds.has(variant.shopifyId))
      .map((variant) => ({ value: variant.shopifyId, label: variant.label, description: "Product / variant" })),
  ];
}

async function readImportPayload(formData: FormData) {
  const uploadedFile = formData.get("payloadFile");
  if (uploadedFile instanceof File && uploadedFile.size > 0) {
    return {
      payload: await uploadedFile.text(),
      fileName: uploadedFile.name,
    };
  }

  return {
    payload: formData.get("payload")?.toString() ?? "",
    fileName: null,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<Response> => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const [periods, batches, variants] = await Promise.all([
    prisma.reportingPeriod.findMany({
      where: { shopId },
      orderBy: { startDate: "desc" },
      take: 100,
      select: {
        id: true,
        startDate: true,
        endDate: true,
        status: true,
        shopifyPayoutId: true,
        source: true,
      },
    }),
    prisma.importBatch.findMany({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        kind: true,
        status: true,
        sourceName: true,
        sourceType: true,
        summary: true,
        createdAt: true,
        completedAt: true,
      },
    }),
    prisma.variant.findMany({
      where: { shopId },
      orderBy: [{ product: { title: "asc" } }, { title: "asc" }],
      take: 500,
      select: {
        shopifyId: true,
        sku: true,
        title: true,
        product: { select: { title: true } },
      },
    }),
  ]);

  const data = {
    periods: periods.map((period) => ({
      id: period.id,
      label: `${formatDate(period.startDate.toISOString())} - ${formatDate(period.endDate.toISOString())}${period.shopifyPayoutId ? ` (${period.shopifyPayoutId})` : ""}`,
      startDate: period.startDate.toISOString(),
      endDate: period.endDate.toISOString(),
      status: period.status,
      source: period.source,
      shopifyPayoutId: period.shopifyPayoutId,
    })),
    batches: batches.map((batch) => ({
      id: batch.id,
      kind: batch.kind,
      status: batch.status,
      sourceName: batch.sourceName,
      sourceType: batch.sourceType,
      summary: batch.summary,
      createdAt: batch.createdAt.toISOString(),
      completedAt: batch.completedAt?.toISOString() ?? null,
    })),
    variants: variants.map<VariantOption>((variant) => ({
      shopifyId: variant.shopifyId,
      label: `${variant.product.title} - ${variant.title}${variant.sku ? ` (${variant.sku})` : ""}`,
    })),
  } satisfies LoaderData;

  return jsonResponse(data);
};

function parseVariantMappings(formData: FormData) {
  const mappings: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("variantMapping:")) continue;
    const mappingKey = key.slice("variantMapping:".length);
    const variantId = value.toString().trim();
    if (mappingKey && variantId) mappings[mappingKey] = variantId;
  }
  return mappings;
}

export const action = async ({ request }: ActionFunctionArgs): Promise<Response> => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  try {
    if (intent === "dry-run-import" || intent === "apply-import") {
      const kind = formData.get("kind")?.toString();
      const { payload, fileName } = await readImportPayload(formData);
      const sourceName = formData.get("sourceName")?.toString().trim() || fileName || null;
      const rows = parseHistoricalImportRows(payload, kind);
      const dryRun = intent === "dry-run-import";
      const mappingOverrides = parseVariantMappings(formData);

      if (kind === "payouts") {
        const summary = await importHistoricalPayouts({ shopId, rows, dryRun, sourceName });
        return actionJson({ ok: summary.errors.length === 0, message: importOutcomeMessage("Payout", summary, dryRun), actionKind: "import", summary, importPayload: payload, importKind: kind, sourceName });
      }

      if (kind === "charges") {
        const summary = await importHistoricalCharges({ shopId, rows, dryRun, sourceName });
        return actionJson({ ok: summary.errors.length === 0, message: importOutcomeMessage("Charge", summary, dryRun), actionKind: "import", summary, importPayload: payload, importKind: kind, sourceName });
      }

      if (kind === "orders") {
        const summary = await importHistoricalOrders({ shopId, rows, dryRun, sourceName, mappingOverrides });
        return actionJson({ ok: summary.errors.length === 0 && (summary.lineMappingRequests?.length ?? 0) === 0, message: importOutcomeMessage("Order", summary, dryRun), actionKind: "import", summary, importPayload: payload, importKind: kind, sourceName, mappingOverrides });
      }

      return actionJson({ ok: false, message: "Select Payouts, Shopify charges, or Orders under Import type, then run the dry run again.", actionKind: "import" }, { status: 400 });
    }

    if (intent === "rebuild-period") {
      const periodId = formData.get("periodId")?.toString() ?? "";
      if (!periodId) {
        return actionJson({ ok: false, message: "Choose a reporting period from the Period list, then select Rebuild period again.", actionKind: "rebuild" }, { status: 400 });
      }
      const result = await rebuildReportingPeriod({ shopId, periodId });
      return actionJson({ ok: true, message: "Reporting period rebuilt. Results are shown below.", actionKind: "rebuild", summary: result });
    }

    if (intent === "rebuild-all") {
      const result = await rebuildAllReporting({ shopId });
      return actionJson({ ok: true, message: "Reporting history rebuilt. Results are shown below.", actionKind: "rebuild", summary: result });
    }

    if (intent === "dry-run-replace-snapshots" || intent === "replace-snapshots") {
      const { payload, fileName } = await readImportPayload(formData);
      const rows = parseHistoricalImportRows(payload, "orders");
      const dryRun = intent === "dry-run-replace-snapshots";
      const forceClosed = formData.get("forceClosed") === "on";
      const replacementReason = formData.get("replacementReason")?.toString().trim() ?? "";
      const confirmation = formData.get("replacementConfirmation")?.toString().trim() ?? "";
      const sourceName = formData.get("sourceName")?.toString().trim() || fileName || null;
      const mappingOverrides = parseVariantMappings(formData);

      if (!dryRun && confirmation !== "REPLACE") {
        return actionJson(
          { ok: false, message: "Enter REPLACE in the confirmation field exactly as shown, then submit the snapshot replacement again.", actionKind: "replacement", importPayload: payload, importKind: "orders", sourceName, mappingOverrides, replacementReason, forceClosed },
          { status: 400 },
        );
      }

      const summary = await replaceOrderSnapshots({
        shopId,
        rows,
        dryRun,
        forceClosed,
        replacementReason,
        sourceName,
        mappingOverrides,
      });
      return actionJson({
        ok: summary.errors.length === 0 && (summary.lineMappingRequests?.length ?? 0) === 0,
        message: dryRun
          ? importOutcomeMessage("Snapshot replacement", summary, true)
          : `${importOutcomeMessage("Snapshot replacement", summary, false)} Rebuild affected reporting periods after reviewing the results.`,
        actionKind: "replacement",
        summary,
        importPayload: payload,
        importKind: "orders",
        sourceName,
        mappingOverrides,
        replacementReason,
        forceClosed,
      });
    }

    return actionJson({ ok: false, message: "The requested action is no longer available. Refresh this page and retry using the displayed controls." }, { status: 400 });
  } catch (error) {
    return actionJson(
      { ok: false, message: actionableFailureMessage(error), actionKind: actionKindForIntent(intent) },
      { status: 400 },
    );
  }
};

export default function ReportingImportsPage() {
  const { periods, batches, variants } = useLoaderData() as LoaderData;
  const actionData = useActionData() as ActionData | undefined;
  const navigation = useNavigation();
  const submit = useSubmit();
  const { formatMoney, locale } = useAppLocalization();
  const importFormRef = useRef<HTMLFormElement>(null);
  const mappingFormRef = useRef<HTMLFormElement>(null);
  const replacementFormRef = useRef<HTMLFormElement>(null);
  const replacementMappingFormRef = useRef<HTMLFormElement>(null);
  const reviewedReplacementFormRef = useRef<HTMLFormElement>(null);
  const [pendingMappings, setPendingMappings] = useState<Record<string, string>>({});
  const [pendingReplacementMappings, setPendingReplacementMappings] = useState<Record<string, string>>({});
  const busy = navigation.state !== "idle";
  const submittingIntent = navigation.formData?.get("intent")?.toString();
  const isRebuildSubmitting = submittingIntent === "rebuild-period" || submittingIntent === "rebuild-all";
  const isReplacementSubmitting = submittingIntent === "dry-run-replace-snapshots" || submittingIntent === "replace-snapshots";
  const importActionData = actionData?.actionKind === "import" ? actionData : null;
  const rebuildActionData = actionData?.actionKind === "rebuild" ? actionData : null;
  const replacementActionData = actionData?.actionKind === "replacement" ? actionData : null;
  const rebuildResults = rebuildPeriodResults(rebuildActionData?.summary);
  const statusMessage = isRebuildSubmitting
    ? "Rebuild in progress."
    : isReplacementSubmitting
      ? "Snapshot replacement in progress."
      : actionData?.message ?? "";
  const mappingRequests = lineMappingRequests(importActionData?.summary);
  const replacementMappingRequests = lineMappingRequests(replacementActionData?.summary);
  const mappingOverrides = actionData?.mappingOverrides ?? {};
  const hasReviewedMappings = importActionData?.importKind === "orders" &&
    Boolean(importActionData.importPayload) &&
    Object.keys(mappingOverrides).length > 0 &&
    mappingRequests.length === 0 &&
    importActionData.message.includes("dry run");

  useEffect(() => {
    setPendingMappings(importActionData?.mappingOverrides ?? {});
  }, [importActionData]);

  useEffect(() => {
    setPendingReplacementMappings(replacementActionData?.mappingOverrides ?? {});
  }, [replacementActionData]);

  const allMappingsSelected = mappingRequests.every((request) => Boolean(pendingMappings[request.key]));
  const allReplacementMappingsSelected = replacementMappingRequests.every(
    (request) => Boolean(pendingReplacementMappings[request.key]),
  );
  const hasReviewedReplacement = Boolean(
    replacementActionData?.importPayload &&
    replacementMappingRequests.length === 0 &&
    replacementActionData.message.includes("dry run"),
  );

  const submitWithIntent = (form: HTMLFormElement | null, intent: string) => {
    if (!form) return;
    const formData = new FormData(form);
    formData.set("intent", intent);
    void submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  return (
    <>
      <ui-title-bar title="Imports & rebuild" />
      <style>
        {`
          @keyframes reporting-imports-spin {
            to { transform: rotate(360deg); }
          }
        `}
      </style>
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
        {actionData && !actionData.actionKind ? (
          <s-banner tone={actionData.ok ? "success" : "critical"}>
            <s-text>{actionData.message}</s-text>
          </s-banner>
        ) : null}

        <s-section heading="Historical import">
          <div style={{ display: "grid", gap: "1rem" }}>
            {importActionData ? (
              <s-banner tone={importActionTone(importActionData)}>
                <s-text>{importActionData.message}</s-text>
                {importActionData.summary ? (
                  <ImportSummaryDisplay summary={importActionData.summary} formatMoney={formatMoney} />
                ) : null}
              </s-banner>
            ) : null}
            <s-text>
              Import Shopify CSV exports or JSON arrays for payouts, Shopify charges, and orders. Historical order snapshots use the current Count On Us configuration at import time.
            </s-text>
            <Form ref={importFormRef} method="post" encType="multipart/form-data" style={{ display: "grid", gap: "1rem" }}>
              <div style={{ display: "grid", gap: "0.4rem" }}>
                <label htmlFor="kind">Import type</label>
                <select id="kind" name="kind" style={{ maxWidth: "24rem", padding: "0.65rem", font: "inherit" }}>
                  <option value="payouts">Payouts / reporting periods</option>
                  <option value="charges">Shopify charges</option>
                  <option value="orders">Orders</option>
                </select>
              </div>

              <s-text-field label="Source name" name="sourceName" placeholder="Optional filename or export name" />

              <div style={{ display: "grid", gap: "0.4rem" }}>
                <label htmlFor="payloadFile">Import file</label>
                <input id="payloadFile" name="payloadFile" type="file" accept="text/csv,application/csv,application/json,.csv,.json" />
                <s-text color="subdued">Choose a Shopify CSV or JSON export file, or paste JSON below for a quick dry run.</s-text>
              </div>

              <div style={{ display: "grid", gap: "0.4rem" }}>
                <label htmlFor="payload">JSON or CSV fallback</label>
                <textarea
                  id="payload"
                  name="payload"
                  rows={12}
                  placeholder='[{"shopifyPayoutId":"123","startDate":"2026-01-01","endDate":"2026-01-15"}]'
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid var(--p-color-border, #d2d5d8)",
                    borderRadius: "0.5rem",
                    font: "inherit",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  }}
                />
              </div>

              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <s-button type="button" variant="secondary" disabled={busy} onClick={() => submitWithIntent(importFormRef.current, "dry-run-import")}>
                  Dry run
                </s-button>
                <s-button type="button" variant="primary" disabled={busy} onClick={() => submitWithIntent(importFormRef.current, "apply-import")}>
                  Import
                </s-button>
              </div>
            </Form>

            {importActionData?.importKind === "orders" && importActionData.importPayload && mappingRequests.length > 0 ? (
              <Form ref={mappingFormRef} method="post" style={{ display: "grid", gap: "1rem" }}>
                <input type="hidden" name="kind" value="orders" />
                <input type="hidden" name="sourceName" value={importActionData.sourceName ?? ""} />
                <textarea name="payload" value={importActionData.importPayload} readOnly hidden />
                <s-banner tone="warning">
                  <s-text>Some order lines need a product/variant mapping or non-product classification before import.</s-text>
                </s-banner>
                <div style={{ display: "grid", gap: "0.85rem" }}>
                  {mappingRequests.map((request) => {
                    const options = buildMappingOptions(request, variants);
                    const selectedVariantId = pendingMappings[request.key] ?? "";
                    const selectedOption = options.find((option) => option.value === selectedVariantId);
                    return (
                      <div key={request.key} style={{ display: "grid", gap: "0.5rem" }}>
                        <span>
                          {request.title} - {request.variantTitle}
                          {request.sku ? ` (${request.sku})` : ""}
                        </span>
                        <input
                          type="hidden"
                          name={`variantMapping:${request.key}`}
                          value={selectedVariantId}
                        />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                          <s-text color={selectedOption ? undefined : "subdued"}>
                            {selectedOption?.label ?? "No line handling selected"}
                          </s-text>
                          <AssignmentPicker
                            id={`historical-line-mapping-${request.key.replace(/[^a-z0-9]+/gi, "-")}`}
                            label={`Choose line handling for ${request.title}`}
                            triggerLabel={selectedOption ? "Change handling" : "Choose line handling"}
                            options={options.map((option) => ({
                              id: option.value,
                              label: option.label,
                              description: option.description,
                            }))}
                            selectedIds={selectedVariantId ? new Set([selectedVariantId]) : new Set()}
                            onAdd={(ids) => {
                              const variantId = ids[0];
                              if (!variantId) return;
                              setPendingMappings((current) => ({ ...current, [request.key]: variantId }));
                            }}
                            multi={false}
                            hideSelected={false}
                            searchPlaceholder="Search products, variants, SKUs, tip, or custom"
                            emptyText="No matching products or variants found."
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <s-button type="button" variant="secondary" disabled={busy || !allMappingsSelected} onClick={() => submitWithIntent(mappingFormRef.current, "dry-run-import")}>
                    Dry run with mappings
                  </s-button>
                  <s-button type="button" variant="primary" disabled={busy || !allMappingsSelected} onClick={() => submitWithIntent(mappingFormRef.current, "apply-import")}>
                    Import with mappings
                  </s-button>
                </div>
              </Form>
            ) : null}

            {hasReviewedMappings ? (
              <Form ref={reviewedReplacementFormRef} method="post" style={{ display: "grid", gap: "1rem" }}>
                <input type="hidden" name="intent" value="apply-import" />
                <input type="hidden" name="kind" value="orders" />
                <input type="hidden" name="sourceName" value={importActionData?.sourceName ?? ""} />
                <textarea name="payload" value={importActionData?.importPayload ?? ""} readOnly hidden />
                {Object.entries(mappingOverrides).map(([key, value]) => (
                  <input key={key} type="hidden" name={`variantMapping:${key}`} value={value} />
                ))}
                <s-banner tone="success">
                  <s-text>Mappings look ready. Import will save these choices for future historical imports.</s-text>
                </s-banner>
                <div>
                  <s-button type="submit" variant="primary" disabled={busy}>
                    Import with reviewed mappings
                  </s-button>
                </div>
              </Form>
            ) : null}
          </div>
        </s-section>

        <s-section heading="Snapshot replacement">
          <div style={{ display: "grid", gap: "1rem" }}>
            <s-banner tone="warning">
              <s-text>
                Snapshot replacement recomputes order cost snapshots from the uploaded order payload and current Count On Us configuration. Use dry run first, then rebuild affected reporting periods after replacement.
              </s-text>
            </s-banner>
            {isReplacementSubmitting ? (
              <s-banner tone="info">
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: "1rem",
                      height: "1rem",
                      border: "2px solid currentColor",
                      borderTopColor: "transparent",
                      borderRadius: "999px",
                      animation: "reporting-imports-spin 0.8s linear infinite",
                      flex: "0 0 auto",
                    }}
                  />
                  <s-text>Snapshot replacement in progress. This may take a moment.</s-text>
                </div>
              </s-banner>
            ) : null}
            {replacementActionData ? (
              <s-banner tone={importActionTone(replacementActionData)}>
                <s-text>{replacementActionData.message}</s-text>
                {replacementActionData.summary ? (
                  <ImportSummaryDisplay summary={replacementActionData.summary} formatMoney={formatMoney} />
                ) : null}
              </s-banner>
            ) : null}
            <Form ref={replacementFormRef} method="post" encType="multipart/form-data" style={{ display: "grid", gap: "1rem" }}>
              <s-text>
                Upload or paste Shopify order exports for snapshots that already exist. Closed-period snapshots require force replacement. Existing payment, receipt, tax, or public disclosure evidence should be reviewed before continuing.
              </s-text>
              <s-text-field label="Source name" name="sourceName" placeholder="Optional filename or replacement batch name" />
              <div style={{ display: "grid", gap: "0.4rem" }}>
                <label htmlFor="replacementPayloadFile">Replacement order file</label>
                <input id="replacementPayloadFile" name="payloadFile" type="file" accept="text/csv,application/csv,application/json,.csv,.json" />
                <s-text color="subdued">Use the same Shopify CSV or JSON order format as historical order import.</s-text>
              </div>
              <div style={{ display: "grid", gap: "0.4rem" }}>
                <label htmlFor="replacementPayload">JSON or CSV fallback</label>
                <textarea
                  id="replacementPayload"
                  name="payload"
                  rows={8}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid var(--p-color-border, #d2d5d8)",
                    borderRadius: "0.5rem",
                    font: "inherit",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  }}
                />
              </div>
              <s-text-field
                label="Replacement reason"
                name="replacementReason"
                placeholder="Example: Recompute beta snapshots after equipment consumable costing rollout"
              />
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input type="checkbox" name="forceClosed" />
                <span>Allow replacement for snapshots in closed reporting periods</span>
              </label>
              <s-text-field
                label="Type REPLACE to apply"
                name="replacementConfirmation"
                placeholder="Required only when applying replacement"
              />
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <s-button type="button" variant="secondary" disabled={busy} onClick={() => submitWithIntent(replacementFormRef.current, "dry-run-replace-snapshots")}>
                  Dry run replacement
                </s-button>
                <s-button type="button" tone="critical" variant="secondary" disabled={busy} onClick={() => submitWithIntent(replacementFormRef.current, "replace-snapshots")}>
                  Replace snapshots
                </s-button>
              </div>
            </Form>
            {replacementActionData?.importPayload && replacementMappingRequests.length > 0 ? (
              <Form ref={replacementMappingFormRef} method="post" style={{ display: "grid", gap: "1rem" }}>
                <input type="hidden" name="sourceName" value={replacementActionData.sourceName ?? ""} />
                <input type="hidden" name="replacementReason" value={replacementActionData.replacementReason ?? ""} />
                {replacementActionData.forceClosed ? <input type="hidden" name="forceClosed" value="on" /> : null}
                <textarea name="payload" value={replacementActionData.importPayload} readOnly hidden />
                <s-banner tone="warning">
                  <s-text>Resolve these line mappings before replacing snapshots. Saved historical-import mappings are applied automatically when they still point to a synced variant.</s-text>
                </s-banner>
                <div style={{ display: "grid", gap: "0.85rem" }}>
                  {replacementMappingRequests.map((request) => {
                    const options = buildMappingOptions(request, variants);
                    const selectedId = pendingReplacementMappings[request.key] ?? "";
                    const selectedOption = options.find((option) => option.value === selectedId);
                    return (
                      <div key={request.key} style={{ display: "grid", gap: "0.5rem" }}>
                        <span>{request.title} - {request.variantTitle}{request.sku ? ` (${request.sku})` : ""}</span>
                        <input type="hidden" name={`variantMapping:${request.key}`} value={selectedId} />
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                          <s-text color={selectedOption ? undefined : "subdued"}>
                            {selectedOption?.label ?? "No line handling selected"}
                          </s-text>
                          <AssignmentPicker
                            id={`replacement-line-mapping-${request.key.replace(/[^a-z0-9]+/gi, "-")}`}
                            label={`Choose replacement line handling for ${request.title}`}
                            triggerLabel={selectedOption ? "Change handling" : "Choose line handling"}
                            options={options.map((option) => ({ id: option.value, label: option.label, description: option.description }))}
                            selectedIds={selectedId ? new Set([selectedId]) : new Set()}
                            onAdd={(ids) => {
                              const selected = ids[0];
                              if (!selected) return;
                              setPendingReplacementMappings((current) => ({ ...current, [request.key]: selected }));
                            }}
                            multi={false}
                            hideSelected={false}
                            searchPlaceholder="Search products, variants, SKUs, tip, or custom"
                            emptyText="No matching products or variants found."
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <s-text-field label="Type REPLACE to apply after review" name="replacementConfirmation" />
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <s-button type="button" variant="secondary" disabled={busy || !allReplacementMappingsSelected} onClick={() => submitWithIntent(replacementMappingFormRef.current, "dry-run-replace-snapshots")}>Dry run with mappings</s-button>
                  <s-button type="button" tone="critical" variant="secondary" disabled={busy || !allReplacementMappingsSelected} onClick={() => submitWithIntent(replacementMappingFormRef.current, "replace-snapshots")}>Replace with mappings</s-button>
                </div>
              </Form>
            ) : null}
            {hasReviewedReplacement ? (
              <Form method="post" style={{ display: "grid", gap: "1rem" }}>
                <input type="hidden" name="sourceName" value={replacementActionData?.sourceName ?? ""} />
                <input type="hidden" name="replacementReason" value={replacementActionData?.replacementReason ?? ""} />
                {replacementActionData?.forceClosed ? <input type="hidden" name="forceClosed" value="on" /> : null}
                <textarea name="payload" value={replacementActionData?.importPayload ?? ""} readOnly hidden />
                {Object.entries(replacementActionData?.mappingOverrides ?? {}).map(([key, value]) => (
                  <input key={key} type="hidden" name={`variantMapping:${key}`} value={value} />
                ))}
                <s-banner tone="success">
                  <s-text>Replacement preflight is ready. Review the summary above, then confirm to create new immutable snapshot revisions.</s-text>
                </s-banner>
                <s-text-field label="Type REPLACE to apply reviewed replacements" name="replacementConfirmation" />
                <div>
                  <s-button type="button" tone="critical" variant="secondary" disabled={busy} onClick={() => submitWithIntent(reviewedReplacementFormRef.current, "replace-snapshots")}>Replace reviewed snapshots</s-button>
                </div>
              </Form>
            ) : null}
          </div>
        </s-section>

        <s-section heading="Rebuild reporting">
          <div style={{ display: "grid", gap: "1rem" }}>
            <s-banner tone="warning">
              <s-text>
                Rebuild refreshes reporting allocations while preserving cause disbursements and artist payments that have already been registered.
              </s-text>
            </s-banner>
            {isRebuildSubmitting ? (
              <s-banner tone="info">
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: "1rem",
                      height: "1rem",
                      border: "2px solid currentColor",
                      borderTopColor: "transparent",
                      borderRadius: "999px",
                      animation: "reporting-imports-spin 0.8s linear infinite",
                      flex: "0 0 auto",
                    }}
                  />
                  <s-text>Rebuild in progress. This may take a moment.</s-text>
                </div>
              </s-banner>
            ) : null}
            {rebuildActionData ? (
              <s-banner tone={rebuildActionData.ok ? "success" : "critical"}>
                <s-text>{rebuildActionData.message}</s-text>
                {rebuildResults.length > 0 ? (
                  <div style={{ margin: "0.75rem 0 0", overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "56rem" }}>
                      <thead>
                        <tr>
                          {["Period", "Metric", "Before", "After", "Delta"].map((heading) => (
                            <th
                              key={heading}
                              scope="col"
                              style={{
                                textAlign: "left",
                                padding: "0.45rem 0.5rem",
                                borderBottom: "1px solid var(--p-color-border, #d2d5d8)",
                              }}
                            >
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rebuildResults.flatMap((result) => {
                          const periodLabel = `${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(result.periodStartDate))} - ${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(result.periodEndDate))}`;
                          const rows = [
                            {
                              label: "Donation pool",
                              before: formatMoney(result.before.donationPool),
                              after: formatMoney(result.after.donationPool),
                              delta: formatMoney(result.delta.donationPool),
                            },
                            {
                              label: "Cause allocations",
                              before: formatMoney(result.before.causeAllocationTotal),
                              after: formatMoney(result.after.causeAllocationTotal),
                              delta: formatMoney(result.delta.causeAllocationTotal),
                            },
                            {
                              label: "Artist payouts",
                              before: formatMoney(result.before.artistPayoutTotal),
                              after: formatMoney(result.after.artistPayoutTotal),
                              delta: formatMoney(result.delta.artistPayoutTotal),
                            },
                            {
                              label: "Total cost",
                              before: formatMoney(result.before.totalCost),
                              after: formatMoney(result.after.totalCost),
                              delta: formatMoney(result.delta.totalCost),
                            },
                            {
                              label: "Net contribution",
                              before: formatMoney(result.before.totalNetContribution),
                              after: formatMoney(result.after.totalNetContribution),
                              delta: formatMoney(result.delta.totalNetContribution),
                            },
                            {
                              label: "Order lines",
                              before: result.before.orderLineCount.toLocaleString(locale),
                              after: result.after.orderLineCount.toLocaleString(locale),
                              delta: result.delta.orderLineCount.toLocaleString(locale),
                            },
                          ];

                          return rows.map((row, index) => (
                            <tr key={`${result.periodId}:${row.label}`}>
                              <td style={{ padding: "0.45rem 0.5rem", borderBottom: "1px solid var(--p-color-border, #d2d5d8)" }}>
                                {index === 0 ? periodLabel : ""}
                              </td>
                              <td style={{ padding: "0.45rem 0.5rem", borderBottom: "1px solid var(--p-color-border, #d2d5d8)" }}>{row.label}</td>
                              <td style={{ padding: "0.45rem 0.5rem", borderBottom: "1px solid var(--p-color-border, #d2d5d8)" }}>{row.before}</td>
                              <td style={{ padding: "0.45rem 0.5rem", borderBottom: "1px solid var(--p-color-border, #d2d5d8)" }}>{row.after}</td>
                              <td style={{ padding: "0.45rem 0.5rem", borderBottom: "1px solid var(--p-color-border, #d2d5d8)" }}>{row.delta}</td>
                            </tr>
                          ));
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : rebuildActionData.summary ? (
                  <s-text>Rebuild completed, but no comparable period metrics were returned.</s-text>
                ) : null}
              </s-banner>
            ) : null}
            <div style={{ display: "grid", gap: "1rem" }}>
              <Form method="post" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end" }}>
                <input type="hidden" name="intent" value="rebuild-period" />
                <div style={{ display: "grid", gap: "0.4rem", minWidth: "min(32rem, 100%)" }}>
                  <label htmlFor="periodId">Period</label>
                  <select id="periodId" name="periodId" required style={{ padding: "0.65rem", font: "inherit" }}>
                    <option value="">Choose a period</option>
                    {periods.map((period) => (
                      <option key={period.id} value={period.id}>{period.label}</option>
                    ))}
                  </select>
                </div>
                <s-button type="submit" variant="secondary" disabled={busy}>
                  Rebuild period
                </s-button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="rebuild-all" />
                <s-button type="submit" tone="critical" variant="secondary" disabled={busy}>
                  Rebuild all
                </s-button>
              </Form>
            </div>
          </div>
        </s-section>

        <s-section heading="Recent import batches" padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Batch</s-table-header>
              <s-table-header listSlot="secondary">Kind</s-table-header>
              <s-table-header listSlot="secondary">Status</s-table-header>
              <s-table-header listSlot="secondary">Created</s-table-header>
              <s-table-header>Summary</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {batches.length === 0 ? (
                <s-table-row>
                  <s-table-cell>No historical import batches yet.</s-table-cell>
                  <s-table-cell />
                  <s-table-cell />
                  <s-table-cell />
                  <s-table-cell />
                </s-table-row>
              ) : (
                batches.map((batch) => (
                  <s-table-row key={batch.id}>
                    <s-table-cell>{batch.sourceName || `${humanize(batch.kind)} import`}</s-table-cell>
                    <s-table-cell>{humanize(batch.kind)}</s-table-cell>
                    <s-table-cell>{humanize(batch.status)}</s-table-cell>
                    <s-table-cell>{formatDate(batch.createdAt)}</s-table-cell>
                    <s-table-cell>
                      <ImportSummaryDisplay summary={batch.summary} compact formatMoney={formatMoney} />
                    </s-table-cell>
                  </s-table-row>
                ))
              )}
            </s-table-body>
          </s-table>
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  console.error("[ReportingImports] ErrorBoundary caught:", useRouteError());
  return (
    <>
      <ui-title-bar title="Imports & rebuild" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Imports &amp; rebuild could not be loaded. Refresh the page once; if it still fails, contact support with the shop domain and time of the attempt.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
