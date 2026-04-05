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
        code
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
        code
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
  return trimmed ? trimmed : null;
}

function buildCauseFields(input: CauseMetaobjectInput) {
  return [
    { key: "name", value: input.name.trim() },
    { key: "legal_name", value: normalizeOptional(input.legalName) ?? "" },
    { key: "is_501c3", value: input.is501c3 ? "true" : "false" },
    { key: "description", value: normalizeOptional(input.description) ?? "" },
    { key: "icon_url", value: normalizeOptional(input.iconUrl) ?? "" },
    { key: "donation_link", value: normalizeOptional(input.donationLink) ?? "" },
    { key: "website_url", value: normalizeOptional(input.websiteUrl) ?? "" },
    { key: "instagram_url", value: normalizeOptional(input.instagramUrl) ?? "" },
    { key: "status", value: input.status },
  ];
}

function getUserErrorMessage(userErrors: GraphqlUserError[]) {
  return userErrors[0]?.message ?? "Unknown Shopify metaobject error.";
}

export async function ensureCauseMetaobjectDefinition(admin: AdminContext): Promise<boolean> {
  const existingResponse = await admin.graphql(METAOBJECT_DEFINITION_BY_TYPE_QUERY, {
    variables: { type: CAUSE_METAOBJECT_TYPE },
  });
  const existingJson = await parseGraphqlResponse<{
    data?: { metaobjectDefinitionByType?: { id: string; type: string } | null };
  }>(existingResponse);

  if (existingJson.data?.metaobjectDefinitionByType?.id) {
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

export async function createCauseMetaobject(
  admin: AdminContext,
  input: CauseMetaobjectInput,
): Promise<{ id: string; handle: string | null }> {
  const response = await admin.graphql(METAOBJECT_CREATE_MUTATION, {
    variables: {
      metaobject: {
        type: CAUSE_METAOBJECT_TYPE,
        fields: buildCauseFields(input),
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
    throw new Error(getUserErrorMessage(payload?.userErrors ?? []));
  }
  if ((payload.userErrors ?? []).length > 0) {
    throw new Error(getUserErrorMessage(payload.userErrors));
  }

  return payload.metaobject;
}

export async function updateCauseMetaobject(
  admin: AdminContext,
  metaobjectId: string,
  input: CauseMetaobjectInput,
): Promise<void> {
  const response = await admin.graphql(METAOBJECT_UPDATE_MUTATION, {
    variables: {
      id: metaobjectId,
      metaobject: {
        fields: buildCauseFields(input),
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
    throw new Error(getUserErrorMessage(payload?.userErrors ?? []));
  }
  if ((payload.userErrors ?? []).length > 0) {
    throw new Error(getUserErrorMessage(payload.userErrors));
  }
}

export { CAUSE_METAOBJECT_TYPE };
