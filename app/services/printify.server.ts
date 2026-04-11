type FetchLike = typeof fetch;

export type PrintifyShopSummary = {
  id: string;
  title: string | null;
};

export type ValidatedPrintifyConnection = {
  shopCount: number;
  primaryShop: PrintifyShopSummary | null;
};

type PrintifyShopsResponse =
  | {
      data?: Array<{
        id?: number | string | null;
        title?: string | null;
      }>;
    }
  | Array<{
      id?: number | string | null;
      title?: string | null;
    }>;

type PrintifyErrorResponse = {
  message?: string;
  error?: string;
};

export class PrintifyValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.name = "PrintifyValidationError";
    this.status = status;
  }
}

function normalizeShop(shop: { id?: number | string | null; title?: string | null }): PrintifyShopSummary | null {
  const id = shop.id;
  if (id === null || id === undefined) return null;

  return {
    id: String(id),
    title: shop.title?.trim() || null,
  };
}

function getResponseMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  if ("message" in payload && typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  if ("error" in payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }

  return null;
}

export async function validatePrintifyApiKey(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<ValidatedPrintifyConnection> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new PrintifyValidationError("Printify API key is required.", 400);
  }

  const response = await fetchImpl("https://api.printify.com/v1/shops.json", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${trimmedKey}`,
      "Content-Type": "application/json",
    },
  });

  let payload: PrintifyShopsResponse | PrintifyErrorResponse | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const providerMessage = getResponseMessage(payload);
    throw new PrintifyValidationError(
      providerMessage ?? "Printify credentials could not be validated.",
      response.status === 401 || response.status === 403 ? 422 : response.status,
    );
  }

  const shopsPayload = Array.isArray(payload)
    ? payload
    : payload && "data" in payload && Array.isArray(payload.data)
      ? payload.data
      : [];
  const shops = shopsPayload
    .map((shop) => normalizeShop(shop))
    .filter((shop): shop is PrintifyShopSummary => shop !== null);

  if (shops.length === 0) {
    throw new PrintifyValidationError("Printify credentials are valid, but no accessible Printify shops were returned.");
  }

  return {
    shopCount: shops.length,
    primaryShop: shops[0] ?? null,
  };
}
