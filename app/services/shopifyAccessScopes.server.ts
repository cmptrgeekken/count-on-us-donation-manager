import { prisma } from "../db.server";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const CURRENT_APP_INSTALLATION_SCOPES_QUERY = `#graphql
  query CountOnUsCurrentAppInstallationScopes {
    currentAppInstallation {
      accessScopes {
        handle
      }
    }
  }
`;

async function parseGraphqlResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as T & { errors?: Array<{ message?: string }> };
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message ?? "Unknown Shopify GraphQL error").join("; "));
  }
  return json;
}

export function hasRequiredShopifyScopes(
  grantedScopeString: string | null | undefined,
  requiredScopes: readonly string[],
): boolean {
  const grantedScopes = new Set(
    (grantedScopeString ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  return requiredScopes.every((scopeName) => grantedScopes.has(scopeName));
}

async function getGrantedScopeHandlesFromAdmin(admin: AdminContext): Promise<string[]> {
  const response = await admin.graphql(CURRENT_APP_INSTALLATION_SCOPES_QUERY);
  const json = await parseGraphqlResponse<{
    data?: {
      currentAppInstallation?: {
        accessScopes: Array<{ handle: string }>;
      } | null;
    };
  }>(response);

  return json.data?.currentAppInstallation?.accessScopes.map((scope) => scope.handle) ?? [];
}

export async function hasShopifyScopesForShop({
  admin,
  shopId,
  requiredScopes,
}: {
  admin?: AdminContext | null;
  shopId: string;
  requiredScopes: readonly string[];
}): Promise<boolean> {
  if (admin) {
    const scopeHandles = await getGrantedScopeHandlesFromAdmin(admin);
    return requiredScopes.every((scopeName) => scopeHandles.includes(scopeName));
  }

  const sessions = await prisma.session.findMany({
    where: { shop: shopId, scope: { not: null } },
    select: { scope: true },
  });
  if (sessions.length === 0) {
    return hasRequiredShopifyScopes(process.env.SCOPES, requiredScopes);
  }

  return sessions.some((session) => hasRequiredShopifyScopes(session.scope, requiredScopes));
}
