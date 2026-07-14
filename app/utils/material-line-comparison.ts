type DecimalLike = { toString(): string };

export type ComparableMaterialLine = {
  quantity: DecimalLike;
  yield: DecimalLike | null;
  usesPerVariant: DecimalLike | null;
};

function nullableDecimalEqual(left: DecimalLike | null, right: DecimalLike | null): boolean {
  if (left === null || right === null) return left === right;
  return left.toString() === right.toString();
}

/**
 * Compare only the values used by the cost engine for the material's costing model.
 * Legacy and unknown models use the counted-parts fallback (quantity only).
 */
export function materialLineValuesEqual(
  costingModel: string | null,
  variantLine: ComparableMaterialLine,
  templateLine: ComparableMaterialLine,
): boolean {
  if (costingModel === "yield") {
    return (
      nullableDecimalEqual(variantLine.quantity, templateLine.quantity) &&
      nullableDecimalEqual(variantLine.yield, templateLine.yield)
    );
  }

  if (costingModel === "uses") {
    return nullableDecimalEqual(variantLine.usesPerVariant, templateLine.usesPerVariant);
  }

  return nullableDecimalEqual(variantLine.quantity, templateLine.quantity);
}
