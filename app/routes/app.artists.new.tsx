import { jsonResponse } from "~/utils/json-response.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, useActionData, useLoaderData, useRouteError } from "@remix-run/react";
import { ArtistProfileForm } from "../components/ArtistProfileForm";
import { prisma } from "../db.server";
import { upsertArtistMetaobject } from "../services/artistMetaobjectService.server";
import { saveArtistProfileFromForm, type ArtistProfileActionData } from "../services/artistProfile.server";
import {
  deletePublicIcon,
  getPublicIconUrl,
  getUploadedIconFile,
  PublicIconUploadError,
  uploadPublicIcon,
} from "../services/publicIconStorage.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

function buildArtistPublicIconUrl(shopId: string, artistId: string, iconStorageKey: string | null | undefined) {
  return iconStorageKey
    ? getPublicIconUrl({
        type: "artist",
        id: artistId,
        shopDomain: shopId,
        version: iconStorageKey,
      })
    : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const causes = await prisma.cause.findMany({
    where: { shopId, status: "active" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return jsonResponse({ causes });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticateAdminRequest(request);
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent !== "create") {
    return jsonResponse({ ok: false, message: "Unsupported action." } satisfies ArtistProfileActionData, { status: 400 });
  }

  const result = await saveArtistProfileFromForm({
    shopId: session.shop,
    formData,
    intent: "create",
  });

  if (!result.ok) {
    return jsonResponse(result, { status: 400 });
  }

  const artist = await prisma.artist.findFirst({
    where: { id: result.artistId, shopId: session.shop },
    select: {
      id: true,
      shopifyMetaobjectId: true,
      displayName: true,
      creditName: true,
      publicBio: true,
      iconUrl: true,
      iconStorageKey: true,
      websiteUrl: true,
      instagramUrl: true,
      status: true,
    },
  });

  let artistForSync = artist;
  if (artist) {
    const iconFile = getUploadedIconFile(formData);
    if (iconFile) {
      try {
        const icon = await uploadPublicIcon({
          shopId: session.shop,
          ownerType: "artist",
          ownerId: artist.id,
          file: iconFile,
        });
        await prisma.artist.update({
          where: { id: artist.id, shopId: session.shop },
          data: {
            iconStorageKey: icon.key,
            iconUrl: null,
          },
        });
        if (artist.iconStorageKey) {
          await deletePublicIcon(artist.iconStorageKey);
        }
        artistForSync = { ...artist, iconUrl: null, iconStorageKey: icon.key };
      } catch (error) {
        if (error instanceof PublicIconUploadError) {
          return jsonResponse(
            { ok: false, message: error.message, fieldErrors: { iconFile: [error.message] } } satisfies ArtistProfileActionData,
            { status: 400 },
          );
        }
        throw error;
      }
    }
  }

  if (artistForSync && admin) {
    try {
      const artistMetaobjectInput = {
        ...artistForSync,
        iconUrl: artistForSync.iconStorageKey
          ? buildArtistPublicIconUrl(session.shop, artistForSync.id, artistForSync.iconStorageKey)
          : artistForSync.iconUrl,
      };
      const metaobjectId = await upsertArtistMetaobject({
        admin,
        existingMetaobjectId: artistForSync.shopifyMetaobjectId,
        input: artistMetaobjectInput,
      });
      await prisma.artist.update({
        where: { id: artistForSync.id, shopId: session.shop },
        data: { shopifyMetaobjectId: metaobjectId },
      });
      await prisma.auditLog.create({
        data: {
          shopId: session.shop,
          entity: "Artist",
          entityId: artistForSync.id,
          action: "ARTIST_SHOPIFY_SYNCED",
          actor: "merchant",
          payload: { shopifyMetaobjectId: metaobjectId },
        },
      });
    } catch (error) {
      await prisma.auditLog.create({
        data: {
          shopId: session.shop,
          entity: "Artist",
          entityId: artistForSync.id,
          action: "ARTIST_SHOPIFY_SYNC_FAILED",
          actor: "merchant",
          payload: { message: error instanceof Error ? error.message : "Unknown Shopify sync failure" },
        },
      });
    }
  }

  return redirect(`/app/artists/${result.artistId}`);
};

export default function NewArtistPage() {
  const { causes } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <>
      <ui-title-bar title="New artist" />
      <s-page>
        <s-section heading="New artist">
          <div style={{ display: "grid", gap: "1rem" }}>
            <Link to="/app/artists">Back to Artists</Link>
            <ArtistProfileForm
              causes={causes}
              intent="create"
              actionData={actionData && "ok" in actionData ? actionData : undefined}
            />
          </div>
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[NewArtist] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="New artist" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading the Artist form. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
