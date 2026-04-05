type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const METAFIELDS_SET_MUTATION = `#graphql
  mutation SetProductCauseAssignments($metafields: [MetafieldsSetInput!]!) {
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

type ProductCauseAssignmentMetafield = {
  causeId: string;
  metaobjectId: string | null;
  percentage: string;
};

type GraphqlUserError = {
  message: string;
};

async function parseGraphqlResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as T & { errors?: Array<{ message?: string }> };

  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message ?? "Unknown Shopify GraphQL error").join("; "));
  }

  return json;
}

export async function syncProductCauseAssignmentsMetafield(
  admin: AdminContext,
  productGid: string,
  assignments: ProductCauseAssignmentMetafield[],
): Promise<void> {
  const response = await admin.graphql(METAFIELDS_SET_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId: productGid,
          namespace: "donation_manager",
          key: "cause_assignments",
          type: "json",
          value: JSON.stringify(assignments),
        },
      ],
    },
  });

  const json = await parseGraphqlResponse<{
    data?: {
      metafieldsSet?: {
        metafields?: Array<{ id: string }> | null;
        userErrors: GraphqlUserError[];
      };
    };
  }>(response);

  const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(userErrors[0]?.message ?? "Unable to update product metafield.");
  }
}
