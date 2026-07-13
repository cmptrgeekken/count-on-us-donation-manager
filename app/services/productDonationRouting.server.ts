import { Prisma } from "@prisma/client";

export const AUTOMATIC_ROUTING_MODE = "automatic";
export const PRODUCT_OVERRIDE_ROUTING_MODE = "product_override";

export type ProductDonationRoutingMode =
  | typeof AUTOMATIC_ROUTING_MODE
  | typeof PRODUCT_OVERRIDE_ROUTING_MODE;

export type ProductDonationRoutingSource = "product" | "artist" | "product_override";

export function normalizeProductDonationRoutingMode(value: string): ProductDonationRoutingMode {
  if (value === PRODUCT_OVERRIDE_ROUTING_MODE) return PRODUCT_OVERRIDE_ROUTING_MODE;
  return AUTOMATIC_ROUTING_MODE;
}

export function resolveProductDonationRoutingSource(
  routingMode: string,
  activeArtistCount: number,
): ProductDonationRoutingSource {
  const normalizedMode = normalizeProductDonationRoutingMode(routingMode);
  if (normalizedMode === PRODUCT_OVERRIDE_ROUTING_MODE) return "product_override";
  return activeArtistCount > 0 ? "artist" : "product";
}

export type EffectiveCauseAssignment = {
  causeId: string;
  percentage: Prisma.Decimal;
  cause: {
    id: string;
    name: string;
    is501c3: boolean;
    iconUrl: string | null;
    donationLink: string | null;
  };
};

type ArtistRoutingAssignment = {
  collaborationShare: Prisma.Decimal;
  artist: {
    causeAssignments: EffectiveCauseAssignment[];
  };
};

export function deriveEffectiveCauseAssignments(
  routingMode: string,
  productAssignments: EffectiveCauseAssignment[],
  artistAssignments: ArtistRoutingAssignment[],
): EffectiveCauseAssignment[] {
  const source = resolveProductDonationRoutingSource(routingMode, artistAssignments.length);
  if (source !== "artist") return productAssignments;

  const rollup = new Map<string, EffectiveCauseAssignment>();
  for (const assignment of artistAssignments) {
    for (const causeAssignment of assignment.artist.causeAssignments) {
      const weightedPercentage = assignment.collaborationShare
        .mul(causeAssignment.percentage)
        .div(100);
      const current = rollup.get(causeAssignment.causeId);
      if (current) {
        current.percentage = current.percentage.add(weightedPercentage);
      } else {
        rollup.set(causeAssignment.causeId, {
          ...causeAssignment,
          percentage: weightedPercentage,
        });
      }
    }
  }
  return Array.from(rollup.values());
}
