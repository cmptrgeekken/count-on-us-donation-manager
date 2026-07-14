export const MAX_VISIBLE_CAUSE_ALLOCATIONS = 2;

export function formatCausePercentage(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");

  return `${whole}${trimmedFraction ? `.${trimmedFraction}` : ""}%`;
}
