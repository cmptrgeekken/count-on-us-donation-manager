import { describe, expect, it } from "vitest";
import {
  AUDIT_LOG_ALL_ACTIONS,
  endOfAuditDay,
  formatAuditPayload,
  normalizeAuditAction,
  normalizeAuditDate,
} from "./audit-log";

describe("audit log helpers", () => {
  it("normalizes empty filter values", () => {
    expect(normalizeAuditAction(null)).toBe(AUDIT_LOG_ALL_ACTIONS);
    expect(normalizeAuditAction("   ")).toBe(AUDIT_LOG_ALL_ACTIONS);
    expect(normalizeAuditDate(null)).toBe("");
    expect(normalizeAuditDate("2026-04-09")).toBe("2026-04-09");
    expect(normalizeAuditDate("04/09/2026")).toBe("");
  });

  it("formats payloads and end-of-day dates safely", () => {
    expect(formatAuditPayload({ before: "1.00", after: "2.00" })).toContain("\"before\"");
    expect(formatAuditPayload(null)).toBe("");
    expect(endOfAuditDay("2026-04-09").toISOString()).toBe("2026-04-09T23:59:59.999Z");
  });
});
