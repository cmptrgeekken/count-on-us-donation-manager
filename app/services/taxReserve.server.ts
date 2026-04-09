import { Prisma } from "@prisma/client";

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);

export const taxDeductionModes = {
  DONT_DEDUCT: "dont_deduct",
  NON_501C3_ONLY: "non_501c3_only",
  ALL_CAUSES: "all_causes",
} as const;

export type TaxDeductionMode = (typeof taxDeductionModes)[keyof typeof taxDeductionModes];

export type TaxReserveAllocationInput = {
  is501c3: boolean;
  allocated: Prisma.Decimal;
};

export function decimalOrZero(value: Prisma.Decimal | null | undefined) {
  return value ?? ZERO;
}

export function normalizeTaxDeductionMode(value: string | null | undefined): TaxDeductionMode {
  if (value === taxDeductionModes.ALL_CAUSES || value === taxDeductionModes.NON_501C3_ONLY) {
    return value;
  }

  return taxDeductionModes.DONT_DEDUCT;
}

export function computeTaxableWeight(
  allocations: TaxReserveAllocationInput[],
  mode: string | null | undefined,
) {
  const normalizedMode = normalizeTaxDeductionMode(mode);
  if (normalizedMode === taxDeductionModes.DONT_DEDUCT) {
    return ZERO;
  }

  if (normalizedMode === taxDeductionModes.ALL_CAUSES) {
    return ONE;
  }

  const totals = allocations.reduce(
    (sum, allocation) => ({
      total: sum.total.add(allocation.allocated),
      taxable: allocation.is501c3 ? sum.taxable : sum.taxable.add(allocation.allocated),
    }),
    { total: ZERO, taxable: ZERO },
  );

  if (totals.total.lessThanOrEqualTo(ZERO) || totals.taxable.lessThanOrEqualTo(ZERO)) {
    return ZERO;
  }

  return totals.taxable.div(totals.total).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

export function computeEstimatedTaxReserve({
  totalNetContribution,
  businessExpenseTotal,
  allocations,
  effectiveTaxRate,
  taxDeductionMode,
}: {
  totalNetContribution: Prisma.Decimal;
  businessExpenseTotal: Prisma.Decimal;
  allocations: TaxReserveAllocationInput[];
  effectiveTaxRate: Prisma.Decimal | null | undefined;
  taxDeductionMode: string | null | undefined;
}) {
  const rate = decimalOrZero(effectiveTaxRate);
  const taxableBase = Prisma.Decimal.max(ZERO, totalNetContribution.sub(businessExpenseTotal)).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_FLOOR,
  );
  const taxableWeight = computeTaxableWeight(allocations, taxDeductionMode);

  if (rate.lessThanOrEqualTo(ZERO) || taxableWeight.lessThanOrEqualTo(ZERO)) {
    return {
      taxableBase,
      taxableWeight,
      estimatedTaxReserve: ZERO,
    };
  }

  return {
    taxableBase,
    taxableWeight,
    estimatedTaxReserve: taxableBase
      .mul(rate)
      .mul(taxableWeight)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
  };
}
