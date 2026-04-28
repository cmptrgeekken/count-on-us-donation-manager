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
    expect(result).toEqual({
      metadata: {
        version: "2026-04",
        generatedAt: "2026-04-15T12:00:00.000Z",
        coverageLabel: "Closed reporting periods",
        disclosureTier: "standard",
        hiddenSections: [],
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
          causeName: "Neighborhood Arts",
          amount: "15.00",
          paidAt: "2026-04-02T00:00:00.000Z",
          receiptUrl: "https://example.com/receipts/march.pdf",
        },
      ],
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
    expect(result.metadata.hiddenSections).toEqual(["causeSummaries", "receipts", "pendingDisbursements"]);
    expect(result.causeSummaries).toEqual([]);
    expect(result.receipts).toEqual([]);
  });

  it("returns no public data when transparency is disabled", async () => {
    const db = {
      reportingPeriod: {
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
      periods: [],
      hasPublicActivity: false,
    });
  });
});
