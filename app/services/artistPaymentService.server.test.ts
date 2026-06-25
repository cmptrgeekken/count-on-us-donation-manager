import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { TransactionCapableDbClient } from "../db.server";
import { logArtistPayment } from "./artistPaymentService.server";

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

function createDb(tx: object): TransactionCapableDbClient {
  return {
    $transaction: vi.fn().mockImplementation((callback) => callback(tx)),
  } as unknown as TransactionCapableDbClient;
}

describe("logArtistPayment", () => {
  it("creates a payment and applies it FIFO across older outstanding allocations", async () => {
    const tx = {
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue({
          id: "period-2",
          status: "CLOSED",
          endDate: new Date("2026-05-01T00:00:00.000Z"),
        }),
      },
      artistAllocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "allocation-1",
            periodId: "period-1",
            artistId: "artist-1",
            artistName: "Artist One",
            creditName: "Artist Credit",
            allocated: decimal("50.00"),
            paid: decimal("40.00"),
            period: {
              startDate: new Date("2026-04-01T00:00:00.000Z"),
              endDate: new Date("2026-04-15T00:00:00.000Z"),
            },
          },
          {
            id: "allocation-2",
            periodId: "period-2",
            artistId: "artist-1",
            artistName: "Artist One",
            creditName: "Artist Credit",
            allocated: decimal("60.00"),
            paid: decimal("15.00"),
            period: {
              startDate: new Date("2026-04-16T00:00:00.000Z"),
              endDate: new Date("2026-05-01T00:00:00.000Z"),
            },
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      artistPayment: {
        create: vi.fn().mockResolvedValue({ id: "payment-1" }),
      },
      artistPaymentApplication: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = createDb(tx);

    const result = await logArtistPayment(
      "shop-1",
      {
        periodId: "period-2",
        artistId: "artist-1",
        amount: "30.00",
        paidAt: new Date("2026-05-08T00:00:00.000Z"),
        paymentMethod: "ACH",
        referenceId: "artist-pay-123",
      },
      { db, actor: "merchant" },
    );

    expect(tx.artistAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shopId: "shop-1",
          artistId: "artist-1",
          period: { status: "CLOSED", endDate: { lte: new Date("2026-05-01T00:00:00.000Z") } },
        }),
        orderBy: [{ period: { endDate: "asc" } }, { createdAt: "asc" }],
      }),
    );
    expect(tx.artistPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shopId: "shop-1",
          periodId: "period-2",
          artistId: "artist-1",
          amount: decimal("30.00"),
          paymentMethod: "ACH",
          referenceId: "artist-pay-123",
        }),
      }),
    );
    expect(tx.artistPaymentApplication.createMany).toHaveBeenCalledWith({
      data: [
        {
          shopId: "shop-1",
          artistPaymentId: "payment-1",
          artistAllocationId: "allocation-1",
          amount: decimal("10"),
        },
        {
          shopId: "shop-1",
          artistPaymentId: "payment-1",
          artistAllocationId: "allocation-2",
          amount: decimal("20"),
        },
      ],
    });
    expect(tx.artistAllocation.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "allocation-1", shopId: "shop-1" },
      data: { paid: { increment: decimal("10") } },
    });
    expect(tx.artistAllocation.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "allocation-2", shopId: "shop-1" },
      data: { paid: { increment: decimal("20") } },
    });
    expect(result.remaining.toString()).toBe("25");
  });

  it("rejects payments larger than the remaining payable", async () => {
    const tx = {
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue({
          id: "period-1",
          status: "CLOSED",
          endDate: new Date("2026-04-01T00:00:00.000Z"),
        }),
      },
      artistAllocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "allocation-1",
            periodId: "period-1",
            artistId: "artist-1",
            artistName: "Artist One",
            creditName: "Artist Credit",
            allocated: decimal("100.00"),
            paid: decimal("95.00"),
            period: {
              startDate: new Date("2026-03-16T00:00:00.000Z"),
              endDate: new Date("2026-04-01T00:00:00.000Z"),
            },
          },
        ]),
      },
    };
    const db = createDb(tx);

    await expect(
      logArtistPayment(
        "shop-1",
        {
          periodId: "period-1",
          artistId: "artist-1",
          amount: "10.00",
          paidAt: new Date("2026-04-08T00:00:00.000Z"),
          paymentMethod: "ACH",
        },
        { db },
      ),
    ).rejects.toThrow("Artist payment amount cannot exceed the remaining payable.");
  });

  it("floors payment amounts to cents before creating applications", async () => {
    const tx = {
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue({
          id: "period-1",
          status: "CLOSED",
          endDate: new Date("2026-04-01T00:00:00.000Z"),
        }),
      },
      artistAllocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "allocation-1",
            periodId: "period-1",
            artistId: "artist-1",
            artistName: "Artist One",
            creditName: "Artist Credit",
            allocated: decimal("100.00"),
            paid: decimal("0"),
            period: {
              startDate: new Date("2026-03-16T00:00:00.000Z"),
              endDate: new Date("2026-04-01T00:00:00.000Z"),
            },
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      artistPayment: {
        create: vi.fn().mockResolvedValue({ id: "payment-1" }),
      },
      artistPaymentApplication: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = createDb(tx);

    await logArtistPayment(
      "shop-1",
      {
        periodId: "period-1",
        artistId: "artist-1",
        amount: "12.9999",
        paidAt: new Date("2026-04-08T00:00:00.000Z"),
        paymentMethod: "ACH",
      },
      { db },
    );

    expect(tx.artistPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: decimal("12.99"),
        }),
      }),
    );
    expect(tx.artistPaymentApplication.createMany).toHaveBeenCalledWith({
      data: [
        {
          shopId: "shop-1",
          artistPaymentId: "payment-1",
          artistAllocationId: "allocation-1",
          amount: decimal("12.99"),
        },
      ],
    });
  });

  it("rejects payments for open periods", async () => {
    const tx = {
      reportingPeriod: {
        findFirst: vi.fn().mockResolvedValue({
          id: "period-1",
          status: "OPEN",
          endDate: new Date("2026-04-01T00:00:00.000Z"),
        }),
      },
    };
    const db = createDb(tx);

    await expect(
      logArtistPayment(
        "shop-1",
        {
          periodId: "period-1",
          artistId: "artist-1",
          amount: "10.00",
          paidAt: new Date("2026-04-08T00:00:00.000Z"),
          paymentMethod: "ACH",
        },
        { db },
      ),
    ).rejects.toThrow("Artist payments can only be logged for closed reporting periods.");
  });
});
