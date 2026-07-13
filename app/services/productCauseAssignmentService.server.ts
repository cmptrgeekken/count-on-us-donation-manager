import { syncProductPublicDonationMetafields } from "./productPublicMetafieldService.server";

type AdminContext = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type ProductCauseAssignmentMetafield = {
  causeId: string;
  name?: string;
  metaobjectId: string | null;
  percentage: string;
};

export async function syncProductCauseAssignmentsMetafield(
  admin: AdminContext,
  shopId: string,
  productGid: string,
  assignments: ProductCauseAssignmentMetafield[],
  canWriteProducts?: boolean,
): Promise<void> {
  await syncProductPublicDonationMetafields({
    admin,
    shopId,
    productGid,
    causes: assignments.map((assignment) => ({
      causeId: assignment.causeId,
      name: assignment.name ?? assignment.causeId,
      metaobjectId: assignment.metaobjectId,
      percentage: assignment.percentage,
    })),
    canWriteProducts,
  });
}
