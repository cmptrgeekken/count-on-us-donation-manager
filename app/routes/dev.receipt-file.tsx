import type { LoaderFunctionArgs } from "@remix-run/node";
import { readLocalReceiptFile, verifyReceiptSignature } from "../services/receiptStorage.server";
import { DEV_RECEIPT_ROUTE_PATH } from "../utils/receipt-routes";

export { DEV_RECEIPT_ROUTE_PATH };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (process.env.NODE_ENV === "production" || (process.env.RECEIPT_STORAGE_DRIVER ?? "local") !== "local") {
    throw new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("key")?.trim() ?? "";
  const expiresRaw = url.searchParams.get("expires")?.trim() ?? "";
  const signature = url.searchParams.get("signature")?.trim() ?? "";

  if (!key || !expiresRaw || !signature) {
    throw new Response("Missing receipt access parameters.", { status: 400 });
  }

  const expires = Number.parseInt(expiresRaw, 10);
  if (!Number.isFinite(expires)) {
    throw new Response("Invalid receipt expiry.", { status: 400 });
  }

  if (Math.floor(Date.now() / 1000) > expires) {
    throw new Response("Receipt link expired.", { status: 410 });
  }

  if (!verifyReceiptSignature(key, expires, signature)) {
    throw new Response("Invalid receipt signature.", { status: 403 });
  }

  const file = await readLocalReceiptFile(key);
  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
};
