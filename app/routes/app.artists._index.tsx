import { jsonResponse } from "~/utils/json-response.server";
import type { LoaderFunctionArgs, SerializeFrom } from "@remix-run/node";
import { Link, useLoaderData, useRouteError } from "@remix-run/react";
import { EmptyTableRow, ResourceTableHeader } from "../components/admin-ui";
import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const artists = await prisma.artist.findMany({
    where: { shopId },
    orderBy: { displayName: "asc" },
    include: {
      _count: {
        select: { productAssignments: true, lineAllocations: true },
      },
      causeAssignments: {
        include: {
          cause: {
            select: { name: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return jsonResponse({
    artists: artists.map((artist) => ({
      id: artist.id,
      displayName: artist.displayName,
      creditName: artist.creditName,
      status: artist.status,
      paymentEnabled: artist.paymentEnabled,
      defaultPayoutRate: artist.defaultPayoutRate.toString(),
      productAssignmentCount: artist._count.productAssignments,
      historicalLineCount: artist._count.lineAllocations,
      causeRouting: artist.causeAssignments.map((assignment) => ({
        causeName: assignment.cause.name,
        percentage: assignment.percentage.toString(),
      })),
    })),
  });
};

function statusTone(status: string) {
  if (status === "active") return "success";
  if (status === "draft") return "warning";
  if (status === "revoked") return "critical";
  return "enabled";
}

function formatCauseRouting(
  causeRouting: Array<{ causeName: string; percentage: string }>,
) {
  if (causeRouting.length === 0) return "No Cause routing";
  return causeRouting
    .map((assignment) => `${assignment.causeName} ${Number(assignment.percentage).toFixed(0)}%`)
    .join(" · ");
}

export default function ArtistsPage() {
  const { artists } = useLoaderData<typeof loader>();

  return (
    <>
      <ui-title-bar title="Artists" />
      <s-page>
        <s-section padding="none">
          <s-table>
            <ResourceTableHeader
              title="Artist Library"
              description="Manage artist profiles, Cause routing, payout defaults, and product mappings."
              action={
              <Link
                to="/app/artists/new"
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
                New artist
              </Link>
              }
            />

            <s-table-header-row>
              <s-table-header listSlot="primary">Artist</s-table-header>
              <s-table-header listSlot="secondary">Cause routing</s-table-header>
              <s-table-header listSlot="secondary" format="numeric">Products</s-table-header>
              <s-table-header listSlot="secondary" format="numeric">Historical lines</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>

            <s-table-body>
              {artists.length === 0 ? (
                <EmptyTableRow colSpan={6}>
                  <div style={{ display: "grid", gap: "0.5rem" }}>
                    <span>No artists have been added yet.</span>
                    <Link to="/app/artists/new">Create artist</Link>
                  </div>
                </EmptyTableRow>
              ) : (
                artists.map((artist: SerializeFrom<typeof loader>["artists"][number]) => (
                  <s-table-row key={artist.id}>
                    <s-table-cell>
                      <div style={{ display: "grid", gap: "0.2rem" }}>
                        <strong>{artist.displayName}</strong>
                        <s-text color="subdued">
                          Credit: {artist.creditName} · {artist.paymentEnabled ? `${artist.defaultPayoutRate}% payout` : "donates share"}
                        </s-text>
                      </div>
                    </s-table-cell>
                    <s-table-cell>{formatCauseRouting(artist.causeRouting)}</s-table-cell>
                    <s-table-cell>{artist.productAssignmentCount}</s-table-cell>
                    <s-table-cell>{artist.historicalLineCount}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={statusTone(artist.status)}>
                        {artist.status}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <Link
                        to={`/app/artists/${artist.id}`}
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
                        Edit
                      </Link>
                    </s-table-cell>
                  </s-table-row>
                ))
              )}
            </s-table-body>
          </s-table>
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Artists] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Artists" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading Artists. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
