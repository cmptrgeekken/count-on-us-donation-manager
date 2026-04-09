import type { LoaderFunctionArgs } from "@remix-run/node";
import { buildReportingPeriodCsv, buildReportingPeriodPdf } from "../services/reportingExport.server";
import { buildReportingSummary } from "../services/reportingSummary.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const url = new URL(request.url);
  const requestedPeriodId = url.searchParams.get("periodId") ?? "";
  const format = url.searchParams.get("format");

  if (format !== "csv" && format !== "pdf") {
    return new Response("Export format must be csv or pdf.", { status: 400 });
  }

  const result = await buildReportingSummary(shopId, requestedPeriodId);
  if (!result.summary) {
    return new Response("Reporting period not found.", { status: 404 });
  }

  const start = result.summary.period.startDate.slice(0, 10);
  const end = result.summary.period.endDate.slice(0, 10);
  const filename = `reporting-period-${start}-to-${end}.${format}`;

  if (format === "csv") {
    return new Response(buildReportingPeriodCsv(result.summary), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(buildReportingPeriodPdf(result.summary), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
