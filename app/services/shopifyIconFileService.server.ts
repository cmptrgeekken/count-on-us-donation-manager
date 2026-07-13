import { readPublicIcon } from "./publicIconStorage.server";
import { hasRequiredShopifyScopes, hasShopifyScopesForShop } from "./shopifyAccessScopes.server";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type PublicIconOwnerType = "artist" | "cause";

const STAGED_UPLOADS_CREATE_MUTATION = `#graphql
  mutation CountOnUsIconStagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FILE_CREATE_MUTATION = `#graphql
  mutation CountOnUsIconFileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type GraphqlUserError = {
  message: string;
};

const REQUIRED_FILE_SCOPES = ["read_files", "write_files"] as const;

async function parseGraphqlResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as T & { errors?: Array<{ message?: string }> };
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message ?? "Unknown Shopify GraphQL error").join("; "));
  }
  return json;
}

function getUserErrorMessage(userErrors: GraphqlUserError[]) {
  const firstError = userErrors[0];
  if (!firstError) return "Unknown Shopify file upload error.";
  return firstError.message;
}

function extensionForContentType(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function safeFilenamePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "icon";
}

export function hasRequiredShopifyFileScopes(scope: string | null | undefined): boolean {
  return hasRequiredShopifyScopes(scope, REQUIRED_FILE_SCOPES);
}

export async function canSyncShopifyFiles({
  admin,
  shopId,
}: {
  admin?: AdminContext | null;
  shopId: string;
}): Promise<boolean> {
  return hasShopifyScopesForShop({ admin, shopId, requiredScopes: REQUIRED_FILE_SCOPES });
}

export async function syncPublicIconToShopifyFile({
  admin,
  shopId,
  ownerType,
  ownerId,
  label,
  iconStorageKey,
  existingMediaImageId,
  syncedStorageKey,
  canSyncFiles,
}: {
  admin: AdminContext;
  shopId: string;
  ownerType: PublicIconOwnerType;
  ownerId: string;
  label: string;
  iconStorageKey: string | null;
  existingMediaImageId: string | null;
  syncedStorageKey: string | null;
  canSyncFiles?: boolean;
}): Promise<string | null> {
  if (!iconStorageKey) return null;
  if (existingMediaImageId && syncedStorageKey === iconStorageKey) {
    return existingMediaImageId;
  }
  if (!(canSyncFiles ?? (await canSyncShopifyFiles({ admin, shopId })))) {
    return null;
  }

  const icon = await readPublicIcon(iconStorageKey);
  const filename = [
    "count-on-us",
    safeFilenamePart(shopId),
    ownerType,
    safeFilenamePart(ownerId),
    `${safeFilenamePart(label)}.${extensionForContentType(icon.contentType)}`,
  ].join("-");

  const stagedResponse = await admin.graphql(STAGED_UPLOADS_CREATE_MUTATION, {
    variables: {
      input: [
        {
          filename,
          mimeType: icon.contentType,
          resource: "FILE",
          httpMethod: "POST",
        },
      ],
    },
  });
  const stagedJson = await parseGraphqlResponse<{
    data?: {
      stagedUploadsCreate?: {
        stagedTargets: Array<{
          url: string;
          resourceUrl: string;
          parameters: Array<{ name: string; value: string }>;
        }>;
        userErrors: GraphqlUserError[];
      };
    };
  }>(stagedResponse);
  const stagedPayload = stagedJson.data?.stagedUploadsCreate;
  const stagedErrors = stagedPayload?.userErrors ?? [];
  if (!stagedPayload || stagedErrors.length > 0) {
    throw new Error(getUserErrorMessage(stagedErrors));
  }
  const stagedTarget = stagedPayload.stagedTargets[0];
  if (!stagedTarget) throw new Error("Shopify did not return an upload target for the icon.");

  const uploadForm = new FormData();
  for (const parameter of stagedTarget.parameters) {
    uploadForm.append(parameter.name, parameter.value);
  }
  const iconBytes = icon.body.slice();
  uploadForm.append("file", new Blob([iconBytes.buffer], { type: icon.contentType }), filename);

  const uploadResponse = await fetch(stagedTarget.url, {
    method: "POST",
    body: uploadForm,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Shopify staged icon upload failed with HTTP ${uploadResponse.status}.`);
  }

  const fileResponse = await admin.graphql(FILE_CREATE_MUTATION, {
    variables: {
      files: [
        {
          contentType: "IMAGE",
          originalSource: stagedTarget.resourceUrl,
          filename,
          alt: `${label} icon`,
        },
      ],
    },
  });
  const fileJson = await parseGraphqlResponse<{
    data?: {
      fileCreate?: {
        files: Array<{ id: string; fileStatus: string }>;
        userErrors: GraphqlUserError[];
      };
    };
  }>(fileResponse);
  const filePayload = fileJson.data?.fileCreate;
  const fileErrors = filePayload?.userErrors ?? [];
  if (!filePayload || fileErrors.length > 0) {
    throw new Error(getUserErrorMessage(fileErrors));
  }
  const file = filePayload.files[0];
  if (!file?.id) throw new Error("Shopify did not create an image file for the icon.");
  return file.id;
}
