import { jsonResponse } from "~/utils/json-response.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { Link, useActionData, useLoaderData, useRouteError } from "@remix-run/react";
import { ArtistProfileForm } from "../components/ArtistProfileForm";
import { prisma } from "../db.server";
import { saveArtistProfileFromForm, type ArtistProfileActionData } from "../services/artistProfile.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

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
  const { session } = await authenticateAdminRequest(request);
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
