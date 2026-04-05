import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOrderUpdateSignature,
  buildProportionalAdjustment,
  processOrderUpdate,
  processRefund,
} from "./adjustmentService.server";

const { recomputeTaxOffsetCache } = vi.hoisted(() => ({
  recomputeTaxOffsetCache: vi.fn(),
}));

vi.mock("./taxOffsetCache.server", () => ({
  recomputeTaxOffsetCache,
}));

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

function createDb({
  snapshot,
  existingAuditLog = null,
}: {
  snapshot?: unknown;
  existingAuditLog?: unknown;
}) {
  const adjustmentCreate = vi.fn().mockResolvedValue(undefined);
  const auditLogCreate = vi.fn().mockResolvedValue(undefined);

  const tx = {
    adjustment: {
      create: adjustmentCreate,
    },
    auditLog: {
      create: auditLogCreate,
    },
  };

  return {
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(existingAuditLog),
      create: auditLogCreate,
    },
    orderSnapshot: {
      findFirst: vi.fn().mockResolvedValue(snapshot ?? null),
    },
    $transaction: vi.fn().mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) => callback(tx)),
    __spies: {
      adjustmentCreate,
      auditLogCreate,
    },
  };
}

describe("buildProportionalAdjustment", () => {
  it("scales every tracked category by the supplied ratio", () => {
    const adjustment = buildProportionalAdjustment(
      {
        laborCost: decimal("12"),
        materialCost: decimal("18"),
        packagingCost: decimal("4"),
        equipmentCost: decimal("6"),
        netContribution: decimal("10"),
      },
      decimal("-0.5"),
    );

    expect(adjustment).toMatchObject({
      laborAdj: decimal("-6"),
      materialAdj: decimal("-9"),
      packagingAdj: decimal("-2"),
      equipmentAdj: decimal("-3"),
      netContribAdj: decimal("-5"),
    });
  });
});

describe("buildOrderUpdateSignature", () => {
  it("is stable regardless of line item ordering", () => {
    const left = buildOrderUpdateSignature({
      admin_graphql_api_id: "gid://shopify/Order/1",
      subtotal_price: "25.00",
      line_items: [
        { id: 2, quantity: 1, price: "10.00" },
        { id: 1, quantity: 3, price: "5.00" },
      ],
    });
    const right = buildOrderUpdateSignature({
      admin_graphql_api_id: "gid://shopify/Order/1",
      subtotal_price: "25.00",
      line_items: [
        { id: 1, quantity: 3, price: "5.00" },
        { id: 2, quantity: 1, price: "10.00" },
      ],
    });

    expect(left).toBe(right);
  });
});

describe("processRefund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates proportional negative adjustments for refunded line items", async () => {
    const db = createDb({
      snapshot: {
        id: "snapshot-1",
        lines: [
          {
            id: "snapshot-line-1",
            shopifyLineItemId: "gid://shopify/LineItem/11",
            quantity: 4,
            subtotal: decimal("40"),
            laborCost: decimal("8"),
            materialCost: decimal("12"),
            packagingCost: decimal("4"),
            equipmentCost: decimal("0"),
            netContribution: decimal("16"),
            adjustments: [],
          },
        ],
      },
    });

    const result = await processRefund(
      "shop-1",
      {
        id: 77,
        order_id: 99,
        refund_line_items: [{ line_item_id: 11, quantity: 2 }],
      },
      db,
    );

    expect(result).toEqual({ created: 1, skipped: 0 });
    expect(db.__spies.adjustmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "refund",
          laborAdj: decimal("-4"),
          materialAdj: decimal("-6"),
          packagingAdj: decimal("-2"),
          netContribAdj: decimal("-8"),
        }),
      }),
    );
    const refundAdjustmentData = db.__spies.adjustmentCreate.mock.calls[0]?.[0]?.data;
    expect(refundAdjustmentData.equipmentAdj.toString()).toBe("0");
    expect(recomputeTaxOffsetCache).toHaveBeenCalled();
  });
});

describe("processOrderUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates adjustments from the delta between the effective line subtotal and the updated subtotal", async () => {
    const db = createDb({
      snapshot: {
        id: "snapshot-1",
        lines: [
          {
            id: "snapshot-line-1",
            shopifyLineItemId: "gid://shopify/LineItem/22",
            quantity: 2,
            subtotal: decimal("50"),
            laborCost: decimal("10"),
            materialCost: decimal("20"),
            packagingCost: decimal("5"),
            equipmentCost: decimal("0"),
            netContribution: decimal("15"),
            adjustments: [],
          },
        ],
      },
    });

    const result = await processOrderUpdate(
      "shop-1",
      {
        admin_graphql_api_id: "gid://shopify/Order/123",
        subtotal_price: "75.00",
        line_items: [{ id: 22, quantity: 3, price: "25.00" }],
      },
      db,
    );

    expect(result).toEqual({ created: 1, skipped: 0 });
    expect(db.__spies.adjustmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "manual",
          laborAdj: decimal("5"),
          materialAdj: decimal("10"),
          packagingAdj: decimal("2.5"),
          equipmentAdj: decimal("0"),
          netContribAdj: decimal("7.5"),
        }),
      }),
    );
    expect(recomputeTaxOffsetCache).toHaveBeenCalled();
  });
});
