import crypto from "node:crypto";

/**
 * Verifies a Shopify webhook HMAC-SHA256 signature.
 *
 * IMPORTANT: rawBody must be the unmodified request body bytes.
 * Any framework-level body parsing that runs before this function will
 * invalidate the HMAC. Always read the body as a Buffer before calling this.
 */
export function verifyWebhookHmac(
  rawBody: Buffer,
  hmacHeader: string,
  secret: string,
): boolean {
  if (!hmacHeader || !secret) return false;

  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  try {
    // timingSafeEqual throws if buffer lengths differ — catch and return false
    return crypto.timingSafeEqual(
      Buffer.from(computed),
      Buffer.from(hmacHeader),
    );
  } catch {
    return false;
  }
}
