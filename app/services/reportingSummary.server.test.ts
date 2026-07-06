import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReportingSummary } from "./reportingSummary.server";

const {
  listOutstandingCauseAllocations,
  calculateEstimatedTaxForPeriod,
  createReceiptStorage,
} = vi.hoisted(() => ({
  listOutstandingCauseAllocations: vi.fn(),
  calculateEstimatedTaxForPeriod: vi.fn(),
  createReceiptStorage: vi.fn(),
}));

vi.mock("../db.server", () => ({
  prisma: {},
}));

vi.mock("./causePayables.server", () => ({
  listOutstandingCauseAllocations,
}));

vi.mock("./receiptStorage.server", () => ({
  createReceiptStorage,
}));

vi.mock("./taxTrueUpService.server", () => ({
  calculateEstimatedTaxForPeriod,
}));

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

describe("buildReportingSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listOutstandingCauseAllocations.mockResolvedValue([]);
    calculateEstimatedTaxForPeriod.mockResolvedValue({
      taxableBase: decimal("0"),
      taxableWeight: decimal("0"),
      estimatedTaxReserve: decimal("0"),
    });
    createReceiptStorage.mockReturnValue({
      getSignedReadUrl: vi.fn(),
    });
  });

  it("includes adjusted order line drilldowns for each cause allocation", async () => {
    const period = {
      id: "period-1",
      status: "OPEN",
      source: "calendar",
      startDate: new Date("2026-04-01T00:00:00.000Z"),
      endDate: new Date("2026-05-01T00:00:00.000Z"),
      shopifyPayoutId: null,
      closedAt: null,
    };
    const db = {
      reportingPeriod: {
        findMany: vi.fn().mockResolvedValue([period]),
      },
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          effectiveTaxRate: decimal("0.25"),
          taxDeductionMode: "all_causes",
        }),
      },
      orderSnapshotLine: {
        findMany: vi.fn().mockResolvedValue([
          {
            shopifyLineItemId: "line-1",
            productTitle: "Tee",
            variantTitle: "Large",
            quantity: 2,
            subtotal: decimal("120.00"),
            netContribution: decimal("100.00"),
            snapshot: {
              id: "snapshot-1",
              shopifyOrderId: "gid://shopify/Order/1",
              orderNumber: "#1001",
            },
            adjustments: [{ netContribAdj: decimal("10.00") }],
            causeAllocations: [
              {
                causeId: "cause-1",
                causeName: "Cause One",
                is501c3: true,
                amount: decimal("50.00"),
              },
            ],
          },
          {
            shopifyLineItemId: "line-2",
            productTitle: "Sticker",
            variantTitle: "Default",
            quantity: 1,
            subtotal: decimal("40.00"),
            netContribution: decimal("20.00"),
            snapshot: {
              id: "snapshot-2",
              shopifyOrderId: "gid://shopify/Order/2",
              orderNumber: "#1002",
            },
            adjustments: [],
            causeAllocations: [
              {
                causeId: "cause-1",
                causeName: "Cause One",
                is501c3: true,
                amount: decimal("20.00"),
              },
            ],
          },
        ]),
      },
      orderSnapshot: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { salesTaxCollected: decimal("12.34") } }),
      },
      causeAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      businessExpense: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("0") } }),
      },
      shopifyChargeTransaction: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: decimal("10.00") } }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      orderSettlement: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { feeAmount: decimal("12.50") } }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "settlement-1",
            shopifyOrderId: "gid://shopify/Order/2",
            orderNumber: "#1002",
            source: "faire",
            status: "confirmed",
            grossOrderAmount: decimal("40.00"),
            shopifyPaidAmount: decimal("0"),
            amountReceived: decimal("27.50"),
            feeAmount: decimal("12.50"),
            currency: "USD",
            paidAt: new Date("2026-04-15T00:00:00.000Z"),
            referenceId: "faire-payout-1",
            notes: null,
            detectedReason: "Marketplace or external payment source with no Shopify paid amount.",
          },
        ]),
      },
      disbursement: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      taxTrueUp: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: "true-up-1",
              periodId: "prior-period",
              delta: decimal("5.00"),
              redistributions: [
                {
                  causeId: "cause-1",
                  causeName: "Cause One",
                  amount: decimal("5.00"),
                },
              ],
            },
          ]),
      },
      cause: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const result = await buildReportingSummary("shop-1", "period-1", db as never);

    expect(result.summary?.track1.totalNetContribution).toBe("130");
    expect(result.summary?.track1.salesTaxCollected).toBe("12.34");
    expect(result.summary?.track1.shopifyCharges).toBe("10");
    expect(result.summary?.track1.externalSettlementFees).toBe("12.5");
    expect(result.summary?.track1.donationPool).toBe("112.5");
    expect(result.summary?.externalSettlements).toEqual([
      expect.objectContaining({
        id: "settlement-1",
        source: "faire",
        status: "confirmed",
        amountReceived: "27.5",
        feeAmount: "12.5",
      }),
    ]);
    expect(result.summary?.track1.allocations).toEqual([
      expect.objectContaining({
        causeId: "cause-1",
        allocated: "80",
        details: [
          expect.objectContaining({
            kind: "order_line",
            orderSnapshotId: "snapshot-1",
            orderNumber: "#1001",
            productTitle: "Tee",
            quantity: 2,
            grossLineAmount: "120",
            netContributionAmount: "110",
            allocatedAmount: "55",
          }),
          expect.objectContaining({
            kind: "order_line",
            orderSnapshotId: "snapshot-2",
            orderNumber: "#1002",
            productTitle: "Sticker",
            quantity: 1,
            grossLineAmount: "40",
            netContributionAmount: "20",
            allocatedAmount: "20",
          }),
          expect.objectContaining({
            kind: "true_up",
            label: "Tax true-up redistribution",
            allocatedAmount: "5",
          }),
        ],
      }),
    ]);
  });
});
