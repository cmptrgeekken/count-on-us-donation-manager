import type { LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useLoaderData, useRouteError } from "@remix-run/react";
import { z } from "zod";
import { MetricCard } from "../components/admin-ui";
import {
  buildProductionUsageReport,
  type ProductionUsageReport,
} from "../services/productionUsageReport.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { jsonResponse } from "../utils/json-response.server";
import { useAppLocalization } from "../utils/use-app-localization";

const FilterSchema = z.object({
  range: z.enum(["30d", "90d", "ytd", "all", "custom"]).default("30d"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  origin: z.enum(["all", "webhook", "reconciliation", "historical_import"]).default("all"),
  search: z.string().trim().max(200).default(""),
});

type ProductionUsageLoaderData =
  | {
      ok: true;
      query: z.infer<typeof FilterSchema> & {
        effectiveStartDate: string;
        effectiveEndDate: string;
      };
      report: ProductionUsageReport;
      invalidFilters: boolean;
    }
  | { ok: false; message: string };

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function parseDate(value: string | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function dateInput(value: Date | null): string {
  return value?.toISOString().slice(0, 10) ?? "";
}

function resolveRange(range: z.infer<typeof FilterSchema>, now: Date) {
  const today = startOfUtcDay(now);
  if (range.range === "all") return { startDate: null, endDateExclusive: null };
  if (range.range === "custom") {
    const startDate = parseDate(range.startDate || undefined);
    const selectedEnd = parseDate(range.endDate || undefined);
    return {
      startDate,
      endDateExclusive: selectedEnd ? addUtcDays(selectedEnd, 1) : null,
    };
  }
  if (range.range === "ytd") {
    return {
      startDate: new Date(Date.UTC(today.getUTCFullYear(), 0, 1)),
      endDateExclusive: addUtcDays(today, 1),
    };
  }
  return {
    startDate: addUtcDays(today, range.range === "90d" ? -89 : -29),
    endDateExclusive: addUtcDays(today, 1),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<Response> => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const url = new URL(request.url);
  const parsed = FilterSchema.safeParse({
    range: url.searchParams.get("range") ?? undefined,
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
    origin: url.searchParams.get("origin") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
  });
  const query = parsed.success
    ? parsed.data
    : { range: "30d", startDate: "", endDate: "", origin: "all", search: "" } as const;
  const range = resolveRange(query, new Date());
  if (range.startDate && range.endDateExclusive && range.endDateExclusive <= range.startDate) {
    return jsonResponse({ ok: false, message: "End date must be on or after start date." }, { status: 400 });
  }
  const report = await buildProductionUsageReport(shopId, {
    ...range,
    origin: query.origin,
    search: query.search,
  });
  return jsonResponse({
    ok: true,
    query: {
      ...query,
      effectiveStartDate: dateInput(range.startDate),
      effectiveEndDate: range.endDateExclusive ? dateInput(addUtcDays(range.endDateExclusive, -1)) : "",
    },
    report,
    invalidFilters: !parsed.success,
  });
};

const tableWrapStyle = { overflowX: "auto" } as const;
const tableStyle = { width: "100%", borderCollapse: "collapse" } as const;
const cellStyle = { padding: "0.65rem", borderBottom: "1px solid #d2d5d8", textAlign: "left" } as const;

export default function ProductionUsagePage() {
  const data = useLoaderData<ProductionUsageLoaderData>();
  const { formatMoney } = useAppLocalization();
  if (!data.ok) return null;
  const { query, report } = data;
  const exportSearch = new URLSearchParams({
    range: query.range,
    startDate: query.startDate ?? "",
    endDate: query.endDate ?? "",
    origin: query.origin,
    search: query.search,
  });

  return (
    <>
      <ui-title-bar title="Production Usage" />
      <s-page>
        {data.invalidFilters ? (
          <s-banner tone="warning">
            <s-text>Some filters were invalid, so the report returned to the Last 30 days default.</s-text>
          </s-banner>
        ) : null}
        {report.summary.reviewRequiredOrderCount > 0 ? (
          <s-banner tone="warning">
            <s-text>
              {report.summary.reviewRequiredOrderCount} order(s) were excluded because lifecycle evidence requires review.
            </s-text>
          </s-banner>
        ) : null}

        <s-section heading="Filters">
          <Form method="get" style={{ display: "grid", gap: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "1rem" }}>
              <label>
                <span>Date range</span>
                <select name="range" defaultValue={query.range} style={{ display: "block", width: "100%", padding: "0.6rem" }}>
                  <option value="30d">Last 30 days</option>
                  <option value="90d">Last 90 days</option>
                  <option value="ytd">Year to date</option>
                  <option value="all">All time</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label>
                <span>Start date (custom)</span>
                <input type="date" name="startDate" defaultValue={query.startDate} style={{ display: "block", width: "100%", padding: "0.55rem" }} />
              </label>
              <label>
                <span>End date (custom)</span>
                <input type="date" name="endDate" defaultValue={query.endDate} style={{ display: "block", width: "100%", padding: "0.55rem" }} />
              </label>
              <label>
                <span>Order source</span>
                <select name="origin" defaultValue={query.origin} style={{ display: "block", width: "100%", padding: "0.6rem" }}>
                  <option value="all">All sources</option>
                  <option value="webhook">Webhook</option>
                  <option value="reconciliation">Reconciliation</option>
                  <option value="historical_import">Historical import</option>
                </select>
              </label>
              <label>
                <span>Search</span>
                <input name="search" defaultValue={query.search} placeholder="Material, equipment, or consumable" style={{ display: "block", width: "100%", padding: "0.55rem" }} />
              </label>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <button type="submit">Apply filters</button>
              <Link to={`/app/production-usage-export?${exportSearch.toString()}`}>Export CSV</Link>
              <s-text color="subdued">
                Dates use UTC. Effective range: {query.effectiveStartDate || "Beginning of records"} through {query.effectiveEndDate || "latest order"}.
              </s-text>
            </div>
          </Form>
        </s-section>

        <s-section heading="Summary">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))", gap: "1rem" }}>
            <MetricCard label="Orders included" value={report.summary.includedOrderCount.toString()} />
            <MetricCard label="Material cost" value={formatMoney(report.summary.materialCost)} />
            <MetricCard label="Equipment cost" value={formatMoney(report.summary.equipmentCost)} />
            <MetricCard label="Equipment hours" value={report.summary.equipmentHours} />
            <MetricCard label="Consumable cost" value={formatMoney(report.summary.consumablesCost)} />
            <MetricCard label="Mistake buffer" value={formatMoney(report.summary.mistakeBuffer)} />
            <MetricCard label="Packaging cost" value={formatMoney(report.summary.packagingCost)} />
          </div>
        </s-section>

        <s-section heading="Materials">
          {report.materials.length === 0 ? <s-text>No material usage matches these filters.</s-text> : (
            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead><tr><th style={cellStyle}>Material</th><th style={cellStyle}>Type</th><th style={cellStyle}>Purchase units</th><th style={cellStyle}>Portion uses</th><th style={cellStyle}>Cost</th><th style={cellStyle}>Orders</th></tr></thead>
                <tbody>{report.materials.map((row) => (
                  <tr key={row.key}>
                    <td style={cellStyle}>{row.name}{row.historical ? " (Historical)" : ""}{row.incompleteQuantity ? " — quantity incomplete" : ""}</td>
                    <td style={cellStyle}>{row.materialType}</td><td style={cellStyle}>{row.purchaseUnits}</td><td style={cellStyle}>{row.portionUses}</td><td style={cellStyle}>{formatMoney(row.totalCost)}</td><td style={cellStyle}>{row.orderCount}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </s-section>

        <s-section heading="Equipment">
          <s-text color="subdued">Consumable detail is available only when calculated component rates were captured.</s-text>
          {report.equipment.length === 0 ? <s-text>No equipment usage matches these filters.</s-text> : (
            <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
              {report.equipment.map((row) => (
                <details key={row.key}>
                  <summary>{row.name} — {row.hours} hours, {row.uses} uses, {formatMoney(row.totalCost)}</summary>
                  <div style={tableWrapStyle}>
                    <table style={tableStyle}><thead><tr><th style={cellStyle}>Component</th><th style={cellStyle}>Cost</th></tr></thead><tbody>
                      <tr><td style={cellStyle}>Consumables</td><td style={cellStyle}>{formatMoney(row.consumablesCost)}</td></tr>
                      <tr><td style={cellStyle}>Electricity</td><td style={cellStyle}>{formatMoney(row.electricityCost)}</td></tr>
                      <tr><td style={cellStyle}>Depreciation</td><td style={cellStyle}>{formatMoney(row.depreciationCost)}</td></tr>
                      <tr><td style={cellStyle}>Maintenance</td><td style={cellStyle}>{formatMoney(row.maintenanceCost)}</td></tr>
                      <tr><td style={cellStyle}>Manual rate</td><td style={cellStyle}>{formatMoney(row.manualOverrideCost)}</td></tr>
                    </tbody></table>
                  </div>
                  {row.consumables.length > 0 ? <ul>{row.consumables.map((consumable) => <li key={consumable.key}>{consumable.name} ({consumable.lifespanUnit}): {formatMoney(consumable.totalCost)}</li>)}</ul> : null}
                </details>
              ))}
            </div>
          )}
        </s-section>

        <s-section heading="Packaging">
          <s-text color="subdued">Cartonized packaging is reported by package; individual shipping-material composition is not reconstructed.</s-text>
          {report.packages.length === 0 ? <s-text>No package usage matches these filters.</s-text> : (
            <ul>{report.packages.map((row) => <li key={row.key}>{row.name}: {row.quantity} packages, {formatMoney(row.materialCost)} across {row.orderCount} order(s)</li>)}</ul>
          )}
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[ProductionUsage] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Production Usage" />
      <s-page><s-banner tone="critical"><s-text>Something went wrong. Please refresh the page.</s-text></s-banner></s-page>
    </>
  );
}
