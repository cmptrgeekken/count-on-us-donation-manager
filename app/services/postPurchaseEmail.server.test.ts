import { describe, expect, it, vi } from "vitest";

import { sendPostPurchaseDonationEmail } from "./postPurchaseEmail.server";

describe("sendPostPurchaseDonationEmail", () => {
  it("sends the donation email when enabled and a contact email is present", async () => {
    const db = {
      orderSnapshot: {
        findUnique: vi.fn().mockResolvedValue({
          id: "snapshot-1",
          shopId: "fixture.myshopify.com",
          orderNumber: "#1001",
          lines: [
            {
              causeAllocations: [
                {
                  causeId: "cause-1",
                  causeName: "Neighborhood Arts",
                  amount: { toString: () => "12.00" },
                  cause: {
                    iconUrl: null,
                    donationLink: "https://example.com/a",
                  },
                },
              ],
            },
          ],
        }),
      },
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          shopifyDomain: "fixture.myshopify.com",
          postPurchaseEmailEnabled: true,
        }),
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const transport = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    const result = await sendPostPurchaseDonationEmail(
      {
        snapshotId: "snapshot-1",
        contactEmail: "customer@example.com",
      },
      db as never,
      transport as never,
    );

    expect(result).toEqual({ status: "sent" });
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "customer@example.com",
        subject: expect.stringContaining("donation impact"),
      }),
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "POST_PURCHASE_EMAIL_SENT",
          entityId: "snapshot-1",
        }),
      }),
    );
  });

  it("skips when the merchant disables the post-purchase email", async () => {
    const db = {
      orderSnapshot: {
        findUnique: vi.fn().mockResolvedValue({
          id: "snapshot-1",
          shopId: "fixture.myshopify.com",
          orderNumber: "#1001",
          lines: [],
        }),
      },
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          shopifyDomain: "fixture.myshopify.com",
          postPurchaseEmailEnabled: false,
        }),
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    const result = await sendPostPurchaseDonationEmail(
      {
        snapshotId: "snapshot-1",
        contactEmail: "customer@example.com",
      },
      db as never,
      { send: vi.fn() } as never,
    );

    expect(result).toEqual({ status: "skipped_disabled" });
  });

  it("skips when the order payload does not include a contact email", async () => {
    const result = await sendPostPurchaseDonationEmail(
      {
        snapshotId: "snapshot-1",
        contactEmail: "",
      },
      {} as never,
      { send: vi.fn() } as never,
    );

    expect(result).toEqual({ status: "skipped_no_email" });
  });

  it("surfaces provider failures so the job queue can retry", async () => {
    const db = {
      orderSnapshot: {
        findUnique: vi.fn().mockResolvedValue({
          id: "snapshot-1",
          shopId: "fixture.myshopify.com",
          orderNumber: "#1001",
          lines: [
            {
              causeAllocations: [
                {
                  causeId: "cause-1",
                  causeName: "Neighborhood Arts",
                  amount: { toString: () => "12.00" },
                  cause: {
                    iconUrl: null,
                    donationLink: null,
                  },
                },
              ],
            },
          ],
        }),
      },
      shop: {
        findUnique: vi.fn().mockResolvedValue({
          shopifyDomain: "fixture.myshopify.com",
          postPurchaseEmailEnabled: true,
        }),
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const transport = {
      send: vi.fn().mockRejectedValue(new Error("provider down")),
    };

    await expect(
      sendPostPurchaseDonationEmail(
        {
          snapshotId: "snapshot-1",
          contactEmail: "customer@example.com",
        },
        db as never,
        transport as never,
      ),
    ).rejects.toThrow("provider down");
  });
});
