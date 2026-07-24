import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("../db.server", () => ({
  prisma: {},
}));

import { buildPublicTransparencyPage } from "./publicTransparency.server";

describe("buildPublicTransparencyPage", () => {
  it("builds a display-safe public transparency contract", async () => {
    const decimal = (value: string) => new Prisma.Decimal(value);
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
                is501c3: false,
                allocated: decimal("20.00"),
                disbursed: decimal("15.00"),
              },
            ],
            disbursements: [
              {
                id: "dis-1",
            amount: decimal("15.00"),
            feesCoveredAmount: decimal("1.25"),
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
            subtotal: decimal("50.00"),
            netContribution: decimal("32.75"),
            laborCost: decimal("5.00"),
            materialCost: decimal("8.00"),
            packagingCost: decimal("2.00"),
            equipmentCost: decimal("1.50"),
            podCost: decimal("0.00"),
            mistakeBufferAmount: decimal("0.75"),
            totalCost: decimal("17.25"),
            adjustments: [],
          },
        ]),
      },
      orderSnapshot: {
        findMany: vi.fn().mockResolvedValue([
          {
            salesTaxCollected: decimal("4.00"),
          },
        ]),
      },
      shopifyChargeTransaction: {
        findMany: vi.fn().mockResolvedValue([
          {
            amount: decimal("2.25"),
            transactionType: "payment_fee",
          },
        ]),
      },
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          effectiveTaxRate: decimal("0.00"),
          taxDeductionMode: "all_causes",
        }),
      },
      businessExpense: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("0.00") } }),
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
    expect(JSON.stringify(result.reconciliation)).toContain("Tax buffer");
    expect(JSON.stringify(result.reconciliation)).toContain("Less fees, shipping, and reserves");
    expect(JSON.stringify(result.reconciliation)).not.toContain("Less fees, taxes, shipping, and reserves");
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
          salesTaxCollected: "4.00",
          donationPoolAfterProductCosts: "28.75",
          additionalPublicDeductions: "2.25",
          availableDonationCapacity: "26.50",
          requestedDonation: "20.00",
          netDonationPool: "20.00",
          retainedByShop: "6.50",
          donationsMade: "15.00",
          remainingFundsToDonate: "5.00",
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
      orderSnapshot: {
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
      orderSnapshot: {
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
    expect(db.orderSnapshot.findMany).not.toHaveBeenCalled();
  });
});
