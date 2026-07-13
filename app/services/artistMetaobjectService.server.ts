const ARTIST_METAOBJECT_TYPE = "$app:artist";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type ArtistMetaobjectInput = {
  displayName: string;
  creditName: string;
  publicBio?: string | null;
  iconUrl?: string | null;
  iconImageId?: string | null;
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

const METAOBJECT_DEFINITION_UPDATE_MUTATION = `#graphql
  mutation UpdateArtistMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition {
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
  field?: string[] | null;
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

function normalizeOptionalUrl(value?: string | null) {
  const trimmed = normalizeOptional(value);
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : "";
  } catch {
    return "";
  }
}

function getSubmittedFieldKey(errorField: string[] | null | undefined, submittedFields?: Array<{ key: string; value: string }>) {
  if (!submittedFields || !errorField) return null;
  const fieldsIndex = errorField.findIndex((part) => part === "fields");
  const indexPart = fieldsIndex >= 0 ? errorField[fieldsIndex + 1] : undefined;
  const index = indexPart ? Number(indexPart) : Number.NaN;
  return Number.isInteger(index) ? submittedFields[index]?.key ?? null : null;
}

function getUserErrorMessage(userErrors: GraphqlUserError[], submittedFields?: Array<{ key: string; value: string }>) {
  const firstError = userErrors[0];
  if (!firstError) return "Unknown Shopify metaobject error.";
  const submittedFieldKey = getSubmittedFieldKey(firstError.field, submittedFields);
  const field = submittedFieldKey ?? firstError.field?.filter(Boolean).join(".");
  const message = firstError.code ? `${firstError.message} (${firstError.code})` : firstError.message;
  return field ? `${field}: ${message}` : message;
}

function buildArtistFields(input: ArtistMetaobjectInput, supportedFields: Set<string>) {
  const fields = [
    { key: "display_name", value: input.displayName.trim() },
    { key: "credit_name", value: input.creditName.trim() },
    { key: "public_bio", value: normalizeOptional(input.publicBio) },
    { key: "status", value: input.status },
  ];
  const iconUrl = normalizeOptionalUrl(input.iconUrl);
  const iconImageId = normalizeOptional(input.iconImageId);
  const websiteUrl = normalizeOptionalUrl(input.websiteUrl);
  const instagramUrl = normalizeOptionalUrl(input.instagramUrl);
  if (supportedFields.has("icon_image") && iconImageId) fields.push({ key: "icon_image", value: iconImageId });
  if (!iconImageId && supportedFields.has("icon_url") && iconUrl) fields.push({ key: "icon_url", value: iconUrl });
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
    if (!existingDefinition.fieldDefinitions.some((fieldDefinition) => fieldDefinition.key === "icon_image")) {
      const response = await admin.graphql(METAOBJECT_DEFINITION_UPDATE_MUTATION, {
        variables: {
          id: existingDefinition.id,
          definition: {
            fieldDefinitions: [
              {
                create: {
                  name: "Icon image",
                  key: "icon_image",
                  type: "file_reference",
                },
              },
            ],
          },
        },
      });
      const json = await parseGraphqlResponse<{
        data?: {
          metaobjectDefinitionUpdate?: {
            metaobjectDefinition?: { id: string } | null;
            userErrors: GraphqlUserError[];
          };
        };
      }>(response);
      const userErrors = json.data?.metaobjectDefinitionUpdate?.userErrors ?? [];
      if (userErrors.length > 0 && !userErrors.some((error) => error.code === "TAKEN")) {
        throw new Error(getUserErrorMessage(userErrors));
      }
      return true;
    }
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
          { name: "Icon image", key: "icon_image", type: "file_reference" },
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

async function artistMetaobjectSupportedFields(admin: AdminContext): Promise<Set<string>> {
  const definition = await getArtistMetaobjectDefinitionInfo(admin);
  return new Set(definition?.fieldDefinitions.map((fieldDefinition) => fieldDefinition.key) ?? []);
}

export async function createArtistMetaobject(
  admin: AdminContext,
  input: ArtistMetaobjectInput,
): Promise<{ id: string; handle: string | null }> {
  await ensureArtistMetaobjectDefinition(admin);
  const supportedFields = await artistMetaobjectSupportedFields(admin);
  const fields = buildArtistFields(input, supportedFields);
  const response = await admin.graphql(METAOBJECT_CREATE_MUTATION, {
    variables: {
      metaobject: {
        type: ARTIST_METAOBJECT_TYPE,
        fields,
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
    throw new Error(getUserErrorMessage(payload?.userErrors ?? [], fields));
  }
  return payload.metaobject;
}

export async function updateArtistMetaobject(
  admin: AdminContext,
  metaobjectId: string,
  input: ArtistMetaobjectInput,
): Promise<void> {
  await ensureArtistMetaobjectDefinition(admin);
  const supportedFields = await artistMetaobjectSupportedFields(admin);
  const fields = buildArtistFields(input, supportedFields);
  const response = await admin.graphql(METAOBJECT_UPDATE_MUTATION, {
    variables: {
      id: metaobjectId,
      metaobject: {
        fields,
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
    throw new Error(getUserErrorMessage(payload?.userErrors ?? [], fields));
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
