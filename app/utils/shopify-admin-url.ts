export function shopifyNumericIdFromGid(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\/(\d+)$/);
  return match?.[1] ?? null;
}

export function shopifyAdminOrderUrl(shopDomain: string, shopifyOrderId: string | null | undefined): string | null {
  const orderId = shopifyNumericIdFromGid(shopifyOrderId);
  return orderId ? `https://${shopDomain}/admin/orders/${orderId}` : null;
}

export function shopifyAdminProductUrl(shopDomain: string, shopifyProductId: string | null | undefined): string | null {
  const productId = shopifyNumericIdFromGid(shopifyProductId);
  return productId ? `https://${shopDomain}/admin/products/${productId}` : null;
}

export function shopifyAdminVariantUrl({
  shopDomain,
  shopifyProductId,
  shopifyVariantId,
}: {
  shopDomain: string;
  shopifyProductId: string | null | undefined;
  shopifyVariantId: string | null | undefined;
}): string | null {
  const productId = shopifyNumericIdFromGid(shopifyProductId);
  const variantId = shopifyNumericIdFromGid(shopifyVariantId);
  return productId && variantId ? `https://${shopDomain}/admin/products/${productId}/variants/${variantId}` : null;
}
