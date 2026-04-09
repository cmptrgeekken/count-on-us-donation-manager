import { describe, expect, it, vi } from "vitest";

import { buildDonationReceiptsPage } from "./donationReceiptsPage.server";

describe("buildDonationReceiptsPage", () => {
  it("returns closed periods in reverse chronological order with fresh receipt URLs", async () => {
    const db = {
      reportingPeriod: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "period-2",
            startDate: new Date("2026-03-01T00:00:00.000Z"),
            endDate: new Date("2026-03-31T00:00:00.000Z"),
            disbursements: [
              {
                id: "dis-2",
                amount: { toString: () => "15.00", valueOf: () => 15 },
                paidAt: new Date("2026-04-02T00:00:00.000Z"),
                paymentMethod: "ACH",
                referenceId: "march-001",
                receiptFileKey: "receipts/march.pdf",
                cause: { name: "Neighborhood Arts" },
              },
            ],
            causeAllocations: [
              {
                causeId: "cause-1",
                causeName: "Neighborhood Arts",
                allocated: { toString: () => "15.00" },
              },
            ],
          },
          {
            id: "period-1",
            startDate: new Date("2026-02-01T00:00:00.000Z"),
            endDate: new Date("2026-02-28T00:00:00.000Z"),
            disbursements: [
              {
                id: "dis-1",
                amount: { toString: () => "12.50", valueOf: () => 12.5 },
                paidAt: new Date("2026-03-03T00:00:00.000Z"),
                paymentMethod: "Check",
                referenceId: null,
                receiptFileKey: null,
                cause: { name: "Community Library" },
              },
            ],
            causeAllocations: [
              {
                causeId: "cause-2",
                causeName: "Community Library",
                allocated: { toString: () => "12.50" },
              },
            ],
          },
        ]),
      },
    };

    const storage = {
      getSignedReadUrl: vi.fn().mockResolvedValue("https://example.com/receipts/march.pdf"),
    };

    const result = await buildDonationReceiptsPage("shop.myshopify.com", db as never, storage as never);

    expect(storage.getSignedReadUrl).toHaveBeenCalledWith({
      key: "receipts/march.pdf",
      expiresInSeconds: 60 * 60,
    });
    expect(result).toEqual({
      hasReceipts: true,
      periods: [
        {
          id: "period-2",
          startDate: "2026-03-01T00:00:00.000Z",
          endDate: "2026-03-31T00:00:00.000Z",
          totalDonated: "15.00",
          causeBreakdown: [
            {
              causeId: "cause-1",
              causeName: "Neighborhood Arts",
              allocated: "15.00",
            },
          ],
          disbursements: [
            {
              id: "dis-2",
              causeName: "Neighborhood Arts",
              amount: "15.00",
              paidAt: "2026-04-02T00:00:00.000Z",
              paymentMethod: "ACH",
              referenceId: "march-001",
              receiptUrl: "https://example.com/receipts/march.pdf",
            },
          ],
        },
        {
          id: "period-1",
          startDate: "2026-02-01T00:00:00.000Z",
          endDate: "2026-02-28T00:00:00.000Z",
          totalDonated: "12.50",
          causeBreakdown: [
            {
              causeId: "cause-2",
              causeName: "Community Library",
              allocated: "12.50",
            },
          ],
          disbursements: [
            {
              id: "dis-1",
              causeName: "Community Library",
              amount: "12.50",
              paidAt: "2026-03-03T00:00:00.000Z",
              paymentMethod: "Check",
              referenceId: null,
              receiptUrl: null,
            },
          ],
        },
      ],
    });
  });

  it("returns an empty state when there are no closed periods with disbursements", async () => {
    const db = {
      reportingPeriod: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const result = await buildDonationReceiptsPage("shop.myshopify.com", db as never);

    expect(result).toEqual({
      hasReceipts: false,
      periods: [],
    });
  });
});
