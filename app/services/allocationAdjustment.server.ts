import { Prisma } from "@prisma/client";

const ZERO = new Prisma.Decimal(0);
const RATIO_GUARD = new Prisma.Decimal(10);

export function adjustAllocationForLineChange(input: {
  baseAmount: Prisma.Decimal;
  lineNetContribution: Prisma.Decimal;
  lineAdjustmentTotal: Prisma.Decimal;
}): {
  amount: Prisma.Decimal;
  ratio: Prisma.Decimal | null;
  reviewRequired: boolean;
  reviewReason: "ZERO_NET_CONTRIBUTION" | "EXTREME_ADJUSTMENT_RATIO" | null;
} {
  if (input.lineAdjustmentTotal.equals(ZERO)) {
    return { amount: input.baseAmount, ratio: ZERO, reviewRequired: false, reviewReason: null };
  }

  if (input.lineNetContribution.equals(ZERO)) {
    return {
      amount: input.baseAmount,
      ratio: null,
      reviewRequired: true,
      reviewReason: "ZERO_NET_CONTRIBUTION",
    };
  }

  const ratio = input.lineAdjustmentTotal.div(input.lineNetContribution);
  if (ratio.abs().greaterThan(RATIO_GUARD)) {
    return {
      amount: input.baseAmount,
      ratio,
      reviewRequired: true,
      reviewReason: "EXTREME_ADJUSTMENT_RATIO",
    };
  }

  return {
    amount: input.baseAmount.add(input.baseAmount.mul(ratio)),
    ratio,
    reviewRequired: false,
    reviewReason: null,
  };
}
