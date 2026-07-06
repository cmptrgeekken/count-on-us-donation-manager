import { jsonResponse } from "~/utils/json-response.server";
import { useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "@remix-run/react";
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

function actionJson(data: ActionData, init?: ResponseInit) {
  return jsonResponse(data, init);
}

function actionKindForIntent(intent: string | undefined): ActionData["actionKind"] {
  if (intent === "dry-run-import" || intent === "apply-import") return "import";
  if (intent === "rebuild-period" || intent === "rebuild-all") return "rebuild";
  if (intent === "dry-run-replace-snapshots" || intent === "replace-snapshots") return "replacement";
  return undefined;
}

function formatDate(value: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

function stringifySummary(summary: unknown) {
  return JSON.stringify(summary, null, 2);
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
    ...request.candidates.map((candidate) => ({
      value: candidate.shopifyVariantId,
      label: `${candidate.label} (${candidate.matchReason})`,
    })),
    ...variants
      .filter((variant) => !candidateIds.has(variant.shopifyId))
      .map((variant) => ({ value: variant.shopifyId, label: variant.label })),
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
        return actionJson({ ok: summary.errors.length === 0, message: dryRun ? "Payout dry run complete." : "Payout import complete.", actionKind: "import", summary, importPayload: payload, importKind: kind, sourceName });
      }

      if (kind === "charges") {
        const summary = await importHistoricalCharges({ shopId, rows, dryRun, sourceName });
        return actionJson({ ok: summary.errors.length === 0, message: dryRun ? "Charge dry run complete." : "Charge import complete.", actionKind: "import", summary, importPayload: payload, importKind: kind, sourceName });
      }

      if (kind === "orders") {
        const summary = await importHistoricalOrders({ shopId, rows, dryRun, sourceName, mappingOverrides });
        return actionJson({ ok: summary.errors.length === 0, message: dryRun ? "Order dry run complete." : "Order import complete.", actionKind: "import", summary, importPayload: payload, importKind: kind, sourceName, mappingOverrides });
      }

      return actionJson({ ok: false, message: "Choose an import type.", actionKind: "import" }, { status: 400 });
    }

    if (intent === "rebuild-period") {
      const periodId = formData.get("periodId")?.toString() ?? "";
      if (!periodId) {
        return actionJson({ ok: false, message: "Choose a period to rebuild.", actionKind: "rebuild" }, { status: 400 });
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
          { ok: false, message: "Type REPLACE to confirm snapshot replacement.", actionKind: "replacement", importPayload: payload, importKind: "orders", sourceName, mappingOverrides },
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
        ok: summary.errors.length === 0,
        message: dryRun ? "Snapshot replacement dry run complete." : "Snapshots replaced. Rebuild affected reporting periods after reviewing the results.",
        actionKind: "replacement",
        summary,
        importPayload: payload,
        importKind: "orders",
        sourceName,
        mappingOverrides,
      });
    }

    return actionJson({ ok: false, message: "Unknown action." }, { status: 400 });
  } catch (error) {
    return actionJson(
      { ok: false, message: error instanceof Error ? error.message : "Import or rebuild failed.", actionKind: actionKindForIntent(intent) },
      { status: 400 },
    );
  }
};

export default function ReportingImportsPage() {
  const { periods, batches, variants } = useLoaderData() as LoaderData;
  const actionData = useActionData() as ActionData | undefined;
  const navigation = useNavigation();
  const { formatMoney, locale } = useAppLocalization();
  const importIntentRef = useRef<HTMLInputElement>(null);
  const mappingIntentRef = useRef<HTMLInputElement>(null);
  const replacementIntentRef = useRef<HTMLInputElement>(null);
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
  const mappingOverrides = actionData?.mappingOverrides ?? {};
  const hasReviewedMappings = importActionData?.importKind === "orders" &&
    Boolean(importActionData.importPayload) &&
    Object.keys(mappingOverrides).length > 0 &&
    mappingRequests.length === 0 &&
    importActionData.message.includes("dry run");

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
              <s-banner tone={importActionData.ok ? "success" : "critical"}>
                <s-text>{importActionData.message}</s-text>
                {importActionData.summary ? (
                  <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap", margin: "0.75rem 0 0" }}>
                    {stringifySummary(importActionData.summary)}
                  </pre>
                ) : null}
              </s-banner>
            ) : null}
            <s-text>
              Import Shopify CSV exports or JSON arrays for payouts, Shopify charges, and orders. Historical order snapshots use the current Count On Us configuration at import time.
            </s-text>
            <Form method="post" encType="multipart/form-data" style={{ display: "grid", gap: "1rem" }}>
              <input ref={importIntentRef} type="hidden" name="intent" defaultValue="dry-run-import" />
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
                <s-button type="submit" variant="secondary" disabled={busy} onClick={() => {
                  if (importIntentRef.current) importIntentRef.current.value = "dry-run-import";
                }}>
                  Dry run
                </s-button>
                <s-button type="submit" variant="primary" disabled={busy} onClick={() => {
                  if (importIntentRef.current) importIntentRef.current.value = "apply-import";
                }}>
                  Import
                </s-button>
              </div>
            </Form>

            {importActionData?.importKind === "orders" && importActionData.importPayload && mappingRequests.length > 0 ? (
              <Form method="post" style={{ display: "grid", gap: "1rem" }}>
                <input ref={mappingIntentRef} type="hidden" name="intent" defaultValue="dry-run-import" />
                <input type="hidden" name="kind" value="orders" />
                <input type="hidden" name="sourceName" value={importActionData.sourceName ?? ""} />
                <textarea name="payload" value={importActionData.importPayload} readOnly hidden />
                <s-banner tone="warning">
                  <s-text>Some order lines need a product/variant mapping before import.</s-text>
                </s-banner>
                <div style={{ display: "grid", gap: "0.85rem" }}>
                  {mappingRequests.map((request) => {
                    const options = buildMappingOptions(request, variants);
                    return (
                      <label key={request.key} style={{ display: "grid", gap: "0.35rem" }}>
                        <span>
                          {request.title} - {request.variantTitle}
                          {request.sku ? ` (${request.sku})` : ""}
                        </span>
                        <select name={`variantMapping:${request.key}`} required style={{ padding: "0.65rem", font: "inherit" }} defaultValue="">
                          <option value="">Choose product / variant</option>
                          {options.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <s-button type="submit" variant="secondary" disabled={busy} onClick={() => {
                    if (mappingIntentRef.current) mappingIntentRef.current.value = "dry-run-import";
                  }}>
                    Dry run with mappings
                  </s-button>
                  <s-button type="submit" variant="primary" disabled={busy} onClick={() => {
                    if (mappingIntentRef.current) mappingIntentRef.current.value = "apply-import";
                  }}>
                    Import with mappings
                  </s-button>
                </div>
              </Form>
            ) : null}

            {hasReviewedMappings ? (
              <Form method="post" style={{ display: "grid", gap: "1rem" }}>
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
              <s-banner tone={replacementActionData.ok ? "success" : "critical"}>
                <s-text>{replacementActionData.message}</s-text>
                {replacementActionData.summary ? (
                  <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap", margin: "0.75rem 0 0" }}>
                    {stringifySummary(replacementActionData.summary)}
                  </pre>
                ) : null}
              </s-banner>
            ) : null}
            <Form method="post" encType="multipart/form-data" style={{ display: "grid", gap: "1rem" }}>
              <input ref={replacementIntentRef} type="hidden" name="intent" defaultValue="dry-run-replace-snapshots" />
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
                <s-button type="submit" variant="secondary" disabled={busy} onClick={() => {
                  if (replacementIntentRef.current) replacementIntentRef.current.value = "dry-run-replace-snapshots";
                }}>
                  Dry run replacement
                </s-button>
                <s-button type="submit" tone="critical" variant="secondary" disabled={busy} onClick={() => {
                  if (replacementIntentRef.current) replacementIntentRef.current.value = "replace-snapshots";
                }}>
                  Replace snapshots
                </s-button>
              </div>
            </Form>
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
                  <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap", margin: "0.75rem 0 0" }}>
                    {stringifySummary(rebuildActionData.summary)}
                  </pre>
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
                    <s-table-cell>{batch.sourceName || batch.id}</s-table-cell>
                    <s-table-cell>{batch.kind}</s-table-cell>
                    <s-table-cell>{batch.status}</s-table-cell>
                    <s-table-cell>{formatDate(batch.createdAt)}</s-table-cell>
                    <s-table-cell>
                      <pre style={{ maxWidth: "34rem", overflowX: "auto", whiteSpace: "pre-wrap" }}>
                        {stringifySummary(batch.summary)}
                      </pre>
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
          <s-text>Something went wrong loading historical imports. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
