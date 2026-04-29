import { describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  prisma: {},
}));

import { buildPublicTransparencyPage } from "./publicTransparency.server";

describe("buildPublicTransparencyPage", () => {
  it("builds a display-safe public transparency contract", async () => {
    const db = {
      reportingPeriod: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "period-1",
            startDate: new Date("2026-03-01T00:00:00.000Z"),
            endDate: new Date("2026-03-31T00:00:00.000Z"),
            causeAllocations: [
              {
                causeId: "cause-1",
                causeName: "Neighborhood Arts",
                allocated: { toString: () => "20.00", valueOf: () => 20 },
                disbursed: { toString: () => "15.00", valueOf: () => 15 },
              },
            ],
            disbursements: [
              {
                id: "dis-1",
                amount: { toString: () => "15.00", valueOf: () => 15 },
                feesCoveredAmount: { toString: () => "1.25", valueOf: () => 1.25 },
                paidAt: new Date("2026-04-02T00:00:00.000Z"),
                receiptFileKey: "receipts/march.pdf",
                cause: {
                  id: "cause-1",
                  name: "Neighborhood Arts",
                },
              },
            ],
          },
        ]),
      },
      orderSnapshotLine: {
        findMany: vi.fn().mockResolvedValue([
          {
            quantity: 2,
            subtotal: { toString: () => "50.00", valueOf: () => 50 },
            laborCost: { toString: () => "5.00", valueOf: () => 5 },
            materialCost: { toString: () => "8.00", valueOf: () => 8 },
            packagingCost: { toString: () => "2.00", valueOf: () => 2 },
            equipmentCost: { toString: () => "1.50", valueOf: () => 1.5 },
            podCost: { toString: () => "0.00", valueOf: () => 0 },
            mistakeBufferAmount: { toString: () => "0.75", valueOf: () => 0.75 },
            totalCost: { toString: () => "17.25", valueOf: () => 17.25 },
            adjustments: [],
          },
        ]),
      },
      shopifyChargeTransaction: {
        findMany: vi.fn().mockResolvedValue([
          {
            amount: { toString: () => "2.25", valueOf: () => 2.25 },
            transactionType: "payment_fee",
          },
        ]),
      },
    };
    const storage = {
      getSignedReadUrl: vi.fn().mockResolvedValue("https://example.com/receipts/march.pdf"),
    };

    const result = await buildPublicTransparencyPage(
      "shop.myshopify.com",
      {
        now: new Date("2026-04-15T12:00:00.000Z"),
        presentation: {
          requestedDisclosureTier: "standard",
        },
      },
      db as never,
      storage as never,
    );

    expect(db.reportingPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shopId: "shop.myshopify.com",
          status: "CLOSED",
        }),
      }),
    );
    expect(storage.getSignedReadUrl).toHaveBeenCalledWith({
      key: "receipts/march.pdf",
      expiresInSeconds: 60 * 60,
    });
    expect(JSON.stringify(result.reconciliation)).toContain("Sales tax collected");
    expect(JSON.stringify(result.reconciliation)).toContain("Shipping / postage");
    expect(JSON.stringify(result.reconciliation)).not.toContain("Business expenses");
    expect(result).toEqual({
      metadata: {
        version: "2026-04",
        generatedAt: "2026-04-15T12:00:00.000Z",
        coverageLabel: "Closed reporting periods",
        disclosureTier: "standard",
        hiddenSections: [],
        rollup: "all",
        periodStartDate: "2026-03-01T00:00:00.000Z",
        periodEndDate: "2026-03-31T00:00:00.000Z",
      },
      totals: {
        donationsMade: "15.00",
        donationsPendingDisbursement: "5.00",
      },
      causeSummaries: [
        {
          causeId: "cause-1",
          causeName: "Neighborhood Arts",
          donationsMade: "15.00",
          donationsPendingDisbursement: "5.00",
        },
      ],
      receipts: [
        {
          id: "dis-1",
          causeId: "cause-1",
          causeName: "Neighborhood Arts",
          amount: "15.00",
          feesCovered: "1.25",
          paidAt: "2026-04-02T00:00:00.000Z",
          receiptUrl: "https://example.com/receipts/march.pdf",
        },
      ],
      receiptCauseSummaries: [
        {
          causeId: "cause-1",
          causeName: "Neighborhood Arts",
          donationsMade: "15.00",
          feesCovered: "1.25",
          receiptCount: 1,
          receipts: [
            {
              id: "dis-1",
              causeId: "cause-1",
              causeName: "Neighborhood Arts",
              amount: "15.00",
              feesCovered: "1.25",
              paidAt: "2026-04-02T00:00:00.000Z",
              receiptUrl: "https://example.com/receipts/march.pdf",
            },
          ],
        },
      ],
      reconciliation: {
        summary: {
          orderCount: 1,
          itemCount: 2,
          grossSales: "50.00",
          donationPoolAfterProductCosts: "32.75",
          additionalPublicDeductions: "2.25",
          netDonationPool: "30.50",
          donationsMade: "15.00",
          donationsPendingDisbursement: "5.00",
        },
        sections: expect.any(Array),
        notes: expect.any(Array),
      },
      periods: [
        {
          id: "period-1",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-03-31T00:00:00.000Z",
          donationsMade: "15.00",
          donationsPendingDisbursement: "5.00",
        },
      ],
      hasPublicActivity: true,
    });
  });

  it("constrains presentation settings to the shop policy maximum", async () => {
    const db = {
      reportingPeriod: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      orderSnapshotLine: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      shopifyChargeTransaction: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const result = await buildPublicTransparencyPage(
      "shop.myshopify.com",
      {
        now: new Date("2026-04-15T12:00:00.000Z"),
        policy: {
          maximumDisclosureTier: "minimal",
          publicReceiptsEnabled: false,
          pendingDisbursementTotalsEnabled: false,
        },
        presentation: {
          requestedDisclosureTier: "detailed",
        },
      },
      db as never,
    );

    expect(result.metadata.disclosureTier).toBe("minimal");
    expect(result.metadata.hiddenSections).toEqual([
      "causeSummaries",
      "receipts",
      "pendingDisbursements",
      "reconciliation",
    ]);
    expect(result.causeSummaries).toEqual([]);
    expect(result.receipts).toEqual([]);
  });

  it("returns no public data when transparency is disabled", async () => {
    const db = {
      reportingPeriod: {
        findMany: vi.fn(),
      },
      orderSnapshotLine: {
        findMany: vi.fn(),
      },
      shopifyChargeTransaction: {
        findMany: vi.fn(),
      },
    };

    const result = await buildPublicTransparencyPage(
      "shop.myshopify.com",
      {
        now: new Date("2026-04-15T12:00:00.000Z"),
        policy: {
          enabled: false,
        },
      },
      db as never,
    );

    expect(db.reportingPeriod.findMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      metadata: {
        coverageLabel: "Public transparency is disabled",
        hiddenSections: ["overview", "causeSummaries", "receipts"],
      },
      totals: {
        donationsMade: "0.00",
        donationsPendingDisbursement: "0.00",
      },
      causeSummaries: [],
      receipts: [],
      receiptCauseSummaries: [],
      reconciliation: null,
      periods: [],
      hasPublicActivity: false,
    });
    expect(db.orderSnapshotLine.findMany).not.toHaveBeenCalled();
  });
});
