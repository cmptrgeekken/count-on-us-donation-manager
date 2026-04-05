import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRouteError } from "@remix-run/react";
import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const products = await prisma.product.findMany({
    where: { shopId },
    orderBy: { title: "asc" },
    include: {
      _count: {
        select: { causeAssignments: true, variants: true },
      },
    },
  });

  return Response.json({
    products: products.map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      variantCount: product._count.variants,
      causeAssignmentCount: product._count.causeAssignments,
    })),
  });
};

type ProductRow = {
  id: string;
  title: string;
  handle: string;
  status: string;
  variantCount: number;
  causeAssignmentCount: number;
};

export default function ProductsPage() {
  const { products } = useLoaderData<typeof loader>();

  return (
    <>
      <ui-title-bar title="Products" />
      <s-page>
        {products.length === 0 ? (
          <s-section heading="No synced products">
            <s-text>Catalog sync must complete before product-level Cause assignments can be configured.</s-text>
          </s-section>
        ) : (
          <s-section padding="none">
            <s-table>
              <div
                slot="filters"
                style={{
                  display: "grid",
                  gap: "0.2rem",
                  padding: "1rem",
                }}
              >
                <strong>Product Donations</strong>
                <s-text color="subdued">Assign Causes and allocation percentages at the product level.</s-text>
              </div>

              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header listSlot="secondary" format="numeric">Variants</s-table-header>
                <s-table-header listSlot="secondary" format="numeric">Cause assignments</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>

              <s-table-body>
                {products.map((product: ProductRow) => (
                  <s-table-row key={product.id}>
                    <s-table-cell>
                      <div style={{ display: "grid", gap: "0.2rem" }}>
                        <strong>{product.title}</strong>
                        <s-text color="subdued">/{product.handle}</s-text>
                      </div>
                    </s-table-cell>
                    <s-table-cell>{product.variantCount}</s-table-cell>
                    <s-table-cell>{product.causeAssignmentCount}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={product.status === "active" ? "success" : product.status === "draft" ? "warning" : "enabled"}>
                        {product.status === "active" ? "Active" : product.status === "draft" ? "Draft" : "Archived"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <a
                        href={`/app/products/${product.id}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0.55rem 0.9rem",
                          borderRadius: "999px",
                          border: "1px solid var(--p-color-border, #d2d5d8)",
                          color: "inherit",
                          textDecoration: "none",
                          fontWeight: 600,
                        }}
                      >
                        Manage donations
                      </a>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        )}
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Products] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Products" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading Products. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
