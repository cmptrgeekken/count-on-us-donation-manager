import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  deriveEffectiveCauseAssignments,
  resolveProductDonationRoutingSource,
} from "./productDonationRouting.server";

const cause = (id: string, percentage: string) => ({
  causeId: id,
  percentage: new Prisma.Decimal(percentage),
  cause: { id, name: id, is501c3: true, iconUrl: null, donationLink: null },
});

describe("product donation routing", () => {
  it("uses an explicit product override ahead of Artist preferences", () => {
    const result = deriveEffectiveCauseAssignments(
      "product_override",
      [cause("product-cause", "25")],
      [{ collaborationShare: new Prisma.Decimal(100), artist: { causeAssignments: [cause("artist-cause", "100")] } }],
    );

    expect(result.map((assignment) => assignment.causeId)).toEqual(["product-cause"]);
    expect(resolveProductDonationRoutingSource("product_override", 1)).toBe("product_override");
  });

  it("derives weighted Artist preferences in automatic mode", () => {
    const result = deriveEffectiveCauseAssignments(
      "automatic",
      [],
      [
        { collaborationShare: new Prisma.Decimal(60), artist: { causeAssignments: [cause("shared", "50")] } },
        { collaborationShare: new Prisma.Decimal(40), artist: { causeAssignments: [cause("shared", "100")] } },
      ],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.percentage.toString()).toBe("70");
    expect(resolveProductDonationRoutingSource("automatic", 2)).toBe("artist");
  });

  it("keeps an explicit no-Cause override empty instead of falling back", () => {
    const result = deriveEffectiveCauseAssignments(
      "product_override",
      [],
      [{ collaborationShare: new Prisma.Decimal(100), artist: { causeAssignments: [cause("artist-cause", "100")] } }],
    );

    expect(result).toEqual([]);
  });
});
