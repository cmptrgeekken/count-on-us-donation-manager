import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logDisbursement, MAX_RECEIPT_BYTES } from "./disbursementService.server";

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

describe("logDisbursement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a disbursement, increments disbursed totals, and stores the receipt", async () => {
    const tx = {
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue({ id: "period-1", status: "CLOSED" }),
      },
      causeAllocation: {
        findFirst: vi.fn().mockResolvedValue({
          id: "allocation-1",
          causeId: "cause-1",
          causeName: "Cause One",
          allocated: decimal("100.00"),
          disbursed: decimal("25.00"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      disbursement: {
        create: vi.fn().mockResolvedValue({ id: "disbursement-1" }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
    };
    const storage = {
      put: vi.fn().mockResolvedValue({ key: "receipt-key" }),
      getSignedReadUrl: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const result = await logDisbursement(
      "shop-1",
      {
        periodId: "period-1",
        causeId: "cause-1",
        amount: "40.00",
        paidAt: new Date("2026-04-08T00:00:00.000Z"),
        paymentMethod: "ACH",
        referenceId: "payout-123",
        receipt: {
          filename: "receipt.pdf",
          contentType: "application/pdf",
          body: new TextEncoder().encode("receipt-body"),
        },
      },
      { db: db as any, storage: storage as any, actor: "merchant" },
    );

    expect(storage.put).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining("receipt.pdf"),
        contentType: "application/pdf",
      }),
    );
    expect(tx.disbursement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shopId: "shop-1",
          periodId: "period-1",
          causeId: "cause-1",
          amount: decimal("40.00"),
          paymentMethod: "ACH",
          referenceId: "payout-123",
          receiptFileKey: expect.stringContaining("receipt.pdf"),
        }),
      }),
    );
    expect(tx.causeAllocation.updateMany).toHaveBeenCalledWith({
      where: { id: "allocation-1", shopId: "shop-1" },
      data: {
        disbursed: {
          increment: decimal("40.00"),
        },
      },
    });
    expect(result.remaining.toString()).toBe("35");
  });

  it("rejects disbursements larger than the remaining allocation", async () => {
    const tx = {
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue({ id: "period-1", status: "CLOSED" }),
      },
      causeAllocation: {
        findFirst: vi.fn().mockResolvedValue({
          id: "allocation-1",
          causeId: "cause-1",
          causeName: "Cause One",
          allocated: decimal("100.00"),
          disbursed: decimal("95.00"),
        }),
      },
    };
    const db = {
      $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
    };

    await expect(
      logDisbursement(
        "shop-1",
        {
          periodId: "period-1",
          causeId: "cause-1",
          amount: "10.00",
          paidAt: new Date("2026-04-08T00:00:00.000Z"),
          paymentMethod: "ACH",
        },
        { db: db as any },
      ),
    ).rejects.toThrow("cannot exceed the remaining allocation");
  });

  it("cleans up uploaded receipts when the transaction fails", async () => {
    const db = {
      $transaction: vi.fn().mockRejectedValue(new Error("database boom")),
    };
    const storage = {
      put: vi.fn().mockResolvedValue({ key: "receipt-key" }),
      getSignedReadUrl: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      logDisbursement(
        "shop-1",
        {
          periodId: "period-1",
          causeId: "cause-1",
          amount: "10.00",
          paidAt: new Date("2026-04-08T00:00:00.000Z"),
          paymentMethod: "ACH",
          receipt: {
            filename: "receipt.pdf",
            contentType: "application/pdf",
            body: new Uint8Array(MAX_RECEIPT_BYTES),
          },
        },
        { db: db as any, storage: storage as any },
      ),
    ).rejects.toThrow("database boom");

    expect(storage.delete).toHaveBeenCalledWith({
      key: expect.stringContaining("receipt.pdf"),
    });
  });

  it("rejects unsupported receipt types before upload", async () => {
    const storage = {
      put: vi.fn().mockResolvedValue({ key: "receipt-key" }),
      getSignedReadUrl: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      logDisbursement(
        "shop-1",
        {
          periodId: "period-1",
          causeId: "cause-1",
          amount: "10.00",
          paidAt: new Date("2026-04-08T00:00:00.000Z"),
          paymentMethod: "ACH",
          receipt: {
            filename: "receipt.gif",
            contentType: "image/gif",
            body: new Uint8Array(10),
          },
        },
        { storage: storage as any },
      ),
    ).rejects.toThrow("Receipt must be a PDF, PNG, or JPEG file.");

    expect(storage.put).not.toHaveBeenCalled();
  });
});
