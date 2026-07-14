import { z } from "zod";

const resourceWebhookSchema = z
  .object({
    admin_graphql_api_id: z.string().min(1).optional(),
    id: z.union([z.string().min(1), z.number()]).optional(),
  })
  .passthrough();

export function parseResourceGid(
  payload: unknown,
  resource: "Product" | "Collection",
): string | null {
  const parsed = resourceWebhookSchema.safeParse(payload);
  if (!parsed.success) return null;
  if (parsed.data.admin_graphql_api_id) return parsed.data.admin_graphql_api_id;
  if (parsed.data.id !== undefined)
    return `gid://shopify/${resource}/${parsed.data.id}`;
  return null;
}

export type CatalogWebhookOperation =
  | { kind: "product-sync"; productGid: string }
  | { kind: "product-delete"; productGid: string }
  | { kind: "collection-sync"; collectionGid: string }
  | { kind: "collection-delete"; collectionGid: string };

export function parseCatalogWebhookOperation(
  topic: string,
  payload: unknown,
): CatalogWebhookOperation | null | undefined {
  if (topic === "products/create" || topic === "products/update") {
    const productGid = parseResourceGid(payload, "Product");
    return productGid ? { kind: "product-sync", productGid } : null;
  }
  if (topic === "products/delete") {
    const productGid = parseResourceGid(payload, "Product");
    return productGid ? { kind: "product-delete", productGid } : null;
  }
  if (topic === "collections/create" || topic === "collections/update") {
    const collectionGid = parseResourceGid(payload, "Collection");
    return collectionGid ? { kind: "collection-sync", collectionGid } : null;
  }
  if (topic === "collections/delete") {
    const collectionGid = parseResourceGid(payload, "Collection");
    return collectionGid ? { kind: "collection-delete", collectionGid } : null;
  }
  return undefined;
}
