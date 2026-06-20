import { jsonResponse } from "~/utils/json-response.server";
import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { z } from "zod";
import { HelpText } from "../components/HelpText";
import { prisma } from "../db.server";
import {
  auditProductShopifySyncFailure,
  saveProductArtistAssignmentsLocally,
  syncProductArtistAssignmentsToShopify,
  type ProductArtistAssignmentInput,
} from "../services/productArtistAssignmentService.server";
import { authenticateAdminRequest, isPlaywrightBypassRequest } from "../utils/admin-auth.server";

const artistSchema = z.object({
  id: z.string().trim().optional(),
  displayName: z.string().trim().min(1, "Display name is required."),
  creditName: z.string().trim().min(1, "Credit name is required."),
  creditPreference: z.string().trim().min(1, "Credit preference is required."),
  publicBio: z.string().trim().optional(),
  websiteUrl: z.union([z.literal(""), z.url({ message: "Website URL must be a valid URL." })]).optional(),
  instagramUrl: z.union([z.literal(""), z.url({ message: "Instagram URL must be a valid URL." })]).optional(),
  contactName: z.string().trim().optional(),
  contactEmail: z.union([z.literal(""), z.email({ message: "Contact email must be a valid email." })]).optional(),
  status: z.enum(["draft", "active", "inactive", "revoked"]),
  paymentEnabled: z.boolean(),
  defaultPayoutRate: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Number(value)) && Number(value) >= 0 && Number(value) <= 100, "Payout rate must be between 0 and 100."),
  taxStatus: z.string().trim().min(1, "Tax status is required."),
  paymentNotes: z.string().trim().optional(),
  restrictedChannels: z.string().trim().optional(),
  restrictedFormats: z.string().trim().optional(),
  internalNotes: z.string().trim().optional(),
});

const productMappingSchema = z.object({
  artistId: z.string().trim().min(1),
  mappings: z.array(
    z.object({
      productId: z.string().min(1),
      collaborationShare: z.string().min(1),
      creditOverride: z.string().optional(),
      payoutEnabledOverride: z.enum(["inherit", "true", "false"]),
      payoutRateOverride: z.string().optional(),
    }),
  ),
});

function normalizeOptional(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readCauseAssignments(formData: FormData, causeIds: Set<string>) {
  return Array.from(causeIds)
    .map((causeId) => {
      const raw = formData.get(`cause:${causeId}`)?.toString().trim() ?? "";
      if (!raw) return null;
      const percentage = Number(raw);
      if (Number.isNaN(percentage) || percentage <= 0) {
        throw new Error("Cause percentages must be greater than 0.");
      }
      return { causeId, percentage };
    })
    .filter((assignment): assignment is { causeId: string; percentage: number } => Boolean(assignment));
}

type ArtistActionData = {
  ok: boolean;
  message: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const [artists, causes, products] = await Promise.all([
    prisma.artist.findMany({
      where: { shopId },
      orderBy: [{ status: "asc" }, { displayName: "asc" }],
      include: {
        causeAssignments: {
          include: {
            cause: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: { productAssignments: true, lineAllocations: true },
        },
        productAssignments: {
          where: { shopId, status: "active" },
          orderBy: [{ product: { title: "asc" } }, { createdAt: "asc" }],
          select: {
            productId: true,
            collaborationShare: true,
            creditOverride: true,
            payoutEnabledOverride: true,
            payoutRateOverride: true,
            product: {
              select: {
                id: true,
                title: true,
                handle: true,
                status: true,
                artistAssignments: {
                  where: { shopId, status: "active" },
                  orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
                  select: {
                    artistId: true,
                    collaborationShare: true,
                    artist: {
                      select: {
                        displayName: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.cause.findMany({
      where: { shopId, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      where: { shopId },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        handle: true,
        status: true,
        artistAssignments: {
          where: { shopId, status: "active" },
          select: {
            artistId: true,
            collaborationShare: true,
            artist: {
              select: { displayName: true },
            },
          },
        },
      },
    }),
  ]);

  return jsonResponse({
    artists: artists.map((artist) => ({
      id: artist.id,
      displayName: artist.displayName,
      creditName: artist.creditName,
      creditPreference: artist.creditPreference,
      publicBio: artist.publicBio ?? "",
      websiteUrl: artist.websiteUrl ?? "",
      instagramUrl: artist.instagramUrl ?? "",
      contactName: artist.contactName ?? "",
      contactEmail: artist.contactEmail ?? "",
      status: artist.status,
      paymentEnabled: artist.paymentEnabled,
      defaultPayoutRate: artist.defaultPayoutRate.toString(),
      taxStatus: artist.taxStatus,
      paymentNotes: artist.paymentNotes ?? "",
      restrictedChannels: artist.restrictedChannels ?? "",
      restrictedFormats: artist.restrictedFormats ?? "",
      internalNotes: artist.internalNotes ?? "",
      productAssignmentCount: artist._count.productAssignments,
      historicalLineCount: artist._count.lineAllocations,
      productMappings: artist.productAssignments.map((assignment) => ({
        productId: assignment.productId,
        productTitle: assignment.product.title,
        productHandle: assignment.product.handle,
        productStatus: assignment.product.status,
        collaborationShare: assignment.collaborationShare.toString(),
        creditOverride: assignment.creditOverride ?? "",
        payoutEnabledOverride:
          assignment.payoutEnabledOverride === null
            ? "inherit"
            : assignment.payoutEnabledOverride
              ? "true"
              : "false",
        payoutRateOverride: assignment.payoutRateOverride?.toString() ?? "",
        otherArtistShares: assignment.product.artistAssignments
          .filter((productAssignment) => productAssignment.artistId !== artist.id)
          .map((productAssignment) => ({
            artistId: productAssignment.artistId,
            artistName: productAssignment.artist.displayName,
            collaborationShare: productAssignment.collaborationShare.toString(),
          })),
      })),
      causeAssignments: artist.causeAssignments.map((assignment) => ({
        causeId: assignment.causeId,
        causeName: assignment.cause.name,
        percentage: assignment.percentage.toString(),
      })),
    })),
    causes,
    products: products.map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      artistShares: product.artistAssignments.map((assignment) => ({
        artistId: assignment.artistId,
        artistName: assignment.artist.displayName,
        collaborationShare: assignment.collaborationShare.toString(),
      })),
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent !== "create" && intent !== "update" && intent !== "save-product-mappings") {
    return jsonResponse({ ok: false, message: "Unsupported action." }, { status: 400 });
  }

  if (intent === "save-product-mappings") {
    const isPlaywrightBypass = isPlaywrightBypassRequest(request);
    if (!admin && !isPlaywrightBypass) {
      return jsonResponse({ ok: false, message: "Shopify admin context is required." }, { status: 500 });
    }

    const rawMappings = formData.get("productMappings")?.toString() ?? "[]";
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawMappings);
    } catch {
      return jsonResponse({ ok: false, message: "Invalid product mappings." }, { status: 400 });
    }

    const parsed = productMappingSchema.safeParse({
      artistId: formData.get("artistId")?.toString() ?? "",
      mappings: parsedJson,
    });

    if (!parsed.success) {
      return jsonResponse(
        { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid product mappings." },
        { status: 400 },
      );
    }

    const artist = await prisma.artist.findFirst({
      where: { id: parsed.data.artistId, shopId, status: "active" },
      select: { id: true, displayName: true },
    });

    if (!artist) {
      return jsonResponse({ ok: false, message: "Artist must be active before assigning products." }, { status: 404 });
    }

    const productIds = parsed.data.mappings.map((mapping) => mapping.productId);
    if (new Set(productIds).size !== productIds.length) {
      return jsonResponse({ ok: false, message: "Each product can only be assigned once per Artist." }, { status: 400 });
    }

    const existingAssignments = await prisma.productArtistAssignment.findMany({
      where: { shopId, artistId: artist.id, status: "active" },
      select: { productId: true },
    });
    const touchedProductIds = Array.from(new Set([...existingAssignments.map((assignment) => assignment.productId), ...productIds]));

    const products = touchedProductIds.length
      ? await prisma.product.findMany({
          where: { id: { in: touchedProductIds }, shopId },
          select: {
            id: true,
            shopifyId: true,
            title: true,
            artistAssignments: {
              where: { shopId, status: "active" },
              orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
              select: {
                artistId: true,
                collaborationShare: true,
                creditOverride: true,
                payoutEnabledOverride: true,
                payoutRateOverride: true,
              },
            },
          },
        })
      : [];

    if (products.length !== touchedProductIds.length) {
      return jsonResponse({ ok: false, message: "One or more selected products are unavailable." }, { status: 404 });
    }

    const mappingByProductId = new Map(parsed.data.mappings.map((mapping) => [mapping.productId, mapping]));
    const syncFailures: string[] = [];

    try {
      for (const product of products) {
        const currentArtistMapping = mappingByProductId.get(product.id);
        const nextAssignments: ProductArtistAssignmentInput[] = [
          ...product.artistAssignments
            .filter((assignment) => assignment.artistId !== artist.id)
            .map((assignment) => ({
              artistId: assignment.artistId,
              collaborationShare: assignment.collaborationShare.toString(),
              creditOverride: assignment.creditOverride ?? "",
              payoutEnabledOverride:
                assignment.payoutEnabledOverride === null
                  ? "inherit" as const
                  : assignment.payoutEnabledOverride
                    ? "true" as const
                    : "false" as const,
              payoutRateOverride: assignment.payoutRateOverride?.toString() ?? "",
            })),
          ...(currentArtistMapping
            ? [{
                artistId: artist.id,
                collaborationShare: currentArtistMapping.collaborationShare,
                creditOverride: currentArtistMapping.creditOverride ?? "",
                payoutEnabledOverride: currentArtistMapping.payoutEnabledOverride,
                payoutRateOverride: currentArtistMapping.payoutRateOverride ?? "",
              }]
            : []),
        ];

        const derivedAssignments = await prisma.$transaction(async (tx) => {
          return saveProductArtistAssignmentsLocally({
            db: tx,
            shopId,
            product,
            artistAssignments: nextAssignments,
            auditSource: "artists_bulk_editor",
          });
        });

        if (admin) {
          try {
            await syncProductArtistAssignmentsToShopify({ admin, product, derivedAssignments });
          } catch (error) {
            console.error("[Artists] Shopify sync failed after saving product mappings:", error);
            await auditProductShopifySyncFailure(shopId, product.id, product.shopifyId, error);
            syncFailures.push(product.title);
          }
        }
      }

      return jsonResponse({
        ok: true,
        message: syncFailures.length > 0
          ? `Product mappings saved for ${artist.displayName}. Shopify storefront sync failed for ${syncFailures.length} product${syncFailures.length === 1 ? "" : "s"}; save again later to retry.`
          : `Product mappings saved for ${artist.displayName}.`,
      });
    } catch (error) {
      console.error("[Artists] Failed to save product mappings:", error);
      return jsonResponse(
        { ok: false, message: error instanceof Error ? error.message : "Unable to save product mappings." },
        { status: 400 },
      );
    }
  }

  const causes = await prisma.cause.findMany({
    where: { shopId, status: "active" },
    select: { id: true },
  });
  const causeIds = new Set(causes.map((cause) => cause.id));

  const parsed = artistSchema.safeParse({
    id: formData.get("id")?.toString() ?? "",
    displayName: formData.get("displayName")?.toString() ?? "",
    creditName: formData.get("creditName")?.toString() ?? "",
    creditPreference: formData.get("creditPreference")?.toString() ?? "",
    publicBio: formData.get("publicBio")?.toString() ?? "",
    websiteUrl: formData.get("websiteUrl")?.toString() ?? "",
    instagramUrl: formData.get("instagramUrl")?.toString() ?? "",
    contactName: formData.get("contactName")?.toString() ?? "",
    contactEmail: formData.get("contactEmail")?.toString() ?? "",
    status: formData.get("status")?.toString() ?? "draft",
    paymentEnabled: formData.get("paymentEnabled")?.toString() === "true",
    defaultPayoutRate: formData.get("defaultPayoutRate")?.toString() || "10",
    taxStatus: formData.get("taxStatus")?.toString() ?? "not_required",
    paymentNotes: formData.get("paymentNotes")?.toString() ?? "",
    restrictedChannels: formData.get("restrictedChannels")?.toString() ?? "",
    restrictedFormats: formData.get("restrictedFormats")?.toString() ?? "",
    internalNotes: formData.get("internalNotes")?.toString() ?? "",
  });

  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        message: parsed.error.issues[0]?.message ?? "Invalid artist details.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  let causeAssignments: Array<{ causeId: string; percentage: number }>;
  try {
    causeAssignments = readCauseAssignments(formData, causeIds);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Cause assignments.";
    return jsonResponse({ ok: false, message, fieldErrors: { causes: [message] } }, { status: 400 });
  }

  const totalCausePercentage = causeAssignments.reduce((sum, assignment) => sum + assignment.percentage, 0);
  if (parsed.data.status === "active" && totalCausePercentage !== 100) {
    return jsonResponse(
      {
        ok: false,
        message: "Active Artists must have Cause percentages totaling 100%.",
        fieldErrors: { causes: ["Active Artists must have Cause percentages totaling 100%."] },
      },
      { status: 400 },
    );
  }

  if (totalCausePercentage > 100) {
    return jsonResponse(
      {
        ok: false,
        message: "Cause percentages must total 100% or less.",
        fieldErrors: { causes: ["Cause percentages must total 100% or less."] },
      },
      { status: 400 },
    );
  }

  const artistData = {
    displayName: parsed.data.displayName,
    creditName: parsed.data.creditName,
    creditPreference: parsed.data.creditPreference,
    publicBio: normalizeOptional(parsed.data.publicBio),
    websiteUrl: normalizeOptional(parsed.data.websiteUrl),
    instagramUrl: normalizeOptional(parsed.data.instagramUrl),
    contactName: normalizeOptional(parsed.data.contactName),
    contactEmail: normalizeOptional(parsed.data.contactEmail),
    status: parsed.data.status,
    paymentEnabled: parsed.data.paymentEnabled,
    defaultPayoutRate: Number(parsed.data.defaultPayoutRate),
    taxStatus: parsed.data.taxStatus,
    paymentNotes: normalizeOptional(parsed.data.paymentNotes),
    restrictedChannels: normalizeOptional(parsed.data.restrictedChannels),
    restrictedFormats: normalizeOptional(parsed.data.restrictedFormats),
    internalNotes: normalizeOptional(parsed.data.internalNotes),
  };

  const artist = await prisma.$transaction(async (tx) => {
    const savedArtist =
      intent === "create"
        ? await tx.artist.create({
            data: {
              shopId,
              ...artistData,
            },
          })
        : await tx.artist.update({
            where: {
              id: parsed.data.id,
              shopId,
            },
            data: artistData,
          });

    await tx.artistCauseAssignment.deleteMany({
      where: {
        shopId,
        artistId: savedArtist.id,
      },
    });

    if (causeAssignments.length > 0) {
      await tx.artistCauseAssignment.createMany({
        data: causeAssignments.map((assignment) => ({
          shopId,
          artistId: savedArtist.id,
          causeId: assignment.causeId,
          percentage: assignment.percentage,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        shopId,
        entity: "Artist",
        entityId: savedArtist.id,
        action: intent === "create" ? "ARTIST_CREATED" : "ARTIST_UPDATED",
        actor: "merchant",
        payload: {
          status: savedArtist.status,
          paymentEnabled: savedArtist.paymentEnabled,
          defaultPayoutRate: savedArtist.defaultPayoutRate.toString(),
          causeAssignments,
        },
      },
    });

    return savedArtist;
  });

  return jsonResponse({
    ok: true,
    message: intent === "create" ? `Artist ${artist.displayName} created.` : `Artist ${artist.displayName} updated.`,
  });
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

const twoColumnStyle = {
  display: "grid",
  gap: "0.9rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
};

const compactGridStyle = {
  display: "grid",
  gap: "0.75rem",
  gridTemplateColumns: "minmax(12rem, 2fr) minmax(6rem, 0.5fr) minmax(12rem, 1fr) auto",
  alignItems: "end",
};

type ProductMappingRow = {
  productId: string;
  productTitle: string;
  productHandle: string;
  productStatus: string;
  collaborationShare: string;
  creditOverride: string;
  payoutEnabledOverride: "inherit" | "true" | "false";
  payoutRateOverride: string;
  otherArtistShares: Array<{
    artistId: string;
    artistName: string;
    collaborationShare: string;
  }>;
};

export default function ArtistsPage() {
  const { artists, causes, products } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ArtistActionData>();

  function ArtistForm({
    artist,
    intent,
  }: {
    artist?: (typeof artists)[number];
    intent: "create" | "update";
  }) {
    const assignments = new Map(artist?.causeAssignments.map((assignment) => [assignment.causeId, assignment.percentage]) ?? []);

    return (
      <fetcher.Form method="post" style={{ display: "grid", gap: "1rem" }}>
        <input type="hidden" name="intent" value={intent} />
        {artist ? <input type="hidden" name="id" value={artist.id} /> : null}
        <div style={twoColumnStyle}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-display-name`}>Display name</label>
            <input id={`${intent}-${artist?.id ?? "new"}-display-name`} name="displayName" defaultValue={artist?.displayName ?? ""} style={fieldStyle} />
          </div>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-credit-name`}>Credit name</label>
            <input id={`${intent}-${artist?.id ?? "new"}-credit-name`} name="creditName" defaultValue={artist?.creditName ?? ""} style={fieldStyle} />
          </div>
        </div>

        <div style={twoColumnStyle}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-credit-preference`}>Credit preference</label>
            <select id={`${intent}-${artist?.id ?? "new"}-credit-preference`} name="creditPreference" defaultValue={artist?.creditPreference ?? "artist_name"} style={fieldStyle}>
              <option value="public_name">Public name</option>
              <option value="artist_name">Artist name</option>
              <option value="studio_name">Studio name</option>
              <option value="handle_only">Handle only</option>
              <option value="pseudonym">Pseudonym</option>
              <option value="anonymous">Anonymous</option>
              <option value="uncredited">Uncredited</option>
            </select>
          </div>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-status`}>Status</label>
            <select id={`${intent}-${artist?.id ?? "new"}-status`} name="status" defaultValue={artist?.status ?? "draft"} style={fieldStyle}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${intent}-${artist?.id ?? "new"}-bio`}>Public bio</label>
          <textarea id={`${intent}-${artist?.id ?? "new"}-bio`} name="publicBio" rows={3} defaultValue={artist?.publicBio ?? ""} style={{ ...fieldStyle, minHeight: "6rem" }} />
        </div>

        <div style={twoColumnStyle}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-website`}>Website URL</label>
            <input id={`${intent}-${artist?.id ?? "new"}-website`} name="websiteUrl" defaultValue={artist?.websiteUrl ?? ""} style={fieldStyle} />
          </div>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-instagram`}>Instagram URL</label>
            <input id={`${intent}-${artist?.id ?? "new"}-instagram`} name="instagramUrl" defaultValue={artist?.instagramUrl ?? ""} style={fieldStyle} />
          </div>
        </div>

        <div style={twoColumnStyle}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-contact-name`}>Private contact name</label>
            <input id={`${intent}-${artist?.id ?? "new"}-contact-name`} name="contactName" defaultValue={artist?.contactName ?? ""} style={fieldStyle} />
          </div>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-contact-email`}>Private contact email</label>
            <input id={`${intent}-${artist?.id ?? "new"}-contact-email`} name="contactEmail" defaultValue={artist?.contactEmail ?? ""} style={fieldStyle} />
          </div>
        </div>

        <div style={twoColumnStyle}>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" name="paymentEnabled" value="true" defaultChecked={artist?.paymentEnabled ?? false} />
            <span>Artist receives payout</span>
          </label>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-payout-rate`}>Default payout rate</label>
            <input id={`${intent}-${artist?.id ?? "new"}-payout-rate`} name="defaultPayoutRate" type="number" min="0" max="100" step="0.01" defaultValue={artist?.defaultPayoutRate ?? "10"} style={fieldStyle} />
          </div>
        </div>

        <div style={twoColumnStyle}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-tax-status`}>Payment/tax status</label>
            <select id={`${intent}-${artist?.id ?? "new"}-tax-status`} name="taxStatus" defaultValue={artist?.taxStatus ?? "not_required"} style={fieldStyle}>
              <option value="not_required">Not required</option>
              <option value="w9_requested">W-9 requested</option>
              <option value="w9_received">W-9 received</option>
              <option value="blocked">Payment blocked</option>
            </select>
          </div>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-payment-notes`}>Payment notes</label>
            <input id={`${intent}-${artist?.id ?? "new"}-payment-notes`} name="paymentNotes" defaultValue={artist?.paymentNotes ?? ""} style={fieldStyle} />
          </div>
        </div>

        <div style={{ display: "grid", gap: "0.5rem" }}>
          <strong>Artist-selected Causes</strong>
          <HelpText>Active Artists must total exactly 100%. Draft Artists can be incomplete.</HelpText>
          {causes.length === 0 ? (
            <s-text color="subdued">Create active Causes before assigning artist donation routing.</s-text>
          ) : (
            causes.map((cause) => (
              <div key={cause.id} style={twoColumnStyle}>
                <span>{cause.name}</span>
                <input
                  name={`cause:${cause.id}`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={assignments.get(cause.id) ?? ""}
                  style={fieldStyle}
                />
              </div>
            ))
          )}
        </div>

        <div style={twoColumnStyle}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-restricted-channels`}>Restricted channels</label>
            <input id={`${intent}-${artist?.id ?? "new"}-restricted-channels`} name="restrictedChannels" defaultValue={artist?.restrictedChannels ?? ""} style={fieldStyle} />
          </div>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor={`${intent}-${artist?.id ?? "new"}-restricted-formats`}>Restricted formats</label>
            <input id={`${intent}-${artist?.id ?? "new"}-restricted-formats`} name="restrictedFormats" defaultValue={artist?.restrictedFormats ?? ""} style={fieldStyle} />
          </div>
        </div>

        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${intent}-${artist?.id ?? "new"}-internal-notes`}>Internal notes</label>
          <textarea id={`${intent}-${artist?.id ?? "new"}-internal-notes`} name="internalNotes" rows={3} defaultValue={artist?.internalNotes ?? ""} style={{ ...fieldStyle, minHeight: "6rem" }} />
        </div>

        {fetcher.data && !fetcher.data.ok ? (
          <s-banner tone="critical">
            <s-text>{fetcher.data.message}</s-text>
          </s-banner>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <s-button type="submit" variant="primary" disabled={fetcher.state !== "idle"}>
            {intent === "create" ? "Create Artist" : "Save Artist"}
          </s-button>
        </div>
      </fetcher.Form>
    );
  }

  function ProductMappingsEditor({ artist }: { artist: (typeof artists)[number] }) {
    const mappingFetcher = useFetcher<ArtistActionData>();
    const [rows, setRows] = useState<ProductMappingRow[]>(() =>
      artist.productMappings.map((mapping) => ({
        ...mapping,
        payoutEnabledOverride: mapping.payoutEnabledOverride as ProductMappingRow["payoutEnabledOverride"],
      })),
    );
    const [query, setQuery] = useState("");
    const [resultsOpen, setResultsOpen] = useState(false);
    const selectedProductIds = useMemo(() => new Set(rows.map((row) => row.productId)), [rows]);
    const isSubmitting = mappingFetcher.state !== "idle";

    const filteredProducts = useMemo(() => {
      const normalized = query.trim().toLowerCase();
      if (!normalized) return [];
      return products
        .filter((product) => !selectedProductIds.has(product.id))
        .filter((product) => {
          const haystack = `${product.title} ${product.handle} ${product.status}`.toLowerCase();
          return haystack.includes(normalized);
        })
        .slice(0, 8);
    }, [query, selectedProductIds]);

    function addProduct(product: (typeof products)[number]) {
      const otherArtistShares = product.artistShares.filter((share) => share.artistId !== artist.id);
      const otherShareTotal = otherArtistShares.reduce((sum, share) => sum + (Number(share.collaborationShare) || 0), 0);
      setRows((current) => [
        ...current,
        {
          productId: product.id,
          productTitle: product.title,
          productHandle: product.handle,
          productStatus: product.status,
          collaborationShare: Math.max(0, 100 - otherShareTotal).toString(),
          creditOverride: "",
          payoutEnabledOverride: "inherit",
          payoutRateOverride: "",
          otherArtistShares,
        },
      ]);
      setQuery("");
      setResultsOpen(false);
    }

    function updateRow(index: number, patch: Partial<ProductMappingRow>) {
      setRows((current) =>
        current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
      );
    }

    function removeRow(index: number) {
      setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
    }

    function saveProductMappings() {
      const formData = new FormData();
      formData.append("intent", "save-product-mappings");
      formData.append("artistId", artist.id);
      formData.append(
        "productMappings",
        JSON.stringify(rows.map((row) => ({
          productId: row.productId,
          collaborationShare: row.collaborationShare,
          creditOverride: row.creditOverride,
          payoutEnabledOverride: row.payoutEnabledOverride,
          payoutRateOverride: row.payoutRateOverride,
        }))),
      );
      mappingFetcher.submit(formData, { method: "post" });
    }

    return (
      <div style={{ display: "grid", gap: "1rem" }}>
        {mappingFetcher.data && !mappingFetcher.data.ok ? (
          <s-banner tone="critical">
            <s-text>{mappingFetcher.data.message}</s-text>
          </s-banner>
        ) : null}
        {mappingFetcher.data?.ok && mappingFetcher.data.message ? (
          <s-banner tone="success">
            <s-text>{mappingFetcher.data.message}</s-text>
          </s-banner>
        ) : null}

        <div style={{ display: "grid", gap: "0.45rem", position: "relative" }}>
          <label htmlFor={`product-search-${artist.id}`}>Add product</label>
          <input
            id={`product-search-${artist.id}`}
            type="text"
            value={query}
            placeholder="Search products by title or handle"
            autoComplete="off"
            onFocus={() => setResultsOpen(true)}
            onClick={() => setResultsOpen(true)}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setResultsOpen(true);
            }}
            style={fieldStyle}
          />
          {resultsOpen && query.trim() ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 0.25rem)",
                left: 0,
                right: 0,
                zIndex: 3,
                border: "1px solid var(--p-color-border, #d2d5d8)",
                borderRadius: "0.5rem",
                background: "var(--p-color-bg-surface, #fff)",
                boxShadow: "0 12px 24px rgba(0, 0, 0, 0.12)",
                overflow: "hidden",
              }}
            >
              {filteredProducts.length === 0 ? (
                <div style={{ padding: "0.75rem 1rem" }}>No products match that search.</div>
              ) : (
                filteredProducts.map((product) => {
                  const otherArtistShares = product.artistShares.filter((share) => share.artistId !== artist.id);
                  const otherShareTotal = otherArtistShares.reduce((sum, share) => sum + (Number(share.collaborationShare) || 0), 0);
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addProduct(product)}
                      style={{
                        width: "100%",
                        border: 0,
                        background: "var(--p-color-bg-surface, #fff)",
                        padding: "0.75rem 1rem",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <strong>{product.title}</strong>
                      <div style={{ color: "var(--p-color-text-subdued, #6d7175)" }}>
                        /{product.handle} · {product.status}
                        {otherArtistShares.length > 0 ? ` · ${otherShareTotal.toFixed(2)}% already assigned` : ""}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <s-text color="subdued">No products are assigned to this Artist.</s-text>
        ) : (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {rows.map((row, index) => {
              const otherShareTotal = row.otherArtistShares.reduce((sum, share) => sum + (Number(share.collaborationShare) || 0), 0);
              const productTotal = otherShareTotal + (Number(row.collaborationShare) || 0);
              return (
                <div
                  key={row.productId}
                  style={{
                    display: "grid",
                    gap: "0.75rem",
                    padding: "0.85rem",
                    border: "1px solid var(--p-color-border, #d2d5d8)",
                    borderRadius: "0.5rem",
                    background: "var(--p-color-bg-surface, #fff)",
                  }}
                >
                  <div style={compactGridStyle}>
                    <div style={{ display: "grid", gap: "0.2rem" }}>
                      <strong>{row.productTitle}</strong>
                      <s-text color="subdued">/{row.productHandle} · {row.productStatus}</s-text>
                    </div>
                    <div style={{ display: "grid", gap: "0.35rem" }}>
                      <label htmlFor={`product-share-${artist.id}-${index}`}>Share</label>
                      <input
                        id={`product-share-${artist.id}-${index}`}
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={row.collaborationShare}
                        onChange={(event) => updateRow(index, { collaborationShare: event.currentTarget.value })}
                        style={fieldStyle}
                      />
                    </div>
                    <div style={{ display: "grid", gap: "0.2rem" }}>
                      <span style={{ color: productTotal !== 100 ? "var(--p-color-text-critical, #8e1f1f)" : "var(--p-color-text-subdued, #6d7175)" }}>
                        Product total: {productTotal.toFixed(2)}%
                      </span>
                      <s-text color="subdued">
                        {row.otherArtistShares.length > 0
                          ? `Other Artists: ${row.otherArtistShares.map((share) => `${share.artistName} ${Number(share.collaborationShare).toFixed(2)}%`).join(", ")}`
                          : "No other Artists assigned"}
                      </s-text>
                    </div>
                    <s-button variant="secondary" tone="critical" onClick={() => removeRow(index)}>
                      Remove
                    </s-button>
                  </div>

                  <details>
                    <summary>Overrides</summary>
                    <div
                      style={{
                        display: "grid",
                        gap: "0.75rem",
                        gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
                        paddingTop: "0.75rem",
                      }}
                    >
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`product-credit-${artist.id}-${index}`}>Credit override</label>
                        <input
                          id={`product-credit-${artist.id}-${index}`}
                          type="text"
                          value={row.creditOverride}
                          onChange={(event) => updateRow(index, { creditOverride: event.currentTarget.value })}
                          style={fieldStyle}
                        />
                      </div>
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`product-payout-enabled-${artist.id}-${index}`}>Payout rule</label>
                        <select
                          id={`product-payout-enabled-${artist.id}-${index}`}
                          value={row.payoutEnabledOverride}
                          onChange={(event) => updateRow(index, { payoutEnabledOverride: event.currentTarget.value as ProductMappingRow["payoutEnabledOverride"] })}
                          style={fieldStyle}
                        >
                          <option value="inherit">Artist default</option>
                          <option value="true">Enabled</option>
                          <option value="false">Disabled</option>
                        </select>
                      </div>
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`product-payout-rate-${artist.id}-${index}`}>Payout rate override</label>
                        <input
                          id={`product-payout-rate-${artist.id}-${index}`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="Use Artist default"
                          value={row.payoutRateOverride}
                          onChange={(event) => updateRow(index, { payoutRateOverride: event.currentTarget.value })}
                          style={fieldStyle}
                        />
                      </div>
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <s-button type="button" variant="primary" disabled={isSubmitting} onClick={saveProductMappings}>
            Save product mappings
          </s-button>
        </div>
      </div>
    );
  }

  return (
    <>
      <ui-title-bar title="Artists" />
      <s-page>
        {fetcher.data?.ok && fetcher.data.message ? (
          <s-banner tone="success">
            <s-text>{fetcher.data.message}</s-text>
          </s-banner>
        ) : null}

        <s-section heading="Create Artist">
          <ArtistForm intent="create" />
        </s-section>

        <s-section heading="Artist Library">
          {artists.length === 0 ? (
            <s-text>No Artists have been added yet.</s-text>
          ) : (
            <div style={{ display: "grid", gap: "1rem" }}>
              {artists.map((artist) => (
                <details key={artist.id}>
                  <summary>
                    <strong>{artist.displayName}</strong> · {artist.status} · {artist.paymentEnabled ? `${artist.defaultPayoutRate}% payout` : "donates share"}
                  </summary>
                  <div style={{ display: "grid", gap: "1rem", paddingBlock: "1rem" }}>
                    <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                      <span>Credit: {artist.creditName}</span>
                      <span>Products: {artist.productAssignmentCount}</span>
                      <span>Historical lines: {artist.historicalLineCount}</span>
                    </div>
                    <details>
                      <summary>Product mappings</summary>
                      <div style={{ paddingTop: "1rem" }}>
                        <ProductMappingsEditor artist={artist} />
                      </div>
                    </details>
                    <ArtistForm artist={artist} intent="update" />
                  </div>
                </details>
              ))}
            </div>
          )}
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
        <s-section heading="Unable to load Artists">
          <s-text>Something went wrong loading Artists. Please refresh the page.</s-text>
        </s-section>
      </s-page>
    </>
  );
}
