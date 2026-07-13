const CAUSE_METAOBJECT_TYPE = "$app:cause";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type CauseMetaobjectInput = {
  name: string;
  legalName?: string | null;
  is501c3: boolean;
  description?: string | null;
  iconUrl?: string | null;
  iconImageId?: string | null;
  donationLink?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  status: string;
};

const METAOBJECT_DEFINITION_BY_TYPE_QUERY = `#graphql
  query CauseMetaobjectDefinitionByType($type: String!) {
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
  mutation CreateCauseMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
        id
        type
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const METAOBJECT_DEFINITION_UPDATE_MUTATION = `#graphql
  mutation UpdateCauseMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const METAOBJECT_CREATE_MUTATION = `#graphql
  mutation CreateCauseMetaobject($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject {
        id
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const METAOBJECT_UPDATE_MUTATION = `#graphql
  mutation UpdateCauseMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const METAOBJECT_DELETE_MUTATION = `#graphql
  mutation DeleteCauseMetaobject($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
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
  return trimmed ? trimmed : null;
}

function normalizeOptionalUrl(value?: string | null) {
  const trimmed = normalizeOptional(value);
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function buildCauseFields(input: CauseMetaobjectInput, supportedFields: Set<string>) {
  const fields = [
    { key: "name", value: input.name.trim() },
    { key: "legal_name", value: normalizeOptional(input.legalName) ?? "" },
    { key: "is_501c3", value: input.is501c3 ? "true" : "false" },
    { key: "description", value: normalizeOptional(input.description) ?? "" },
    { key: "status", value: input.status },
  ];

  const iconUrl = normalizeOptionalUrl(input.iconUrl);
  const iconImageId = normalizeOptional(input.iconImageId);
  const donationLink = normalizeOptionalUrl(input.donationLink);
  const websiteUrl = normalizeOptionalUrl(input.websiteUrl);
  const instagramUrl = normalizeOptionalUrl(input.instagramUrl);
  if (supportedFields.has("icon_image") && iconImageId) fields.push({ key: "icon_image", value: iconImageId });
  if (!iconImageId && iconUrl) fields.push({ key: "icon_url", value: iconUrl });
  if (donationLink) fields.push({ key: "donation_link", value: donationLink });
  if (websiteUrl) fields.push({ key: "website_url", value: websiteUrl });
  if (instagramUrl) fields.push({ key: "instagram_url", value: instagramUrl });

  return fields;
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
  return field ? `${field}: ${firstError.message}` : firstError.message;
}

export async function ensureCauseMetaobjectDefinition(admin: AdminContext): Promise<boolean> {
  const existingResponse = await admin.graphql(METAOBJECT_DEFINITION_BY_TYPE_QUERY, {
    variables: { type: CAUSE_METAOBJECT_TYPE },
  });
  const existingJson = await parseGraphqlResponse<{
    data?: {
      metaobjectDefinitionByType?: {
        id: string;
        type: string;
        fieldDefinitions: Array<{ key: string }>;
      } | null;
    };
  }>(existingResponse);

  const existingDefinition = existingJson.data?.metaobjectDefinitionByType;
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
        name: "Cause",
        type: CAUSE_METAOBJECT_TYPE,
        displayNameKey: "name",
        access: {
          admin: "MERCHANT_READ_WRITE",
          storefront: "PUBLIC_READ",
        },
        fieldDefinitions: [
          { name: "Name", key: "name", type: "single_line_text_field", required: true },
          { name: "Legal name", key: "legal_name", type: "single_line_text_field" },
          { name: "Is 501(c)(3)", key: "is_501c3", type: "boolean" },
          { name: "Description", key: "description", type: "multi_line_text_field" },
          { name: "Icon URL", key: "icon_url", type: "url" },
          { name: "Icon image", key: "icon_image", type: "file_reference" },
          { name: "Donation link", key: "donation_link", type: "url" },
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

  const takenError = userErrors.some((error) => error.code === "TAKEN");
  if (takenError) return false;

  throw new Error(getUserErrorMessage(userErrors));
}

async function causeMetaobjectSupportedFields(admin: AdminContext): Promise<Set<string>> {
  const response = await admin.graphql(METAOBJECT_DEFINITION_BY_TYPE_QUERY, {
    variables: { type: CAUSE_METAOBJECT_TYPE },
  });
  const json = await parseGraphqlResponse<{
    data?: {
      metaobjectDefinitionByType?: {
        fieldDefinitions: Array<{ key: string }>;
      } | null;
    };
  }>(response);
  return new Set(json.data?.metaobjectDefinitionByType?.fieldDefinitions.map((fieldDefinition) => fieldDefinition.key) ?? []);
}

export async function createCauseMetaobject(
  admin: AdminContext,
  input: CauseMetaobjectInput,
): Promise<{ id: string; handle: string | null }> {
  await ensureCauseMetaobjectDefinition(admin);
  const supportedFields = await causeMetaobjectSupportedFields(admin);
  const fields = buildCauseFields(input, supportedFields);
  const response = await admin.graphql(METAOBJECT_CREATE_MUTATION, {
    variables: {
      metaobject: {
        type: CAUSE_METAOBJECT_TYPE,
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
  if (!payload?.metaobject) {
    throw new Error(getUserErrorMessage(payload?.userErrors ?? [], fields));
  }
  if ((payload.userErrors ?? []).length > 0) {
    throw new Error(getUserErrorMessage(payload.userErrors, fields));
  }

  return payload.metaobject;
}

export async function updateCauseMetaobject(
  admin: AdminContext,
  metaobjectId: string,
  input: CauseMetaobjectInput,
): Promise<void> {
  await ensureCauseMetaobjectDefinition(admin);
  const supportedFields = await causeMetaobjectSupportedFields(admin);
  const fields = buildCauseFields(input, supportedFields);
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
  if (!payload?.metaobject) {
    throw new Error(getUserErrorMessage(payload?.userErrors ?? [], fields));
  }
  if ((payload.userErrors ?? []).length > 0) {
    throw new Error(getUserErrorMessage(payload.userErrors, fields));
  }
}

export async function deleteCauseMetaobject(
  admin: AdminContext,
  metaobjectId: string,
): Promise<void> {
  const response = await admin.graphql(METAOBJECT_DELETE_MUTATION, {
    variables: { id: metaobjectId },
  });

  const json = await parseGraphqlResponse<{
    data?: {
      metaobjectDelete?: {
        deletedId?: string | null;
        userErrors: GraphqlUserError[];
      };
    };
  }>(response);

  const payload = json.data?.metaobjectDelete;
  if (!payload?.deletedId) {
    throw new Error(getUserErrorMessage(payload?.userErrors ?? []));
  }
  if ((payload.userErrors ?? []).length > 0) {
    throw new Error(getUserErrorMessage(payload.userErrors));
  }
}

export { CAUSE_METAOBJECT_TYPE };
