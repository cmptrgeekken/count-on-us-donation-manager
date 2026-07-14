import type { LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import {
  buildProductionUsageCsv,
  buildProductionUsageReport,
} from "../services/productionUsageReport.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

const QuerySchema = z.object({
  range: z.enum(["30d", "90d", "ytd", "all", "custom"]).default("30d"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  origin: z.enum(["all", "webhook", "reconciliation", "historical_import"]).default("all"),
  search: z.string().trim().max(200).default(""),
});

function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<Response> => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return new Response("Invalid production usage filters.", { status: 400 });

  const today = utcDay(new Date());
  let startDate: Date | null = null;
  let endDateExclusive: Date | null = null;
  if (parsed.data.range === "custom") {
    startDate = parsed.data.startDate ? new Date(`${parsed.data.startDate}T00:00:00.000Z`) : null;
    endDateExclusive = parsed.data.endDate
      ? addDays(new Date(`${parsed.data.endDate}T00:00:00.000Z`), 1)
      : null;
  } else if (parsed.data.range === "ytd") {
    startDate = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    endDateExclusive = addDays(today, 1);
  } else if (parsed.data.range !== "all") {
    startDate = addDays(today, parsed.data.range === "90d" ? -89 : -29);
    endDateExclusive = addDays(today, 1);
  }
  if (startDate && endDateExclusive && endDateExclusive <= startDate) {
    return new Response("End date must be on or after start date.", { status: 400 });
  }

  const report = await buildProductionUsageReport(shopId, {
    startDate,
    endDateExclusive,
    origin: parsed.data.origin,
    search: parsed.data.search,
  });
  const start = startDate?.toISOString().slice(0, 10) ?? "all-time";
  const end = endDateExclusive ? addDays(endDateExclusive, -1).toISOString().slice(0, 10) : "latest";
  return new Response(buildProductionUsageCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="production-usage-${start}-to-${end}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
