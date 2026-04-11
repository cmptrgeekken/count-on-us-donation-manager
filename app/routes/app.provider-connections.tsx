import { useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";

import { jobQueue } from "../jobs/queue.server";
import { authenticateAdminRequest, isPlaywrightBypassRequest } from "../utils/admin-auth.server";
import {
  disconnectProviderConnection,
  getProviderConnectionsPageData,
  savePrintifyConnection,
} from "../services/providerConnections.server";
import { queueProviderSyncRun } from "../services/providerSync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  return Response.json(await getProviderConnectionsPageData(session.shop));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();
  const isBypass = isPlaywrightBypassRequest(request);
  const testFetch: typeof fetch | undefined = isBypass
    ? (async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 1234, title: "Fixture Shop" }],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        )) as typeof fetch
    : undefined;

  if (intent === "save-printify-credentials") {
    try {
      await savePrintifyConnection({
        shopId: session.shop,
        apiKey: formData.get("apiKey")?.toString() ?? "",
        displayName: formData.get("displayName")?.toString() ?? null,
      }, undefined, testFetch);
    } catch (error) {
      if (error instanceof Response) {
        return Response.json({ ok: false, message: await error.text() });
      }
      throw error;
    }

    return Response.json({
      ok: true,
      message: "Printify credentials validated and saved. Provider mapping and cost import still land in the next tranche.",
    });
  }

  if (intent === "refresh-provider") {
    const provider = formData.get("provider")?.toString();
    if (provider !== "printful" && provider !== "printify") {
      return Response.json({ ok: false, message: "Unknown provider." });
    }

    try {
      await queueProviderSyncRun(
        {
          shopId: session.shop,
          provider,
          trigger: "manual",
        },
        undefined,
        jobQueue,
      );
    } catch (error) {
      if (error instanceof Response) {
        return Response.json({ ok: false, message: await error.text() }, { status: error.status });
      }
      throw error;
    }

    return Response.json({
      ok: true,
      message:
        provider === "printify"
          ? "Printify provider refresh queued. This currently revalidates account state and prepares for mapping/cost import."
          : "Printful provider refresh is not available yet.",
    });
  }

  if (intent === "disconnect-provider") {
    const provider = formData.get("provider")?.toString();
    if (provider !== "printful" && provider !== "printify") {
      return Response.json({ ok: false, message: "Unknown provider." });
    }

    try {
      await disconnectProviderConnection({
        shopId: session.shop,
        provider,
      });
    } catch (error) {
      if (error instanceof Response) {
        return Response.json({ ok: false, message: await error.text() });
      }
      throw error;
    }

    return Response.json({ ok: true, message: `${provider === "printify" ? "Printify" : "Printful"} disconnected.` });
  }

  return Response.json({ ok: false, message: "Unknown action." });
};

function formatTimestamp(value: string | null) {
  if (!value) return "Not yet synced";
  return new Date(value).toLocaleString();
}

export default function ProviderConnectionsPage() {
  const { totalVariantCount, variantsWithSkuCount, summaries } = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<{ ok: boolean; message: string }>();
  const syncFetcher = useFetcher<{ ok: boolean; message: string }>();
  const disconnectFetcher = useFetcher<{ ok: boolean; message: string }>();
  const statusRef = useRef<HTMLDivElement>(null);
  const saveFormRef = useRef<HTMLFormElement>(null);
  const printify = summaries.find((summary: (typeof summaries)[number]) => summary.provider === "printify");
  const printful = summaries.find((summary: (typeof summaries)[number]) => summary.provider === "printful");

  const [printifyApiKey, setPrintifyApiKey] = useState("");
  const [printifyDisplayName, setPrintifyDisplayName] = useState(printify?.displayName ?? "");
  const [printifyFormError, setPrintifyFormError] = useState<string | null>(null);
  const saveErrorMessage = printifyFormError ?? (saveFetcher.data && !saveFetcher.data.ok ? saveFetcher.data.message : null);
  const globalStatus =
    disconnectFetcher.data ??
    syncFetcher.data ??
    (saveFetcher.data?.ok ? saveFetcher.data : null);

  return (
    <>
      <ui-title-bar title="Provider Connections" />

      <div
        ref={statusRef}
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      >
        {saveErrorMessage ?? globalStatus?.message ?? ""}
      </div>

      <s-page>
        <s-section heading="Provider Connections">
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <s-text>
              This page now stores provider configuration state and connection metadata. Full provider sync, live validation,
              variant mapping, and POD cost resolution are still being built.
            </s-text>
            <s-banner tone="info">
              <s-text>
                Current scope: save Printify API credentials, review variant SKU coverage, and track provider readiness without
                pretending sync is already live.
              </s-text>
            </s-banner>
            {saveErrorMessage ? (
              <s-banner tone="critical">
                <s-text>{saveErrorMessage}</s-text>
              </s-banner>
            ) : null}
            {globalStatus?.ok ? (
              <s-banner tone="success">
                <s-text>{globalStatus.message}</s-text>
              </s-banner>
            ) : null}
          </div>
        </s-section>

        <s-section heading="Variant readiness">
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "1.75rem", fontWeight: 650 }}>{totalVariantCount}</div>
              <s-text>Total variants</s-text>
            </div>
            <div>
              <div style={{ fontSize: "1.75rem", fontWeight: 650 }}>{variantsWithSkuCount}</div>
              <s-text>Variants with SKU</s-text>
            </div>
            <div>
              <div style={{ fontSize: "1.75rem", fontWeight: 650 }}>{totalVariantCount - variantsWithSkuCount}</div>
              <s-text>Variants missing SKU</s-text>
            </div>
          </div>
          <div style={{ marginTop: "0.75rem" }}>
            <s-text>Auto-match will depend on clean SKU coverage. Variants without SKUs will stay unmapped until corrected.</s-text>
          </div>
        </s-section>

        <s-section heading="Printify">
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: "0.25rem" }}>
                <strong>Status</strong>
                <s-text>{printify?.note}</s-text>
              </div>
              <s-badge tone={printify?.status === "validated" ? "success" : printify?.configured ? "info" : "warning"}>
                {printify?.status === "validated"
                  ? "Validated"
                  : printify?.configured
                    ? "Stored"
                    : "Not configured"}
              </s-badge>
            </div>

            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
              <div>
                <strong>Mapped variants</strong>
                <div>{printify?.mappedVariantCount ?? 0}</div>
              </div>
              <div>
                <strong>Unmapped variants</strong>
                <div>{printify?.unmappedVariantCount ?? variantsWithSkuCount}</div>
              </div>
              <div>
                <strong>Validated</strong>
                <div>{formatTimestamp(printify?.lastValidatedAt ?? null)}</div>
              </div>
              <div>
                <strong>Last sync</strong>
                <div>{formatTimestamp(printify?.lastSyncedAt ?? null)}</div>
              </div>
            </div>

            {printify?.configured ? (
              <s-banner tone="info">
                <s-text>
                  Stored credential hint: {printify.credentialHint ?? "Stored"}.
                  {printify?.providerAccountName ? ` Connected account: ${printify.providerAccountName}.` : ""}
                </s-text>
              </s-banner>
            ) : null}
            {printify?.lastValidationError ? (
              <s-banner tone="critical">
                <s-text>{printify.lastValidationError}</s-text>
              </s-banner>
            ) : null}
            {printify?.lastSyncError ? (
              <s-banner tone="warning">
                <s-text>{printify.lastSyncError}</s-text>
              </s-banner>
            ) : null}

            {saveErrorMessage ? (
              <s-banner tone="critical">
                <s-text>{saveErrorMessage}</s-text>
              </s-banner>
            ) : null}

            <saveFetcher.Form
              ref={saveFormRef}
              method="post"
              onSubmit={(event) => {
                const trimmedApiKey = printifyApiKey.trim();
                if (!trimmedApiKey) {
                  event.preventDefault();
                  setPrintifyFormError("Printify API key is required.");
                  return;
                }

                setPrintifyFormError(null);
              }}
            >
              <input type="hidden" name="intent" value="save-printify-credentials" />
              <div style={{ display: "grid", gap: "0.75rem" }}>
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor="printify-display-name">Shop label</label>
                  <input
                    id="printify-display-name"
                    name="displayName"
                    type="text"
                    value={printifyDisplayName}
                    onChange={(event) => setPrintifyDisplayName(event.currentTarget.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "0.75rem",
                      borderRadius: "0.75rem",
                      border: "1px solid var(--p-color-border, #c9cccf)",
                      background: "var(--p-color-bg-surface, #fff)",
                      color: "var(--p-color-text, #303030)",
                      font: "inherit",
                    }}
                  />
                </div>
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor="printify-api-key">API key</label>
                  <input
                    id="printify-api-key"
                    name="apiKey"
                    type="password"
                    value={printifyApiKey}
                    onChange={(event) => {
                      setPrintifyApiKey(event.currentTarget.value);
                      if (printifyFormError) {
                        setPrintifyFormError(null);
                      }
                    }}
                    autoComplete="off"
                    required
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "0.75rem",
                      borderRadius: "0.75rem",
                      border: "1px solid var(--p-color-border, #c9cccf)",
                      background: "var(--p-color-bg-surface, #fff)",
                      color: "var(--p-color-text, #303030)",
                      font: "inherit",
                    }}
                  />
                </div>
                <s-text>
                  Credentials are encrypted before persistence. Saving here now validates the API key and records the current
                  Printify account metadata.
                </s-text>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={saveFetcher.state !== "idle"}
                    onClick={() => {
                      const trimmedApiKey = printifyApiKey.trim();
                      if (!trimmedApiKey) {
                        setPrintifyFormError("Printify API key is required.");
                        return;
                      }

                      setPrintifyFormError(null);
                      saveFormRef.current?.requestSubmit();
                    }}
                    style={{
                      appearance: "none",
                      border: 0,
                      borderRadius: "999px",
                      padding: "0.7rem 1.1rem",
                      background: "var(--p-color-bg-fill-brand, #303030)",
                      color: "var(--p-color-text-on-color, #fff)",
                      font: "inherit",
                      fontWeight: 600,
                      cursor: saveFetcher.state !== "idle" ? "not-allowed" : "pointer",
                      opacity: saveFetcher.state !== "idle" ? 0.6 : 1,
                    }}
                  >
                    {printify?.configured ? "Update Printify credentials" : "Save Printify credentials"}
                  </button>
                  {printify?.status === "validated" ? (
                    <syncFetcher.Form method="post">
                      <input type="hidden" name="intent" value="refresh-provider" />
                      <input type="hidden" name="provider" value="printify" />
                      <s-button type="submit" variant="secondary" disabled={syncFetcher.state !== "idle"}>
                        Refresh provider state
                      </s-button>
                    </syncFetcher.Form>
                  ) : null}
                </div>
              </div>
            </saveFetcher.Form>
            {printify?.configured ? (
              <disconnectFetcher.Form method="post">
                <input type="hidden" name="intent" value="disconnect-provider" />
                <input type="hidden" name="provider" value="printify" />
                <s-button type="submit" variant="secondary" tone="critical" disabled={disconnectFetcher.state !== "idle"}>
                  Disconnect Printify
                </s-button>
              </disconnectFetcher.Form>
            ) : null}
          </div>
        </s-section>

        <s-section heading="Printful">
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: "0.25rem" }}>
                <strong>Status</strong>
                <s-text>{printful?.note}</s-text>
              </div>
              <s-badge tone="info">{printful?.configured ? "Configured" : "Planned"}</s-badge>
            </div>
            <s-text>
              Printful OAuth is still deferred. Once it lands, this page will initiate the auth flow and surface the same
              mapping/sync status shown above for Printify.
            </s-text>
          </div>
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[ProviderConnections] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Provider Connections" />
      <s-page>
        <s-banner tone="critical" heading="Provider Connections unavailable">
          <s-text>Something went wrong loading provider configuration. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
