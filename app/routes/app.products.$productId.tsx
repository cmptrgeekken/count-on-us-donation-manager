import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { z } from "zod";
import { HelpText } from "../components/HelpText";
import { prisma } from "../db.server";
import { syncProductCauseAssignmentsMetafield } from "../services/productCauseAssignmentService.server";
import { authenticateAdminRequest, isPlaywrightBypassRequest } from "../utils/admin-auth.server";

const assignmentsSchema = z.object({
  assignments: z.array(
    z.object({
      causeId: z.string().min(1),
      percentage: z.string().min(1),
    }),
  ),
});

const artistAssignmentsSchema = z.object({
  assignments: z.array(
    z.object({
      artistId: z.string().min(1),
      collaborationShare: z.string().min(1),
      creditOverride: z.string().optional(),
      payoutEnabledOverride: z.enum(["inherit", "true", "false"]),
      payoutRateOverride: z.string().optional(),
    }),
  ),
});

type AssignmentRow = {
  causeId: string;
  percentage: string;
};

type ArtistAssignmentRow = {
  artistId: string;
  collaborationShare: string;
  creditOverride: string;
  payoutEnabledOverride: "inherit" | "true" | "false";
  payoutRateOverride: string;
};

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "0.75rem",
  borderRadius: "0.75rem",
  border: "1px solid var(--p-color-border, #d2d5d8)",
  background: "var(--p-color-bg-surface, #fff)",
  color: "var(--p-color-text, #303030)",
  font: "inherit",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const productId = params.productId ?? "";

  const product = await prisma.product.findFirst({
    where: { id: productId, shopId },
    select: {
      id: true,
      shopifyId: true,
      title: true,
      handle: true,
      status: true,
      causeAssignments: {
        where: { shopId },
        orderBy: { createdAt: "asc" },
        select: {
          causeId: true,
          percentage: true,
          cause: {
            select: {
              id: true,
              name: true,
              shopifyMetaobjectId: true,
            },
          },
        },
      },
      artistAssignments: {
        where: { shopId, status: "active" },
        orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
        select: {
          artistId: true,
          collaborationShare: true,
          creditOverride: true,
          payoutEnabledOverride: true,
          payoutRateOverride: true,
          artist: {
            select: {
              id: true,
              displayName: true,
              creditName: true,
              paymentEnabled: true,
              defaultPayoutRate: true,
              causeAssignments: {
                select: {
                  causeId: true,
                  percentage: true,
                  cause: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!product) {
    throw new Response("Not found", { status: 404 });
  }

  const causes = await prisma.cause.findMany({
    where: { shopId, status: "active" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      shopifyMetaobjectId: true,
      is501c3: true,
    },
  });

  const artists = await prisma.artist.findMany({
    where: { shopId, status: "active" },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      creditName: true,
      paymentEnabled: true,
      defaultPayoutRate: true,
      causeAssignments: {
        select: {
          causeId: true,
          percentage: true,
          cause: {
            select: { name: true },
          },
        },
      },
    },
  });

  return Response.json({
    product: {
      id: product.id,
      shopifyId: product.shopifyId,
      title: product.title,
      handle: product.handle,
      status: product.status,
    },
    causes,
    assignments: product.causeAssignments.map((assignment) => ({
      causeId: assignment.causeId,
      percentage: assignment.percentage.toString(),
      causeName: assignment.cause.name,
      metaobjectId: assignment.cause.shopifyMetaobjectId,
    })),
    artists: artists.map((artist) => ({
      id: artist.id,
      displayName: artist.displayName,
      creditName: artist.creditName,
      paymentEnabled: artist.paymentEnabled,
      defaultPayoutRate: artist.defaultPayoutRate.toString(),
      causeAssignments: artist.causeAssignments.map((assignment) => ({
        causeId: assignment.causeId,
        causeName: assignment.cause.name,
        percentage: assignment.percentage.toString(),
      })),
    })),
    artistAssignments: product.artistAssignments.map((assignment) => ({
      artistId: assignment.artistId,
      collaborationShare: assignment.collaborationShare.toString(),
      creditOverride: assignment.creditOverride ?? "",
      payoutEnabledOverride:
        assignment.payoutEnabledOverride === null
          ? "inherit"
          : assignment.payoutEnabledOverride
            ? "true"
            : "false",
      payoutRateOverride: assignment.payoutRateOverride?.toString() ?? "",
    })),
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const productId = params.productId ?? "";
  const isPlaywrightBypass = isPlaywrightBypassRequest(request);

  if (!admin && !isPlaywrightBypass) {
    return Response.json({ ok: false, message: "Shopify admin context is required." }, { status: 500 });
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, shopId },
    select: { id: true, shopifyId: true, title: true },
  });

  if (!product) {
    return Response.json({ ok: false, message: "Product not found." }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent !== "save-assignments" && intent !== "save-artist-assignments") {
    return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
  }

  if (intent === "save-artist-assignments") {
    const rawAssignments = formData.get("artistAssignments")?.toString() ?? "[]";
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawAssignments);
    } catch {
      return Response.json({ ok: false, message: "Invalid artist assignments." }, { status: 400 });
    }

    const parsed = artistAssignmentsSchema.safeParse({ assignments: parsedJson });

    if (!parsed.success) {
      return Response.json(
        { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid artist assignments." },
        { status: 400 },
      );
    }

    const artistAssignments = parsed.data.assignments;
    const artistIds = artistAssignments.map((assignment) => assignment.artistId);

    if (new Set(artistIds).size !== artistIds.length) {
      return Response.json({ ok: false, message: "Each Artist can only be assigned once per product." }, { status: 400 });
    }

    const total = artistAssignments.reduce((sum, assignment) => sum + Number(assignment.collaborationShare), 0);
    if (artistAssignments.length > 0 && total !== 100) {
      return Response.json({ ok: false, message: "Artist collaboration shares must total 100%." }, { status: 400 });
    }

    if (artistAssignments.some((assignment) => Number.isNaN(Number(assignment.collaborationShare)) || Number(assignment.collaborationShare) <= 0)) {
      return Response.json({ ok: false, message: "Each Artist collaboration share must be greater than 0." }, { status: 400 });
    }

    if (artistAssignments.some((assignment) => assignment.payoutRateOverride && (Number.isNaN(Number(assignment.payoutRateOverride)) || Number(assignment.payoutRateOverride) < 0 || Number(assignment.payoutRateOverride) > 100))) {
      return Response.json({ ok: false, message: "Artist payout overrides must be between 0 and 100%." }, { status: 400 });
    }

    const artists = artistIds.length
      ? await prisma.artist.findMany({
          where: { id: { in: artistIds }, shopId, status: "active" },
          include: {
            causeAssignments: {
              include: {
                cause: {
                  select: { id: true, shopifyMetaobjectId: true },
                },
              },
            },
          },
        })
      : [];

    if (artists.length !== artistIds.length) {
      return Response.json({ ok: false, message: "One or more selected Artists are unavailable." }, { status: 404 });
    }

    for (const artist of artists) {
      const causeTotal = artist.causeAssignments.reduce((sum, assignment) => sum + Number(assignment.percentage), 0);
      if (causeTotal !== 100) {
        return Response.json({ ok: false, message: `${artist.displayName} must have Cause percentages totaling 100%.` }, { status: 400 });
      }
    }

    const artistMap = new Map(artists.map((artist) => [artist.id, artist]));
    const derivedCauseMap = new Map<string, { causeId: string; metaobjectId: string | null; percentage: number }>();

    for (const assignment of artistAssignments) {
      const artist = artistMap.get(assignment.artistId);
      if (!artist) continue;
      const collaborationShare = Number(assignment.collaborationShare);
      for (const causeAssignment of artist.causeAssignments) {
        const existing = derivedCauseMap.get(causeAssignment.causeId) ?? {
          causeId: causeAssignment.causeId,
          metaobjectId: causeAssignment.cause.shopifyMetaobjectId ?? null,
          percentage: 0,
        };
        existing.percentage += collaborationShare * Number(causeAssignment.percentage) / 100;
        derivedCauseMap.set(causeAssignment.causeId, existing);
      }
    }

    const derivedAssignments = Array.from(derivedCauseMap.values());

    try {
      await prisma.$transaction(async (tx) => {
        await tx.productArtistAssignment.deleteMany({
          where: { shopId, productId: product.id },
        });
        await tx.productCauseAssignment.deleteMany({
          where: {
            shopId,
            OR: [
              { productId: product.id },
              { shopifyProductId: product.shopifyId },
            ],
          },
        });

        if (artistAssignments.length > 0) {
          await tx.productArtistAssignment.createMany({
            data: artistAssignments.map((assignment, index) => ({
              shopId,
              productId: product.id,
              shopifyProductId: product.shopifyId,
              artistId: assignment.artistId,
              attributionOrder: index,
              creditOverride: assignment.creditOverride?.trim() || null,
              collaborationShare: Number(assignment.collaborationShare),
              payoutEnabledOverride:
                assignment.payoutEnabledOverride === "inherit"
                  ? null
                  : assignment.payoutEnabledOverride === "true",
              payoutRateOverride: assignment.payoutRateOverride?.trim()
                ? Number(assignment.payoutRateOverride)
                : null,
              status: "active",
            })),
          });
        }

        if (derivedAssignments.length > 0) {
          await tx.productCauseAssignment.createMany({
            data: derivedAssignments.map((assignment) => ({
              shopId,
              shopifyProductId: product.shopifyId,
              productId: product.id,
              causeId: assignment.causeId,
              percentage: assignment.percentage,
            })),
          });
        }

        await tx.auditLog.create({
          data: {
            shopId,
            entity: "Product",
            entityId: product.id,
            action: "PRODUCT_ARTIST_ASSIGNMENTS_SAVED",
            actor: "merchant",
            payload: {
              shopifyProductId: product.shopifyId,
              artistAssignments,
              derivedCauseAssignments: derivedAssignments,
            },
          },
        });
      });

      if (admin) {
        await syncProductCauseAssignmentsMetafield(
          admin,
          product.shopifyId,
          derivedAssignments.map((assignment) => ({
            causeId: assignment.causeId,
            metaobjectId: assignment.metaobjectId,
            percentage: assignment.percentage.toFixed(2),
          })),
        );
      }

      return Response.json({ ok: true, message: "Product Artist assignments saved." });
    } catch (error) {
      console.error("[ProductDonations] Failed to save artist assignments:", error);
      return Response.json(
        { ok: false, message: error instanceof Error ? error.message : "Unable to save Artist assignments." },
        { status: 502 },
      );
    }
  }

  const activeArtistAssignmentCount = await prisma.productArtistAssignment.count({
    where: { shopId, productId: product.id, status: "active" },
  });

  if (activeArtistAssignmentCount > 0) {
    return Response.json(
      { ok: false, message: "This product is routed through Artist assignments. Clear Artist assignments before editing direct Cause assignments." },
      { status: 400 },
    );
  }

  const rawAssignments = formData.get("assignments")?.toString() ?? "[]";
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawAssignments);
  } catch {
    return Response.json({ ok: false, message: "Invalid assignments." }, { status: 400 });
  }
  const parsed = assignmentsSchema.safeParse({ assignments: parsedJson });

  if (!parsed.success) {
    return Response.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid assignments." },
      { status: 400 },
    );
  }

  const assignments = parsed.data.assignments;
  const causeIds = assignments.map((assignment) => assignment.causeId);

  if (new Set(causeIds).size !== causeIds.length) {
    return Response.json({ ok: false, message: "Each Cause can only be assigned once per product." }, { status: 400 });
  }

  const total = assignments.reduce((sum, assignment) => sum + Number(assignment.percentage), 0);
  if (Number.isNaN(total) || total > 100) {
    return Response.json({ ok: false, message: "Cause percentages must total 100% or less." }, { status: 400 });
  }

  if (assignments.some((assignment) => Number.isNaN(Number(assignment.percentage)) || Number(assignment.percentage) <= 0)) {
    return Response.json({ ok: false, message: "Each Cause percentage must be greater than 0." }, { status: 400 });
  }

  const causes = causeIds.length
    ? await prisma.cause.findMany({
        where: { id: { in: causeIds }, shopId, status: "active" },
        select: { id: true, name: true, shopifyMetaobjectId: true },
      })
    : [];

  if (causes.length !== causeIds.length) {
    return Response.json({ ok: false, message: "One or more selected Causes are unavailable." }, { status: 404 });
  }

  const causeMap = new Map(causes.map((cause) => [cause.id, cause]));

  try {
    await prisma.$transaction(async (tx) => {
      await tx.productCauseAssignment.deleteMany({
        where: {
          shopId,
          OR: [
            { productId: product.id },
            { shopifyProductId: product.shopifyId },
          ],
        },
      });

      if (assignments.length > 0) {
        await tx.productCauseAssignment.createMany({
          data: assignments.map((assignment) => ({
            shopId,
            shopifyProductId: product.shopifyId,
            productId: product.id,
            causeId: assignment.causeId,
            percentage: Number(assignment.percentage),
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "Product",
          entityId: product.id,
          action: "PRODUCT_CAUSE_ASSIGNMENTS_SAVED",
          actor: "merchant",
          payload: {
            shopifyProductId: product.shopifyId,
            assignments: assignments.map((assignment) => ({
              causeId: assignment.causeId,
              percentage: Number(assignment.percentage).toFixed(2),
            })),
          },
        },
      });
    });

    try {
      if (admin) {
        await syncProductCauseAssignmentsMetafield(
          admin,
          product.shopifyId,
          assignments.map((assignment) => ({
            causeId: assignment.causeId,
            metaobjectId: causeMap.get(assignment.causeId)?.shopifyMetaobjectId ?? null,
            percentage: Number(assignment.percentage).toFixed(2),
          })),
        );

        await prisma.auditLog.create({
          data: {
            shopId,
            entity: "Product",
            entityId: product.id,
            action: "PRODUCT_CAUSE_ASSIGNMENTS_SHOPIFY_SYNCED",
            actor: "merchant",
            payload: {
              shopifyProductId: product.shopifyId,
            },
          },
        });
      }

      return Response.json({ ok: true, message: "Product Cause assignments saved." });
    } catch (error) {
      await prisma.auditLog.create({
        data: {
          shopId,
          entity: "Product",
          entityId: product.id,
          action: "PRODUCT_CAUSE_ASSIGNMENTS_SHOPIFY_SYNC_FAILED",
          actor: "merchant",
          payload: {
            message: error instanceof Error ? error.message : "Unknown Shopify sync failure",
          },
        },
      });

      return Response.json(
        { ok: false, message: "Assignments saved locally, but Shopify sync failed. Save again to retry." },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error("[ProductDonations] Failed to save assignments:", error);
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : "Unable to save Cause assignments." },
      { status: 502 },
    );
  }
};

export default function ProductDetailPage() {
  const { product, causes, assignments, artists, artistAssignments } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const [rows, setRows] = useState<AssignmentRow[]>(() =>
    assignments.map((assignment: (typeof assignments)[number]) => ({
      causeId: assignment.causeId,
      percentage: assignment.percentage,
    })),
  );
  const [artistRows, setArtistRows] = useState<ArtistAssignmentRow[]>(() =>
    artistAssignments.map((assignment: (typeof artistAssignments)[number]) => ({
      artistId: assignment.artistId,
      collaborationShare: assignment.collaborationShare,
      creditOverride: assignment.creditOverride,
      payoutEnabledOverride: assignment.payoutEnabledOverride as ArtistAssignmentRow["payoutEnabledOverride"],
      payoutRateOverride: assignment.payoutRateOverride,
    })),
  );

  const handledRef = useRef<string>("");
  const selectedCauseIds = useMemo(() => new Set(rows.map((row) => row.causeId)), [rows]);
  const availableToAdd = causes.filter((cause: (typeof causes)[number]) => !selectedCauseIds.has(cause.id));
  const selectedArtistIds = useMemo(() => new Set(artistRows.map((row) => row.artistId)), [artistRows]);
  const availableArtistsToAdd = artists.filter((artist: (typeof artists)[number]) => !selectedArtistIds.has(artist.id));
  const total = rows.reduce((sum, row) => sum + (Number(row.percentage) || 0), 0);
  const artistTotal = artistRows.reduce((sum, row) => sum + (Number(row.collaborationShare) || 0), 0);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data?.ok) return;
    const nextSignature = JSON.stringify(rows);
    handledRef.current = nextSignature;
  }, [fetcher.data, rows]);

  function addCause() {
    if (rows.length >= causes.length) return;
    const nextCause = availableToAdd[0];
    setRows((current) => [...current, { causeId: nextCause?.id ?? "", percentage: "" }]);
  }

  function addArtist() {
    if (artistRows.length >= artists.length) return;
    const nextArtist = availableArtistsToAdd[0];
    setArtistRows((current) => [
      ...current,
      {
        artistId: nextArtist?.id ?? "",
        collaborationShare: current.length === 0 ? "100" : "",
        creditOverride: "",
        payoutEnabledOverride: "inherit",
        payoutRateOverride: "",
      },
    ]);
  }

  function updateRow(index: number, patch: Partial<AssignmentRow>) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  function updateArtistRow(index: number, patch: Partial<ArtistAssignmentRow>) {
    setArtistRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  }

  function removeArtistRow(index: number) {
    setArtistRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  function saveAssignments() {
    const formData = new FormData();
    formData.append("intent", "save-assignments");
    formData.append("assignments", JSON.stringify(rows));
    fetcher.submit(formData, { method: "post" });
  }

  function saveArtistAssignments() {
    const formData = new FormData();
    formData.append("intent", "save-artist-assignments");
    formData.append("artistAssignments", JSON.stringify(artistRows));
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <>
      <ui-title-bar title={product.title} />
      <s-page>
        <div
          aria-live="polite"
          aria-atomic="true"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
          }}
        >
          {fetcher.data?.message ?? ""}
        </div>

        {fetcher.data && !fetcher.data.ok && (
          <s-banner tone="critical">
            <s-text>{fetcher.data.message}</s-text>
          </s-banner>
        )}

        <s-section heading={product.title}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <s-text color="subdued">/{product.handle}</s-text>
            <s-text color="subdued">Status: {product.status}</s-text>
          </div>
        </s-section>

        <s-section heading="Artist collaboration assignments">
          <div style={{ display: "grid", gap: "1rem" }}>
            <s-text>
              Assign one or more active Artists to route this product through artist-selected Causes and optional artist payout tracking.
            </s-text>
            <HelpText>Artist collaboration shares must total exactly 100%. Saving Artist assignments replaces direct Cause assignments with a derived Cause rollup for storefront display.</HelpText>

            {artistRows.length === 0 ? (
              <s-banner tone="info">
                <s-text>No Artists are assigned. This product uses direct Cause assignments below.</s-text>
              </s-banner>
            ) : (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {artistRows.map((row, index) => {
                  const selectableArtists = artists.filter(
                    (artist: (typeof artists)[number]) =>
                      artist.id === row.artistId || !artistRows.some((entry, entryIndex) => entry.artistId === artist.id && entryIndex !== index),
                  );
                  const selectedArtist = artists.find((artist: (typeof artists)[number]) => artist.id === row.artistId);

                  return (
                    <div
                      key={`${row.artistId}-${index}`}
                      style={{
                        display: "grid",
                        gap: "0.75rem",
                        gridTemplateColumns: "minmax(220px, 1.5fr) minmax(140px, 0.75fr) minmax(180px, 1fr) minmax(160px, 1fr) auto",
                        alignItems: "end",
                      }}
                    >
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`artist-${index}`}>Artist</label>
                        <select
                          id={`artist-${index}`}
                          value={row.artistId}
                          onChange={(event) => updateArtistRow(index, { artistId: event.currentTarget.value })}
                          style={fieldStyle}
                        >
                          {!row.artistId ? <option value="">Select Artist</option> : null}
                          {selectableArtists.map((artist: (typeof artists)[number]) => (
                            <option key={artist.id} value={artist.id}>
                              {artist.displayName}
                            </option>
                          ))}
                        </select>
                        {selectedArtist ? (
                          <HelpText>
                            Credit: {selectedArtist.creditName}. {selectedArtist.paymentEnabled ? `Default payout ${selectedArtist.defaultPayoutRate}%.` : "Artist share is donated."}
                          </HelpText>
                        ) : null}
                      </div>

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`artist-share-${index}`}>Share</label>
                        <input
                          id={`artist-share-${index}`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={row.collaborationShare}
                          onChange={(event) => updateArtistRow(index, { collaborationShare: event.currentTarget.value })}
                          style={fieldStyle}
                        />
                      </div>

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`artist-credit-${index}`}>Credit override</label>
                        <input
                          id={`artist-credit-${index}`}
                          type="text"
                          value={row.creditOverride}
                          onChange={(event) => updateArtistRow(index, { creditOverride: event.currentTarget.value })}
                          style={fieldStyle}
                        />
                      </div>

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`artist-payout-enabled-${index}`}>Payout</label>
                        <select
                          id={`artist-payout-enabled-${index}`}
                          value={row.payoutEnabledOverride}
                          onChange={(event) => updateArtistRow(index, { payoutEnabledOverride: event.currentTarget.value as ArtistAssignmentRow["payoutEnabledOverride"] })}
                          style={fieldStyle}
                        >
                          <option value="inherit">Artist default</option>
                          <option value="true">Enabled</option>
                          <option value="false">Disabled</option>
                        </select>
                        <input
                          aria-label={`Artist payout rate override ${index + 1}`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="Rate override"
                          value={row.payoutRateOverride}
                          onChange={(event) => updateArtistRow(index, { payoutRateOverride: event.currentTarget.value })}
                          style={fieldStyle}
                        />
                      </div>

                      <s-button variant="secondary" tone="critical" onClick={() => removeArtistRow(index)}>
                        Remove
                      </s-button>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
              <s-text>
                <span style={{ color: artistRows.length > 0 && artistTotal !== 100 ? "var(--p-color-text-critical, #8e1f1f)" : "var(--p-color-text-subdued, #6d7175)" }}>
                  Total artist share: {artistTotal.toFixed(2)}%
                </span>
              </s-text>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <s-button variant="secondary" onClick={addArtist} disabled={artistRows.length >= artists.length}>
                  Add Artist
                </s-button>
                <s-button variant="primary" onClick={saveArtistAssignments} disabled={isSubmitting || (artistRows.length > 0 && artistTotal !== 100)}>
                  Save Artist assignments
                </s-button>
              </div>
            </div>
          </div>
        </s-section>

        <s-section heading="Cause assignments">
          <div style={{ display: "grid", gap: "1rem" }}>
            <s-text>
              Assign one or more active Causes to this product. Total allocation must be 100% or less.
            </s-text>
            <HelpText>These percentages control how this product&apos;s future order-level net contribution is split across Causes when a snapshot is created.</HelpText>
            {artistRows.length > 0 ? (
              <s-banner tone="info">
                <s-text>This product currently uses Artist routing. Direct Cause assignments are a derived storefront rollup and cannot be edited until Artist assignments are cleared.</s-text>
              </s-banner>
            ) : null}

            {rows.length === 0 ? (
              <s-banner tone="warning">
                <s-text>No Causes are assigned yet. Products without assignments donate 0%.</s-text>
              </s-banner>
            ) : (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {rows.map((row, index) => {
                  const selectableCauses = causes.filter(
                    (cause: (typeof causes)[number]) =>
                      cause.id === row.causeId || !rows.some((entry, entryIndex) => entry.causeId === cause.id && entryIndex !== index),
                  );

                  return (
                    <div
                      key={`${row.causeId}-${index}`}
                      style={{
                        display: "grid",
                        gap: "0.75rem",
                        gridTemplateColumns: "minmax(260px, 2fr) minmax(180px, 1fr) auto",
                        alignItems: "end",
                      }}
                    >
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`cause-${index}`}>Cause</label>
                        <HelpText>The recipient that should receive a share of this product&apos;s future donation pool.</HelpText>
                        <select
                          id={`cause-${index}`}
                          value={row.causeId}
                          onChange={(event) => updateRow(index, { causeId: event.currentTarget.value })}
                          style={fieldStyle}
                        >
                          {!row.causeId ? <option value="">Select cause</option> : null}
                          {selectableCauses.map((cause: (typeof causes)[number]) => (
                            <option key={cause.id} value={cause.id}>
                              {cause.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`percentage-${index}`}>Percentage</label>
                        <HelpText>Percent of this product&apos;s net contribution allocated to the selected Cause.</HelpText>
                        <input
                          id={`percentage-${index}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max="100"
                          step="0.01"
                          value={row.percentage}
                          onChange={(event) => updateRow(index, { percentage: event.currentTarget.value })}
                          style={fieldStyle}
                        />
                      </div>

                      <s-button variant="secondary" tone="critical" onClick={() => removeRow(index)}>
                        Remove
                      </s-button>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
              <s-text>
                <span style={{ color: total > 100 ? "var(--p-color-text-critical, #8e1f1f)" : "var(--p-color-text-subdued, #6d7175)" }}>
                  Total allocation: {total.toFixed(2)}%
                </span>
              </s-text>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <s-button variant="secondary" onClick={addCause} disabled={rows.length >= causes.length || artistRows.length > 0}>
                  Add cause
                </s-button>
                <s-button variant="primary" onClick={saveAssignments} disabled={isSubmitting || artistRows.length > 0}>
                  Save assignments
                </s-button>
              </div>
            </div>
          </div>
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[ProductDetail] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Product donations" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading Product donations. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
