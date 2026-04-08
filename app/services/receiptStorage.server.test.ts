import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  buildDisbursementReceiptKey,
  createReceiptStorage,
  readLocalReceiptFile,
  verifyReceiptSignature,
} from "./receiptStorage.server";

describe("receiptStorage", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.unstubAllEnvs();
    tempDir = mkdtempSync(path.join(os.tmpdir(), "count-on-us-receipts-"));
    vi.stubEnv("RECEIPT_STORAGE_DRIVER", "local");
    vi.stubEnv("RECEIPT_STORAGE_LOCAL_DIR", tempDir);
    vi.stubEnv("SHOPIFY_APP_URL", "http://localhost:3000");
    vi.stubEnv("RECEIPT_STORAGE_SIGNING_SECRET", "test-secret");
  });

  it("stores local receipts and returns signed local read URLs", async () => {
    const storage = createReceiptStorage();
    const key = buildDisbursementReceiptKey({
      shopId: "shop-1",
      periodId: "period-1",
      disbursementId: "dis-1",
      filename: "receipt.pdf",
    });

    await storage.put({
      key,
      body: new TextEncoder().encode("receipt-body"),
      contentType: "application/pdf",
    });

    const url = await storage.getSignedReadUrl({ key, expiresInSeconds: 60 });
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/dev/receipt-file");
    expect(parsed.searchParams.get("key")).toBe(key);
    expect(
      verifyReceiptSignature(
        key,
        Number(parsed.searchParams.get("expires")),
        parsed.searchParams.get("signature") ?? "",
      ),
    ).toBe(true);

    const file = await readLocalReceiptFile(key);
    expect(new TextDecoder().decode(file.body)).toBe("receipt-body");
    expect(file.contentType).toBe("application/pdf");
  });

  it("deletes local receipts and metadata", async () => {
    const storage = createReceiptStorage();
    const key = buildDisbursementReceiptKey({
      shopId: "shop-1",
      periodId: "period-1",
      disbursementId: "dis-1",
      filename: "receipt.png",
    });

    await storage.put({
      key,
      body: new TextEncoder().encode("receipt-body"),
      contentType: "image/png",
    });

    await storage.delete({ key });

    await expect(readLocalReceiptFile(key)).rejects.toThrow();
  });

  it("sanitizes disbursement receipt keys", async () => {
    const key = buildDisbursementReceiptKey({
      shopId: "shop.myshopify.com",
      periodId: "period-1",
      disbursementId: "dis-1",
      filename: "../dangerous receipt?.pdf",
    });

    expect(key).toContain("shop.myshopify.com/disbursements/period-1/dis-1/");
    expect(key).not.toContain("..");
    expect(key).toContain("dangerous-receipt.pdf");
  });
});
