type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const MEDIA_IMAGE_URL_QUERY = `#graphql
  query CountOnUsMediaImageUrl($id: ID!) {
    node(id: $id) {
      __typename
      ... on MediaImage {
        id
        image {
          url
        }
      }
    }
  }
`;

export function isShopifyMediaImageGid(value: string): boolean {
  return value.trim().startsWith("gid://shopify/MediaImage/");
}

export function isPublicImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function parseGraphqlResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as T & { errors?: Array<{ message?: string }> };
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message ?? "Unknown Shopify GraphQL error").join("; "));
  }
  return json;
}

export async function resolveShopifyMediaImageUrl(admin: AdminContext, mediaImageGid: string): Promise<string> {
  const response = await admin.graphql(MEDIA_IMAGE_URL_QUERY, {
    variables: { id: mediaImageGid.trim() },
  });
  const json = await parseGraphqlResponse<{
    data?: {
      node?: {
        __typename?: string;
        image?: {
          url?: string | null;
        } | null;
      } | null;
    };
  }>(response);

  const url = json.data?.node?.__typename === "MediaImage" ? json.data.node.image?.url : null;
  if (!url || !isPublicImageUrl(url)) {
    throw new Error("Shopify file image is not available yet. Try saving again after Shopify finishes processing it.");
  }
  return url;
}

export async function normalizePublicImageReference({
  admin,
  value,
}: {
  admin?: AdminContext | null;
  value?: string | null;
}): Promise<string | null> {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (isPublicImageUrl(trimmed)) return trimmed;
  if (isShopifyMediaImageGid(trimmed)) {
    if (!admin) return trimmed;
    return resolveShopifyMediaImageUrl(admin, trimmed);
  }
  throw new Error("Icon must be a public image URL or a Shopify file image GID.");
}
