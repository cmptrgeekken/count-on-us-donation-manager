type FetchLike = typeof fetch;

export type PrintifyShopSummary = {
  id: string;
  title: string | null;
};

export type PrintifyProductVariantSummary = {
  productId: string;
  productTitle: string | null;
  productUpdatedAt: Date | null;
  blueprintId: string | null;
  printProviderId: string | null;
  variantId: string;
  variantTitle: string | null;
  sku: string | null;
  cost: number | null;
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

type PrintifyProductsResponse = {
  current_page?: number | null;
  last_page?: number | null;
  next_page_url?: string | null;
  data?: Array<{
    id?: string | number | null;
    title?: string | null;
    blueprint_id?: string | number | null;
    print_provider_id?: string | number | null;
    updated_at?: string | null;
    update_at?: string | null;
    variants?: Array<{
      id?: string | number | null;
      title?: string | null;
      sku?: string | null;
      cost?: number | null;
    }> | null;
  }> | null;
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

function toTrimmedString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  return stringValue || null;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

export async function listPrintifyProducts(
  apiKey: string,
  shopId: string,
  fetchImpl: FetchLike = fetch,
): Promise<PrintifyProductVariantSummary[]> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new PrintifyValidationError("Printify API key is required.", 400);
  }

  const trimmedShopId = shopId.trim();
  if (!trimmedShopId) {
    throw new PrintifyValidationError("Printify shop is required.", 400);
  }

  const variants: PrintifyProductVariantSummary[] = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await fetchImpl(`https://api.printify.com/v1/shops/${trimmedShopId}/products.json?limit=50&page=${page}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
        "Content-Type": "application/json",
      },
    });

    let payload: PrintifyProductsResponse | PrintifyErrorResponse | null = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const providerMessage = getResponseMessage(payload);
      throw new PrintifyValidationError(
        providerMessage ?? "Printify products could not be loaded.",
        response.status === 401 || response.status === 403 ? 422 : response.status,
      );
    }

    const products = payload && "data" in payload && Array.isArray(payload.data) ? payload.data : [];

    for (const product of products) {
      const productId = toTrimmedString(product.id);
      if (!productId || !Array.isArray(product.variants)) {
        continue;
      }

      for (const variant of product.variants) {
        const variantId = toTrimmedString(variant.id);
        if (!variantId) {
          continue;
        }

        variants.push({
          productId,
          productTitle: toTrimmedString(product.title),
          productUpdatedAt: toDate(product.updated_at ?? product.update_at),
          blueprintId: toTrimmedString(product.blueprint_id),
          printProviderId: toTrimmedString(product.print_provider_id),
          variantId,
          variantTitle: toTrimmedString(variant.title),
          sku: toTrimmedString(variant.sku),
          cost: typeof variant.cost === "number" ? variant.cost : null,
        });
      }
    }

    const currentPage = payload && "current_page" in payload && typeof payload.current_page === "number"
      ? payload.current_page
      : page;
    const lastPage = payload && "last_page" in payload && typeof payload.last_page === "number"
      ? payload.last_page
      : currentPage;
    const nextPageUrl = payload && "next_page_url" in payload && typeof payload.next_page_url === "string"
      ? payload.next_page_url
      : null;

    hasNextPage = Boolean(nextPageUrl) || currentPage < lastPage;
    page = currentPage + 1;
  }

  return variants;
}
