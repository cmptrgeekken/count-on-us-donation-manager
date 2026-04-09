import { Buffer } from "node:buffer";
import { Prisma } from "@prisma/client";
import type { ReportingSummaryResult } from "./reportingSummary.server";

function csvEscape(value: string) {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }
  return value;
}

type CsvRow = Record<string, string>;

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function toCsv(rows: CsvRow[], headers: string[]) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? "")).join(","));
  }
  return lines.join("\n");
}

export function buildReportingPeriodCsv(summary: NonNullable<ReportingSummaryResult["summary"]>) {
  const headers = [
    "section",
    "recordType",
    "periodId",
    "periodStartDate",
    "periodEndDate",
    "status",
    "causeId",
    "causeName",
    "is501c3",
    "description",
    "paidAt",
    "filedAt",
    "processedAt",
    "paymentMethod",
    "referenceId",
    "shopifyPayoutId",
    "metric",
    "value",
    "allocatedAmount",
    "disbursedAmount",
    "remainingAmount",
    "currentOutstanding",
    "priorOutstanding",
    "totalOutstanding",
    "extraContributionAmount",
    "feesCoveredAmount",
    "delta",
    "notes",
    "applicationPeriods",
    "redistributions",
  ];

  const basePeriod = {
    periodId: summary.period.id,
    periodStartDate: formatDate(summary.period.startDate),
    periodEndDate: formatDate(summary.period.endDate),
    status: summary.period.status,
    shopifyPayoutId: summary.period.shopifyPayoutId ?? "",
  };

  const rows: CsvRow[] = [
    {
      ...basePeriod,
      section: "period",
      recordType: "period",
      metric: "closedAt",
      value: formatDate(summary.period.closedAt),
    },
    {
      ...basePeriod,
      section: "track1",
      recordType: "metric",
      metric: "totalNetContribution",
      value: summary.track1.totalNetContribution,
    },
    {
      ...basePeriod,
      section: "track1",
      recordType: "metric",
      metric: "shopifyCharges",
      value: summary.track1.shopifyCharges,
    },
    {
      ...basePeriod,
      section: "track1",
      recordType: "metric",
      metric: "donationPool",
      value: summary.track1.donationPool,
    },
    {
      ...basePeriod,
      section: "track1",
      recordType: "metric",
      metric: "surplusCarryForward",
      value: summary.track1.taxTrueUpSurplusApplied,
    },
    {
      ...basePeriod,
      section: "track1",
      recordType: "metric",
      metric: "shortfallCarryForward",
      value: summary.track1.taxTrueUpShortfallApplied,
    },
    ...summary.track1.allocations.map<CsvRow>((allocation) => ({
      ...basePeriod,
      section: "allocations",
      recordType: "allocation",
      causeId: allocation.causeId,
      causeName: allocation.causeName,
      is501c3: allocation.is501c3 ? "Yes" : "No",
      allocatedAmount: allocation.allocated,
      disbursedAmount: allocation.disbursed,
      remainingAmount: new Prisma.Decimal(allocation.allocated)
        .sub(new Prisma.Decimal(allocation.disbursed))
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR)
        .toString(),
    })),
    ...summary.causePayables.flatMap<CsvRow>((payable) => [
      {
        ...basePeriod,
        section: "payables",
        recordType: "causePayable",
        causeId: payable.causeId,
        causeName: payable.causeName,
        is501c3: payable.is501c3 ? "Yes" : "No",
        currentOutstanding: payable.currentOutstanding,
        priorOutstanding: payable.priorOutstanding,
        totalOutstanding: payable.totalOutstanding,
        notes: payable.overdue ? "Overdue" : "",
      },
      ...payable.periods.map((period) => ({
        ...basePeriod,
        section: "payables",
        recordType: "payablePeriod",
        causeId: payable.causeId,
        causeName: payable.causeName,
        periodId: period.periodId,
        periodStartDate: formatDate(period.periodStartDate),
        periodEndDate: formatDate(period.periodEndDate),
        value: period.amount,
      })),
    ]),
    ...summary.charges.map<CsvRow>((charge) => ({
      ...basePeriod,
      section: "charges",
      recordType: "charge",
      description: charge.description,
      processedAt: formatDate(charge.processedAt),
      value: charge.amount,
    })),
    ...summary.disbursements.map<CsvRow>((disbursement) => ({
      ...basePeriod,
      section: "disbursements",
      recordType: "disbursement",
      causeId: disbursement.causeId,
      causeName: disbursement.causeName,
      paidAt: formatDate(disbursement.paidAt),
      paymentMethod: disbursement.paymentMethod,
      referenceId: disbursement.referenceId ?? "",
      value: disbursement.amount,
      allocatedAmount: disbursement.allocatedAmount,
      extraContributionAmount: disbursement.extraContributionAmount,
      feesCoveredAmount: disbursement.feesCoveredAmount,
      applicationPeriods: disbursement.applications
        .map((application) => `${formatDate(application.periodStartDate)}..${formatDate(application.periodEndDate)}=${application.amount}`)
        .join(" | "),
    })),
    {
      ...basePeriod,
      section: "track2",
      recordType: "metric",
      metric: "deductionPool",
      value: summary.track2.deductionPool,
    },
    {
      ...basePeriod,
      section: "track2",
      recordType: "metric",
      metric: "taxableExposure",
      value: summary.track2.taxableExposure,
    },
    {
      ...basePeriod,
      section: "track2",
      recordType: "metric",
      metric: "widgetTaxSuppressed",
      value: summary.track2.widgetTaxSuppressed ? "Yes" : "No",
    },
    {
      ...basePeriod,
      section: "track2",
      recordType: "metric",
      metric: "taxableBase",
      value: summary.track2.taxableBase,
    },
    {
      ...basePeriod,
      section: "track2",
      recordType: "metric",
      metric: "taxableWeight",
      value: summary.track2.taxableWeight,
    },
    {
      ...basePeriod,
      section: "track2",
      recordType: "metric",
      metric: "estimatedTaxReserve",
      value: summary.track2.estimatedTaxReserve,
    },
    {
      ...basePeriod,
      section: "track2",
      recordType: "metric",
      metric: "effectiveTaxRate",
      value: summary.track2.effectiveTaxRate ?? "",
    },
    {
      ...basePeriod,
      section: "track2",
      recordType: "metric",
      metric: "taxDeductionMode",
      value: summary.track2.taxDeductionMode,
    },
    {
      ...basePeriod,
      section: "track2",
      recordType: "metric",
      metric: "businessExpenseTotal",
      value: summary.track2.businessExpenseTotal,
    },
    {
      ...basePeriod,
      section: "track2",
      recordType: "metric",
      metric: "allocation501c3Total",
      value: summary.track2.allocation501c3Total,
    },
    ...summary.taxTrueUps.map<CsvRow>((trueUp) => ({
      ...basePeriod,
      section: "taxTrueUps",
      recordType: "taxTrueUp",
      filedAt: formatDate(trueUp.filedAt),
      value: trueUp.actualTax,
      allocatedAmount: trueUp.estimatedTax,
      delta: trueUp.delta,
      notes: trueUp.redistributionNotes ?? "",
      redistributions: trueUp.redistributions
        .map((redistribution) => `${redistribution.causeName}=${redistribution.amount}`)
        .join(" | "),
    })),
  ];

  return toCsv(rows, headers);
}

function escapePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function buildSimplePdf(lines: string[]) {
  const objects: string[] = [];
  const pageLines = 48;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += pageLines) {
    pages.push(lines.slice(index, index + pageLines));
  }

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  for (const page of pages) {
    const contentLines = ["BT", "/F1 10 Tf", "50 756 Td", "14 TL"];
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
