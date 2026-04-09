type WidgetLine = {
  name: string;
  lineCost: string;
  type?: string;
};

type WidgetCause = {
  causeId: string;
  name: string;
  iconUrl: string | null;
  donationPercentage: string;
  estimatedDonationAmount: string;
  donationCurrencyCode: string;
  donationLink: string | null;
};

type WidgetVariant = {
  variantId: string;
  price: string;
  currencyCode: string;
  laborCost: string;
  materialLines: WidgetLine[];
  equipmentLines: WidgetLine[];
  shippingMaterialLines: WidgetLine[];
  podCostTotal: string;
  mistakeBufferAmount: string;
  causes: WidgetCause[];
  taxReserve: {
    suppressed: boolean;
    estimatedRate: string;
    estimatedAmount: string;
  };
};

function parseMoney(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fixedMoney(value: number) {
  return value.toFixed(2);
}

function scaleLine(line: WidgetLine, quantity: number) {
  return {
    ...line,
    lineCost: fixedMoney(parseMoney(line.lineCost) * quantity),
  };
}

export function scaleWidgetVariantForQuantity(variant: WidgetVariant, quantity: number) {
  const nextQuantity = Math.max(1, quantity);

  return {
    ...variant,
    laborCost: fixedMoney(parseMoney(variant.laborCost) * nextQuantity),
    materialLines: variant.materialLines.map((line) => scaleLine(line, nextQuantity)),
    equipmentLines: variant.equipmentLines.map((line) => scaleLine(line, nextQuantity)),
    shippingMaterialLines: variant.shippingMaterialLines.map((line) => ({
      ...line,
      lineCost: fixedMoney(parseMoney(line.lineCost)),
    })),
    podCostTotal: fixedMoney(parseMoney(variant.podCostTotal) * nextQuantity),
    mistakeBufferAmount: fixedMoney(parseMoney(variant.mistakeBufferAmount) * nextQuantity),
    causes: variant.causes.map((cause) => ({
      ...cause,
      estimatedDonationAmount: fixedMoney(parseMoney(cause.estimatedDonationAmount) * nextQuantity),
    })),
    taxReserve: {
      ...variant.taxReserve,
      estimatedAmount: fixedMoney(parseMoney(variant.taxReserve.estimatedAmount) * nextQuantity),
    },
  };
}

export function findWidgetVariant<T extends { variantId: string }>(
  variants: T[],
  selectedVariantId: string | null | undefined,
) {
  if (!variants.length) return null;
  if (!selectedVariantId) return variants[0];
  return variants.find((variant) => variant.variantId === selectedVariantId) ?? variants[0];
}
