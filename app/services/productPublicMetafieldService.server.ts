import { ensureArtistMetaobjectDefinition } from "./artistMetaobjectService.server";
import { ensureCauseMetaobjectDefinition } from "./causeMetaobjectService.server";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type ProductPublicCauseAssignment = {
  causeId: string;
  name: string;
  metaobjectId: string | null;
  percentage: string;
};

export type ProductPublicArtistAssignment = {
  artistId: string;
  creditName: string;
  metaobjectId: string | null;
};

const METAFIELDS_SET_MUTATION = `#graphql
  mutation SetProductPublicDonationMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const PRODUCT_OWNER_QUERY = `#graphql
  query CountOnUsProductOwner($id: ID!) {
    node(id: $id) {
      __typename
      ... on Product {
        id
      }
    }
  }
`;

const METAOBJECT_OWNER_QUERY = `#graphql
  query CountOnUsMetaobjectOwner($id: ID!) {
    node(id: $id) {
      __typename
      ... on Metaobject {
        id
        type
      }
    }
  }
`;

const METAFIELD_DEFINITION_BY_IDENTIFIER_QUERY = `#graphql
  query ProductDonationMetafieldDefinition($namespace: String!, $key: String!, $ownerType: MetafieldOwnerType!) {
    metafieldDefinitions(first: 1, namespace: $namespace, key: $key, ownerType: $ownerType) {
      nodes {
        id
        namespace
        key
        type {
          name
        }
      }
    }
  }
`;

const METAOBJECT_DEFINITION_BY_TYPE_QUERY = `#graphql
  query CountOnUsMetaobjectDefinitionByType($type: String!) {
    metaobjectDefinitionByType(type: $type) {
      id
      type
    }
  }
`;

const METAFIELD_DEFINITION_CREATE_MUTATION = `#graphql
  mutation CreateProductDonationMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        namespace
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

type GraphqlUserError = {
  message: string;
  code?: string | null;
};

async function parseGraphqlResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as T & { errors?: Array<{ message?: string }> };
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message ?? "Unknown Shopify GraphQL error").join("; "));
  }
  return json;
}

function getUserErrorMessage(userErrors: GraphqlUserError[]) {
  return userErrors[0]?.message ?? "Unknown Shopify metafield error.";
}

async function ensureProductMetafieldDefinition(
  admin: AdminContext,
  definition: {
    name: string;
    namespace: string;
    key: string;
    description: string;
    type: string;
    validations?: Array<{ name: string; value: string }>;
  },
): Promise<boolean> {
  const existingResponse = await admin.graphql(METAFIELD_DEFINITION_BY_IDENTIFIER_QUERY, {
    variables: {
      namespace: definition.namespace,
      key: definition.key,
      ownerType: "PRODUCT",
    },
  });
  const existingJson = await parseGraphqlResponse<{
    data?: {
      metafieldDefinitions?: {
        nodes: Array<{ id: string }>;
      };
    };
  }>(existingResponse);
  if ((existingJson.data?.metafieldDefinitions?.nodes ?? []).length > 0) {
    return false;
  }

  const response = await admin.graphql(METAFIELD_DEFINITION_CREATE_MUTATION, {
    variables: {
      definition: {
        ...definition,
        ownerType: "PRODUCT",
      },
    },
  });
  const json = await parseGraphqlResponse<{
    data?: {
      metafieldDefinitionCreate?: {
        createdDefinition?: { id: string } | null;
        userErrors: GraphqlUserError[];
      };
    };
  }>(response);
  const userErrors = json.data?.metafieldDefinitionCreate?.userErrors ?? [];
  if (userErrors.length === 0) return true;
  if (userErrors.some((error) => error.code === "TAKEN")) return false;
  throw new Error(getUserErrorMessage(userErrors));
}

async function getMetaobjectDefinitionId(admin: AdminContext, type: "$app:artist" | "$app:cause") {
  const response = await admin.graphql(METAOBJECT_DEFINITION_BY_TYPE_QUERY, {
    variables: { type },
  });
  const json = await parseGraphqlResponse<{
    data?: {
      metaobjectDefinitionByType?: {
        id: string;
      } | null;
    };
  }>(response);
  return json.data?.metaobjectDefinitionByType?.id ?? null;
}

export async function ensureProductPublicMetafieldDefinitions(admin: AdminContext): Promise<number> {
  await ensureArtistMetaobjectDefinition(admin);
  await ensureCauseMetaobjectDefinition(admin);
  const [artistDefinitionId, causeDefinitionId] = await Promise.all([
    getMetaobjectDefinitionId(admin, "$app:artist"),
    getMetaobjectDefinitionId(admin, "$app:cause"),
  ]);

  const definitions = [
    artistDefinitionId
      ? {
          name: "Count On Us artists",
          namespace: "donation_manager",
          key: "artist_refs",
          description: "Artists credited on this product.",
          type: "list.metaobject_reference",
          validations: [{ name: "metaobject_definition_id", value: artistDefinitionId }],
        }
      : null,
    causeDefinitionId
      ? {
          name: "Count On Us causes",
          namespace: "donation_manager",
          key: "cause_refs",
          description: "Causes supported by this product.",
          type: "list.metaobject_reference",
          validations: [{ name: "metaobject_definition_id", value: causeDefinitionId }],
        }
      : null,
    {
      name: "Count On Us artist names",
      namespace: "donation_manager",
      key: "artist_names",
      description: "Artist credit names for storefront filtering compatibility.",
      type: "list.single_line_text_field",
    },
    {
      name: "Count On Us cause names",
      namespace: "donation_manager",
      key: "cause_names",
      description: "Cause names for storefront filtering compatibility.",
      type: "list.single_line_text_field",
    },
  ].filter((definition): definition is NonNullable<typeof definition> => Boolean(definition));

  let createdCount = 0;
  for (const definition of definitions) {
    if (await ensureProductMetafieldDefinition(admin, definition)) {
      createdCount += 1;
    }
  }
  return createdCount;
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function ensureProductOwnerExists(admin: AdminContext, productGid: string): Promise<void> {
  const response = await admin.graphql(PRODUCT_OWNER_QUERY, {
    variables: { id: productGid },
  });
  const json = await parseGraphqlResponse<{
    data?: {
      node?: {
        __typename: string;
        id?: string;
      } | null;
    };
  }>(response);

  if (json.data?.node?.__typename !== "Product") {
    throw new Error(
      `Shopify product ${productGid} was not found in this shop. Re-sync the catalog or remove stale local product data before retrying storefront sync.`,
    );
  }
}

async function filterMetaobjectRefsByType(
  admin: AdminContext,
  refs: string[],
  expectedType: "$app:artist" | "$app:cause",
): Promise<string[]> {
  const validRefs: string[] = [];
  for (const ref of refs) {
    const response = await admin.graphql(METAOBJECT_OWNER_QUERY, {
      variables: { id: ref },
    });
    const json = await parseGraphqlResponse<{
      data?: {
        node?: {
          __typename: string;
          id?: string;
          type?: string;
        } | null;
      };
    }>(response);
    if (json.data?.node?.__typename === "Metaobject" && json.data.node.type === expectedType) {
      validRefs.push(ref);
    }
  }
  return validRefs;
}

export async function syncProductPublicDonationMetafields({
  admin,
  productGid,
  causes,
  artists = [],
}: {
  admin: AdminContext;
  productGid: string;
  causes: ProductPublicCauseAssignment[];
  artists?: ProductPublicArtistAssignment[];
}): Promise<void> {
  await ensureProductOwnerExists(admin, productGid);
  await ensureProductPublicMetafieldDefinitions(admin);

  const [artistRefs, causeRefs] = await Promise.all([
    filterMetaobjectRefsByType(admin, uniqueValues(artists.map((artist) => artist.metaobjectId ?? "")), "$app:artist"),
    filterMetaobjectRefsByType(admin, uniqueValues(causes.map((cause) => cause.metaobjectId ?? "")), "$app:cause"),
  ]);
  const artistNames = uniqueValues(artists.map((artist) => artist.creditName));
  const causeNames = uniqueValues(causes.map((cause) => cause.name));
  const metafields = [
    {
      ownerId: productGid,
      namespace: "donation_manager",
      key: "cause_assignments",
      type: "json",
      value: JSON.stringify(
        causes.map((assignment) => ({
          causeId: assignment.causeId,
          metaobjectId: assignment.metaobjectId,
          percentage: assignment.percentage,
        })),
      ),
    },
    artistRefs.length > 0
      ? {
          ownerId: productGid,
          namespace: "donation_manager",
          key: "artist_refs",
          type: "list.metaobject_reference",
          value: JSON.stringify(artistRefs),
        }
      : null,
    causeRefs.length > 0
      ? {
          ownerId: productGid,
          namespace: "donation_manager",
          key: "cause_refs",
          type: "list.metaobject_reference",
          value: JSON.stringify(causeRefs),
        }
      : null,
    {
      ownerId: productGid,
      namespace: "donation_manager",
      key: "artist_names",
      type: "list.single_line_text_field",
      value: JSON.stringify(artistNames),
    },
    {
      ownerId: productGid,
      namespace: "donation_manager",
      key: "cause_names",
      type: "list.single_line_text_field",
      value: JSON.stringify(causeNames),
    },
  ].filter((metafield): metafield is NonNullable<typeof metafield> => Boolean(metafield));

  const response = await admin.graphql(METAFIELDS_SET_MUTATION, {
    variables: {
      metafields,
    },
  });

  const json = await parseGraphqlResponse<{
    data?: {
      metafieldsSet?: {
        userErrors: GraphqlUserError[];
      };
    };
  }>(response);
  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    const firstError = userErrors[0];
    const message = firstError?.message ?? "Unable to update product public donation metafields.";
    throw new Error(firstError?.code ? `${message} (${firstError.code})` : message);
  }
}
