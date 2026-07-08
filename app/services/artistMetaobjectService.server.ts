const ARTIST_METAOBJECT_TYPE = "$app:artist";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type ArtistMetaobjectInput = {
  displayName: string;
  creditName: string;
  publicBio?: string | null;
  iconUrl?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  status: string;
};

const METAOBJECT_DEFINITION_BY_TYPE_QUERY = `#graphql
  query ArtistMetaobjectDefinitionByType($type: String!) {
    metaobjectDefinitionByType(type: $type) {
      id
      type
      fieldDefinitions {
        key
      }
    }
  }
`;

const METAOBJECT_DEFINITION_CREATE_MUTATION = `#graphql
  mutation CreateArtistMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
        id
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const METAOBJECT_CREATE_MUTATION = `#graphql
  mutation CreateArtistMetaobject($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject {
        id
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const METAOBJECT_UPDATE_MUTATION = `#graphql
  mutation UpdateArtistMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject {
        id
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

function normalizeOptional(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
}

function getUserErrorMessage(userErrors: GraphqlUserError[]) {
  return userErrors[0]?.message ?? "Unknown Shopify metaobject error.";
}

function buildArtistFields(input: ArtistMetaobjectInput, supportsIconUrl: boolean) {
  const fields = [
    { key: "display_name", value: input.displayName.trim() },
    { key: "credit_name", value: input.creditName.trim() },
    { key: "public_bio", value: normalizeOptional(input.publicBio) },
    { key: "status", value: input.status },
  ];
  const iconUrl = normalizeOptional(input.iconUrl);
  const websiteUrl = normalizeOptional(input.websiteUrl);
  const instagramUrl = normalizeOptional(input.instagramUrl);
  if (supportsIconUrl && iconUrl) fields.push({ key: "icon_url", value: iconUrl });
  if (websiteUrl) fields.push({ key: "website_url", value: websiteUrl });
  if (instagramUrl) fields.push({ key: "instagram_url", value: instagramUrl });
  return fields;
}

async function getArtistMetaobjectDefinitionInfo(admin: AdminContext) {
  const response = await admin.graphql(METAOBJECT_DEFINITION_BY_TYPE_QUERY, {
    variables: { type: ARTIST_METAOBJECT_TYPE },
  });
  const json = await parseGraphqlResponse<{
    data?: {
      metaobjectDefinitionByType?: {
        id: string;
        type: string;
        fieldDefinitions: Array<{ key: string }>;
      } | null;
    };
  }>(response);
  return json.data?.metaobjectDefinitionByType ?? null;
}

export async function ensureArtistMetaobjectDefinition(admin: AdminContext): Promise<boolean> {
  const existingDefinition = await getArtistMetaobjectDefinitionInfo(admin);

  if (existingDefinition?.id) {
    return false;
  }

  const response = await admin.graphql(METAOBJECT_DEFINITION_CREATE_MUTATION, {
    variables: {
      definition: {
        name: "Artist",
        type: ARTIST_METAOBJECT_TYPE,
        displayNameKey: "credit_name",
        access: {
          admin: "MERCHANT_READ_WRITE",
          storefront: "PUBLIC_READ",
        },
        fieldDefinitions: [
          { name: "Display name", key: "display_name", type: "single_line_text_field", required: true },
          { name: "Credit name", key: "credit_name", type: "single_line_text_field", required: true },
          { name: "Public bio", key: "public_bio", type: "multi_line_text_field" },
          { name: "Icon URL", key: "icon_url", type: "url" },
          { name: "Website URL", key: "website_url", type: "url" },
          { name: "Instagram URL", key: "instagram_url", type: "url" },
          { name: "Status", key: "status", type: "single_line_text_field" },
        ],
      },
    },
  });

  const json = await parseGraphqlResponse<{
    data?: {
      metaobjectDefinitionCreate?: {
        metaobjectDefinition?: { id: string; type: string } | null;
        userErrors: GraphqlUserError[];
      };
    };
  }>(response);
  const userErrors = json.data?.metaobjectDefinitionCreate?.userErrors ?? [];
  if (userErrors.length === 0) return true;
  if (userErrors.some((error) => error.code === "TAKEN")) return false;
  throw new Error(getUserErrorMessage(userErrors));
}

async function artistMetaobjectSupportsIconUrl(admin: AdminContext): Promise<boolean> {
  const definition = await getArtistMetaobjectDefinitionInfo(admin);
  return Boolean(definition?.fieldDefinitions.some((fieldDefinition) => fieldDefinition.key === "icon_url"));
}

export async function createArtistMetaobject(
  admin: AdminContext,
  input: ArtistMetaobjectInput,
): Promise<{ id: string; handle: string | null }> {
  await ensureArtistMetaobjectDefinition(admin);
  const supportsIconUrl = await artistMetaobjectSupportsIconUrl(admin);
  const response = await admin.graphql(METAOBJECT_CREATE_MUTATION, {
    variables: {
      metaobject: {
        type: ARTIST_METAOBJECT_TYPE,
        fields: buildArtistFields(input, supportsIconUrl),
      },
    },
  });
  const json = await parseGraphqlResponse<{
    data?: {
      metaobjectCreate?: {
        metaobject?: { id: string; handle: string | null } | null;
        userErrors: GraphqlUserError[];
      };
    };
  }>(response);
  const payload = json.data?.metaobjectCreate;
  if (!payload?.metaobject || payload.userErrors.length > 0) {
    throw new Error(getUserErrorMessage(payload?.userErrors ?? []));
  }
  return payload.metaobject;
}

export async function updateArtistMetaobject(
  admin: AdminContext,
  metaobjectId: string,
  input: ArtistMetaobjectInput,
): Promise<void> {
  const supportsIconUrl = await artistMetaobjectSupportsIconUrl(admin);
  const response = await admin.graphql(METAOBJECT_UPDATE_MUTATION, {
    variables: {
      id: metaobjectId,
      metaobject: {
        fields: buildArtistFields(input, supportsIconUrl),
      },
    },
  });
  const json = await parseGraphqlResponse<{
    data?: {
      metaobjectUpdate?: {
        metaobject?: { id: string } | null;
        userErrors: GraphqlUserError[];
      };
    };
  }>(response);
  const payload = json.data?.metaobjectUpdate;
  if (!payload?.metaobject || payload.userErrors.length > 0) {
    throw new Error(getUserErrorMessage(payload?.userErrors ?? []));
  }
}

export async function upsertArtistMetaobject({
  admin,
  existingMetaobjectId,
  input,
}: {
  admin: AdminContext;
  existingMetaobjectId: string | null;
  input: ArtistMetaobjectInput;
}): Promise<string> {
  await ensureArtistMetaobjectDefinition(admin);
  if (existingMetaobjectId) {
    await updateArtistMetaobject(admin, existingMetaobjectId, input);
    return existingMetaobjectId;
  }
  const metaobject = await createArtistMetaobject(admin, input);
  return metaobject.id;
}
