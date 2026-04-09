import { findWidgetVariant, scaleWidgetVariantForQuantity } from "./widget-display";

type CartLine = {
  productId: string;
  variantId: string;
  quantity: number;
};

type WidgetPayload = {
  productId: string;
  visible: boolean;
  variants: Array<{
    variantId: string;
    causes: Array<{
      causeId: string;
      name: string;
      iconUrl: string | null;
      donationPercentage: string;
      estimatedDonationAmount: string;
      donationCurrencyCode: string;
      donationLink: string | null;
    }>;
    taxReserve: {
      suppressed: boolean;
      estimatedRate: string;
      estimatedAmount: string;
    };
    laborCost: string;
    materialLines: Array<{ name: string; lineCost: string; type?: string }>;
    equipmentLines: Array<{ name: string; lineCost: string }>;
    shippingMaterialLines: Array<{ name: string; lineCost: string }>;
    podCostTotal: string;
    mistakeBufferAmount: string;
    price: string;
    currencyCode: string;
    shopifyFees: {
      processingRate: string;
      processingFlatFee: string;
      managedMarketsRate: string;
      managedMarketsApplicable: boolean;
    };
  }>;
};

function parseMoney(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fixedMoney(value: number) {
  return value.toFixed(2);
}

export function aggregateCartCauseTotals(lines: CartLine[], payloads: WidgetPayload[]) {
  const payloadMap = new Map(payloads.map((payload) => [payload.productId, payload]));
  const totals = new Map<
    string,
    {
      causeId: string;
      name: string;
      iconUrl: string | null;
      donationLink: string | null;
      donationCurrencyCode: string;
      amount: number;
    }
  >();

  let hasDonationProducts = false;

  for (const line of lines) {
    const payload = payloadMap.get(line.productId);
    if (!payload || !payload.visible) continue;

    const variant = findWidgetVariant(payload.variants, line.variantId);
    if (!variant) continue;

    hasDonationProducts = true;
    const scaledVariant = scaleWidgetVariantForQuantity(variant, line.quantity);

    for (const cause of scaledVariant.causes) {
      const current = totals.get(cause.causeId) ?? {
        causeId: cause.causeId,
        name: cause.name,
        iconUrl: cause.iconUrl,
        donationLink: cause.donationLink,
        donationCurrencyCode: cause.donationCurrencyCode,
        amount: 0,
      };

      current.amount += parseMoney(cause.estimatedDonationAmount);
      totals.set(cause.causeId, current);
    }
  }

  return {
    hasDonationProducts,
    totals: Array.from(totals.values())
      .map((cause) => ({
        ...cause,
        amount: fixedMoney(cause.amount),
      }))
      .sort((left, right) => parseMoney(right.amount) - parseMoney(left.amount) || left.name.localeCompare(right.name)),
  };
}
