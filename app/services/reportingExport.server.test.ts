import { describe, expect, it } from "vitest";
import { buildReportingPeriodCsv, buildReportingPeriodPdf } from "./reportingExport.server";
import type { ReportingSummaryResult } from "./reportingSummary.server";

const summary: NonNullable<ReportingSummaryResult["summary"]> = {
  period: {
    id: "period-1",
    status: "CLOSED",
    startDate: "2026-03-01T00:00:00.000Z",
    endDate: "2026-03-15T00:00:00.000Z",
    shopifyPayoutId: "payout_fixture_001",
    closedAt: "2026-03-16T00:00:00.000Z",
  },
  track1: {
    totalNetContribution: "90.00",
    shopifyCharges: "12.00",
    donationPool: "78.00",
    taxTrueUpSurplusApplied: "0.00",
    taxTrueUpShortfallApplied: "0.00",
    allocations: [
      {
        causeId: "cause-1",
        causeName: "Playwright Cause",
        is501c3: true,
        allocated: "54.00",
        disbursed: "20.00",
      },
    ],
  },
  track2: {
    deductionPool: "74.00",
    taxableExposure: "16.00",
    widgetTaxSuppressed: false,
    taxableBase: "16.00",
    taxableWeight: "1.00",
    estimatedTaxReserve: "4.00",
    effectiveTaxRate: "0.2500",
    taxDeductionMode: "all_causes",
    businessExpenseTotal: "20.00",
    allocation501c3Total: "54.00",
  },
  charges: [
    {
      id: "charge-1",
      description: "Shopify charge A",
      amount: "12.00",
      processedAt: "2026-03-07T00:00:00.000Z",
    },
  ],
  disbursements: [
    {
      id: "dis-1",
      causeId: "cause-1",
      causeName: "Playwright Cause",
      amount: "27.00",
      allocatedAmount: "20.00",
      extraContributionAmount: "5.00",
      feesCoveredAmount: "2.00",
      paidAt: "2026-03-09T00:00:00.000Z",
      paymentMethod: "ACH",
      referenceId: "fixture-ach-001",
      receiptUrl: null,
      applications: [
        {
          periodId: "period-old",
          periodStartDate: "2026-01-31T00:00:00.000Z",
          periodEndDate: "2026-02-14T00:00:00.000Z",
          amount: "20.00",
        },
      ],
    },
  ],
  causePayables: [
    {
      causeId: "cause-1",
      causeName: "Playwright Cause",
      is501c3: true,
      currentOutstanding: "54.00",
      priorOutstanding: "20.00",
      totalOutstanding: "74.00",
      overdue: true,
      periods: [
        {
          periodId: "period-old",
          periodStartDate: "2026-01-31T00:00:00.000Z",
          periodEndDate: "2026-02-14T00:00:00.000Z",
          amount: "20.00",
        },
      ],
    },
  ],
  taxTrueUps: [],
  carryForwardTrueUps: [],
  activeCauses: [
    {
      id: "cause-1",
      name: "Playwright Cause",
    },
  ],
};

describe("reporting exports", () => {
  it("builds csv output with key reporting sections", () => {
    const csv = buildReportingPeriodCsv(summary);

    expect(csv).toContain("Track 1");
    expect(csv).toContain("Outstanding cause payables");
    expect(csv).toContain("Playwright Cause");
    expect(csv).toContain("fixture-ach-001");
    expect(csv).toContain("2026-01-31..2026-02-14=20.00");
  });

  it("builds a pdf file payload", () => {
    const pdf = buildReportingPeriodPdf(summary);

    expect(Buffer.from(pdf).subarray(0, 8).toString("utf8")).toContain("%PDF-1.4");
    expect(Buffer.from(pdf).toString("utf8")).toContain("Reporting period:");
    expect(Buffer.from(pdf).toString("utf8")).toContain("Outstanding cause payables");
  });
});
