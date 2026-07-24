import { Prisma } from "@prisma/client";

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);

export type DonationPoolInputs = {
  totalNetContribution: Prisma.Decimal;
  shopifyCharges: Prisma.Decimal;
  externalSettlementFees: Prisma.Decimal;
  artistPayouts: Prisma.Decimal;
  estimatedTaxReserve: Prisma.Decimal;
  taxTrueUpSurplus: Prisma.Decimal;
  taxTrueUpShortfall: Prisma.Decimal;
  requestedDonation: Prisma.Decimal;
};

/**
 * Separates profitable capacity from the amount the merchant committed to causes.
 * Cause commitments may retain part of the available capacity for the shop, but
 * can never create obligations larger than the available capacity.
 */
export function computeDonationPool(input: DonationPoolInputs): {
  availableDonationCapacity: Prisma.Decimal;
  requestedDonation: Prisma.Decimal;
  donationPool: Prisma.Decimal;
  retainedByShop: Prisma.Decimal;
  allocationScale: Prisma.Decimal;
} {
  const availableDonationCapacity = Prisma.Decimal.max(
    input.totalNetContribution
      .sub(input.shopifyCharges)
      .sub(input.externalSettlementFees)
      .sub(input.artistPayouts)
      .sub(input.estimatedTaxReserve)
      .add(input.taxTrueUpSurplus)
      .sub(input.taxTrueUpShortfall),
    ZERO,
  );
  const requestedDonation = Prisma.Decimal.max(input.requestedDonation, ZERO);
  const donationPool = Prisma.Decimal.min(requestedDonation, availableDonationCapacity);
  const allocationScale = requestedDonation.greaterThan(ZERO) && donationPool.lessThan(requestedDonation)
    ? donationPool.div(requestedDonation)
    : ONE;

  return {
    availableDonationCapacity,
    requestedDonation,
    donationPool,
    retainedByShop: availableDonationCapacity.sub(donationPool),
    allocationScale,
  };
}

export function capCauseAllocations<T extends { allocated: Prisma.Decimal }>(
  allocations: T[],
  donationPool: Prisma.Decimal,
): T[] {
  const requestedDonation = allocations.reduce((sum, allocation) => sum.add(allocation.allocated), ZERO);
  if (allocations.length === 0 || requestedDonation.lessThanOrEqualTo(donationPool)) {
    return allocations;
  }

  if (donationPool.lessThanOrEqualTo(ZERO)) {
    return allocations.map((allocation) => ({ ...allocation, allocated: ZERO }));
  }

  const scale = donationPool.div(requestedDonation);
  const lastIndex = allocations.length - 1;
  let allocated = ZERO;

  return allocations.map((allocation, index) => {
    const capped = index === lastIndex
      ? donationPool.sub(allocated)
      : allocation.allocated.mul(scale).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
    allocated = allocated.add(capped);
    return { ...allocation, allocated: capped };
  });
}
