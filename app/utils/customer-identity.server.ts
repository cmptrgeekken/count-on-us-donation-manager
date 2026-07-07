import { createHash } from "node:crypto";

export function normalizeCustomerEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function hashNormalizedCustomerEmail(value: string | null | undefined): string | null {
  const normalized = normalizeCustomerEmail(value);
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex");
}
