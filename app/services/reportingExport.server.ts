import { Buffer } from "node:buffer";
import type { ReportingSummaryResult } from "./reportingSummary.server";

function csvEscape(value: string) {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }
  return value;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function pushSection(lines: string[], title: string, headers: string[], rows: string[][]) {
  lines.push(title);
  lines.push(headers.map(csvEscape).join(","));
  for (const row of rows) {
    lines.push(row.map((value) => csvEscape(value ?? "")).join(","));
  }
  lines.push("");
}

export function buildReportingPeriodCsv(summary: NonNullable<ReportingSummaryResult["summary"]>) {
  const lines: string[] = [];

  pushSection(lines, "Period", ["Field", "Value"], [
    ["Status", summary.period.status],
    ["Start date", formatDate(summary.period.startDate)],
    ["End date", formatDate(summary.period.endDate)],
    ["Payout id", summary.period.shopifyPayoutId ?? ""],
    ["Closed at", summary.period.closedAt ?? ""],
  ]);

  pushSection(lines, "Track 1", ["Field", "Value"], [
    ["Total net contribution", summary.track1.totalNetContribution],
    ["Shopify charges", summary.track1.shopifyCharges],
    ["Donation pool", summary.track1.donationPool],
    ["Surplus carry-forward", summary.track1.taxTrueUpSurplusApplied],
    ["Shortfall carry-forward", summary.track1.taxTrueUpShortfallApplied],
  ]);

  pushSection(lines, "Cause allocations", ["Cause", "501c3", "Allocated", "Disbursed"], summary.track1.allocations.map((allocation) => [
    allocation.causeName,
    allocation.is501c3 ? "Yes" : "No",
    allocation.allocated,
    allocation.disbursed,
  ]));

  pushSection(lines, "Outstanding cause payables", ["Cause", "Current outstanding", "Prior outstanding", "Total outstanding", "Overdue"], summary.causePayables.map((payable) => [
    payable.causeName,
    payable.currentOutstanding,
    payable.priorOutstanding,
    payable.totalOutstanding,
    payable.overdue ? "Yes" : "No",
  ]));

  pushSection(lines, "Shopify charges", ["Description", "Amount", "Processed at"], summary.charges.map((charge) => [
    charge.description,
    charge.amount,
    charge.processedAt ?? "",
  ]));

  pushSection(lines, "Disbursements", ["Cause", "Paid at", "Allocated", "Extra", "Fees", "Total", "Method", "Reference", "Applications"], summary.disbursements.map((disbursement) => [
    disbursement.causeName,
    formatDate(disbursement.paidAt),
    disbursement.allocatedAmount,
    disbursement.extraContributionAmount,
    disbursement.feesCoveredAmount,
    disbursement.amount,
    disbursement.paymentMethod,
    disbursement.referenceId ?? "",
    disbursement.applications.map((application) => `${formatDate(application.periodStartDate)}..${formatDate(application.periodEndDate)}=${application.amount}`).join(" | "),
  ]));

  pushSection(lines, "Track 2", ["Field", "Value"], [
    ["Deduction pool", summary.track2.deductionPool],
    ["Taxable exposure", summary.track2.taxableExposure],
    ["Widget tax suppressed", summary.track2.widgetTaxSuppressed ? "Yes" : "No"],
    ["Taxable base", summary.track2.taxableBase],
    ["Taxable weight", summary.track2.taxableWeight],
    ["Estimated tax reserve", summary.track2.estimatedTaxReserve],
    ["Effective tax rate", summary.track2.effectiveTaxRate ?? ""],
    ["Tax deduction mode", summary.track2.taxDeductionMode],
    ["Business expenses", summary.track2.businessExpenseTotal],
    ["501c3 allocations", summary.track2.allocation501c3Total],
  ]);

  pushSection(lines, "Tax true-ups", ["Filed at", "Estimated", "Actual", "Delta", "Notes"], summary.taxTrueUps.map((trueUp) => [
    formatDate(trueUp.filedAt),
    trueUp.estimatedTax,
    trueUp.actualTax,
    trueUp.delta,
    trueUp.redistributionNotes ?? "",
  ]));

  return lines.join("\n");
}

function escapePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function buildSimplePdf(lines: string[]) {
  const objects: string[] = [];
  const pageLines = 44;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += pageLines) {
    pages.push(lines.slice(index, index + pageLines));
  }

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  for (const page of pages) {
    const contentLines = ["BT", "/F1 10 Tf", "50 792 Td", "14 TL"];
    page.forEach((line, index) => {
      if (index === 0) {
        contentLines.push(`(${escapePdfText(line)}) Tj`);
      } else {
        contentLines.push("T*");
        contentLines.push(`(${escapePdfText(line)}) Tj`);
      }
    });
    contentLines.push("ET");
    const content = contentLines.join("\n");
    const contentObjectId = objects.length + 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`);
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${offsets[index].toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

export function buildReportingPeriodPdf(summary: NonNullable<ReportingSummaryResult["summary"]>) {
  const lines = [
    `Reporting period: ${formatDate(summary.period.startDate)} to ${formatDate(summary.period.endDate)}`,
    `Status: ${summary.period.status}`,
    `Donation pool: ${summary.track1.donationPool}`,
    `Shopify charges: ${summary.track1.shopifyCharges}`,
    `Estimated tax reserve: ${summary.track2.estimatedTaxReserve}`,
    "",
    "Cause allocations",
    ...summary.track1.allocations.map((allocation) => `- ${allocation.causeName}: allocated ${allocation.allocated}, disbursed ${allocation.disbursed}`),
    "",
    "Outstanding cause payables",
    ...summary.causePayables.map((payable) => `- ${payable.causeName}: current ${payable.currentOutstanding}, prior ${payable.priorOutstanding}, total ${payable.totalOutstanding}`),
    "",
    "Disbursements",
    ...summary.disbursements.map((disbursement) => `- ${disbursement.causeName} paid ${formatDate(disbursement.paidAt)} total ${disbursement.amount} via ${disbursement.paymentMethod}`),
    "",
    "Shopify charges",
    ...summary.charges.map((charge) => `- ${charge.description}: ${charge.amount}`),
    "",
    "Tax true-ups",
    ...summary.taxTrueUps.map((trueUp) => `- filed ${formatDate(trueUp.filedAt)} estimated ${trueUp.estimatedTax}, actual ${trueUp.actualTax}, delta ${trueUp.delta}`),
  ];

  return buildSimplePdf(lines);
}
