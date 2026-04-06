export function normalizeFixedDecimalInput(value: string, digits = 2) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) return value;

  return parsed.toFixed(digits);
}
