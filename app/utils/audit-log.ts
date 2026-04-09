export const AUDIT_LOG_ALL_ACTIONS = "all";

export function normalizeAuditAction(value: string | null) {
  if (!value) return AUDIT_LOG_ALL_ACTIONS;
  const trimmed = value.trim();
  return trimmed ? trimmed : AUDIT_LOG_ALL_ACTIONS;
}

export function normalizeAuditDate(value: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

export function endOfAuditDay(dateString: string) {
  return new Date(`${dateString}T23:59:59.999Z`);
}

export function formatAuditPayload(payload: unknown) {
  if (!payload) return "";
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}
