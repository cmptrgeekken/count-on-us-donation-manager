import { jsonResponse } from "~/utils/json-response.server";
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
} from "../services/historicalBackfill.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

type ActionData = {
  ok: boolean;
  message: string;
  summary?: unknown;
};

function formatDate(value: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

function stringifySummary(summary: unknown) {
  return JSON.stringify(summary, null, 2);
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const [periods, batches] = await Promise.all([
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
  ]);

  return jsonResponse({
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
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
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

      if (kind === "payouts") {
        const summary = await importHistoricalPayouts({ shopId, rows, dryRun, sourceName });
        return jsonResponse<ActionData>({ ok: summary.errors.length === 0, message: dryRun ? "Payout dry run complete." : "Payout import complete.", summary });
      }

      if (kind === "charges") {
        const summary = await importHistoricalCharges({ shopId, rows, dryRun, sourceName });
        return jsonResponse<ActionData>({ ok: summary.errors.length === 0, message: dryRun ? "Charge dry run complete." : "Charge import complete.", summary });
      }

      if (kind === "orders") {
        const summary = await importHistoricalOrders({ shopId, rows, dryRun, sourceName });
        return jsonResponse<ActionData>({ ok: summary.errors.length === 0, message: dryRun ? "Order dry run complete." : "Order import complete.", summary });
      }

      return jsonResponse<ActionData>({ ok: false, message: "Choose an import type." }, { status: 400 });
    }

    if (intent === "rebuild-period") {
      const periodId = formData.get("periodId")?.toString() ?? "";
      if (!periodId) {
        return jsonResponse<ActionData>({ ok: false, message: "Choose a period to rebuild." }, { status: 400 });
      }
      const result = await rebuildReportingPeriod({ shopId, periodId });
      return jsonResponse<ActionData>({ ok: true, message: "Reporting period rebuilt.", summary: result });
    }

    if (intent === "rebuild-all") {
      const result = await rebuildAllReporting({ shopId });
      return jsonResponse<ActionData>({ ok: true, message: "Reporting history rebuilt.", summary: result });
    }

    return jsonResponse<ActionData>({ ok: false, message: "Unknown action." }, { status: 400 });
  } catch (error) {
    return jsonResponse<ActionData>(
      { ok: false, message: error instanceof Error ? error.message : "Import or rebuild failed." },
      { status: 400 },
    );
  }
};

export default function ReportingImportsPage() {
  const { periods, batches } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <>
      <ui-title-bar title="Imports & rebuild" />
      <s-page>
        {actionData ? (
          <s-banner tone={actionData.ok ? "success" : "critical"}>
            <s-text>{actionData.message}</s-text>
            {actionData.summary ? (
              <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap", margin: "0.75rem 0 0" }}>
                {stringifySummary(actionData.summary)}
              </pre>
            ) : null}
          </s-banner>
        ) : null}

        <s-section heading="Historical import">
          <div style={{ display: "grid", gap: "1rem" }}>
            <s-text>
              Import Shopify CSV exports or JSON arrays for payouts, Shopify charges, and orders. Historical order snapshots use the current Count On Us configuration at import time.
            </s-text>
            <Form method="post" encType="multipart/form-data" style={{ display: "grid", gap: "1rem" }}>
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
                <label htmlFor="payloadFile">JSON file</label>
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
                <s-button type="submit" name="intent" value="dry-run-import" variant="secondary" disabled={busy}>
                  Dry run
                </s-button>
                <s-button type="submit" name="intent" value="apply-import" variant="primary" disabled={busy}>
                  Import
                </s-button>
              </div>
            </Form>
          </div>
        </s-section>

        <s-section heading="Rebuild reporting">
          <div style={{ display: "grid", gap: "1rem" }}>
            <s-banner tone="warning">
              <s-text>
                Rebuild deletes and recreates derived allocations. Periods with payment applications are refused to preserve payment evidence.
              </s-text>
            </s-banner>
            <Form method="post" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end" }}>
              <div style={{ display: "grid", gap: "0.4rem", minWidth: "min(32rem, 100%)" }}>
                <label htmlFor="periodId">Period</label>
                <select id="periodId" name="periodId" style={{ padding: "0.65rem", font: "inherit" }}>
                  <option value="">Choose a period</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>{period.label}</option>
                  ))}
                </select>
              </div>
              <s-button type="submit" name="intent" value="rebuild-period" variant="secondary" disabled={busy}>
                Rebuild period
              </s-button>
              <s-button type="submit" name="intent" value="rebuild-all" tone="critical" variant="secondary" disabled={busy}>
                Rebuild all
              </s-button>
            </Form>
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
                  <s-table-cell colSpan={5}>No historical import batches yet.</s-table-cell>
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
