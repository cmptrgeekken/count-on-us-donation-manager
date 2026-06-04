import { jsonResponse } from "~/utils/json-response.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { z } from "zod";
import { HelpText } from "../components/HelpText";
import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

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

  const [artists, causes] = await Promise.all([
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
      },
    }),
    prisma.cause.findMany({
      where: { shopId, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
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
      causeAssignments: artist.causeAssignments.map((assignment) => ({
        causeId: assignment.causeId,
        causeName: assignment.cause.name,
        percentage: assignment.percentage.toString(),
      })),
    })),
    causes,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent !== "create" && intent !== "update") {
    return jsonResponse({ ok: false, message: "Unsupported action." }, { status: 400 });
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

export default function ArtistsPage() {
  const { artists, causes } = useLoaderData<typeof loader>();
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
