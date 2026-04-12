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
    ? (async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url.includes("/v1/shops.json")) {
          return new Response(
            JSON.stringify({
              data: [{ id: 1234, title: "Fixture Shop" }],
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
              },
            },
          );
        }

        if (url.includes("/v1/shops/1234/products.json")) {
          return new Response(
            JSON.stringify({
              current_page: 1,
              last_page: 1,
              data: [
                {
                  id: "printify_product_1",
                  title: "Provider Fixture Product",
                  blueprint_id: 11,
                  print_provider_id: 22,
                  updated_at: "2026-04-10T15:00:00Z",
                  variants: [
                    {
                      id: 7001,
                      title: "Mapped-ready Variant",
                      sku: "SKU-READY-001",
                      cost: 875,
                    },
                  ],
                },
              ],
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
              },
            },
          );
        }

        return new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }) as typeof fetch
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
      message: "Printify credentials validated and saved. Run a sync to import SKU matches and cached POD costs.",
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
          ? "Printify sync queued. This refreshes account state, SKU matches, and cached POD costs."
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

function formatEstimatedExpiry(value: string | null) {
  if (!value) return "Not available";

  const expiry = new Date(value);
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return `${expiry.toLocaleDateString()} (estimated expired)`;
  }

  if (diffDays === 0) {
    return `${expiry.toLocaleDateString()} (estimated today)`;
  }

  return `${expiry.toLocaleDateString()} (estimated in ${diffDays} day${diffDays === 1 ? "" : "s"})`;
}

export default function ProviderConnectionsPage() {
  const { totalVariantCount, variantsWithSkuCount, printifyUnresolvedVariants, summaries } = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<{ ok: boolean; message: string }>();
  const syncFetcher = useFetcher<{ ok: boolean; message: string }>();
  const disconnectFetcher = useFetcher<{ ok: boolean; message: string }>();
  const statusRef = useRef<HTMLDivElement>(null);
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

  function submitPrintifyCredentials() {
    const trimmedApiKey = printifyApiKey.trim();
    if (!trimmedApiKey) {
      setPrintifyFormError("Printify API key is required.");
      return;
    }

    setPrintifyFormError(null);
    const formData = new FormData();
    formData.append("intent", "save-printify-credentials");
    formData.append("displayName", printifyDisplayName);
    formData.append("apiKey", trimmedApiKey);
    saveFetcher.submit(formData, { method: "post" });
  }

  function submitPrintifySync() {
    const formData = new FormData();
    formData.append("intent", "refresh-provider");
    formData.append("provider", "printify");
    syncFetcher.submit(formData, { method: "post" });
  }

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
              Provider Connections now validates Printify credentials and tracks sync state. The active rollout focus is
              importing provider mappings and POD cost inputs cleanly before we broaden the UI further.
            </s-text>
            <s-banner tone="info">
              <s-text>
                Current scope: validate Printify credentials, import Printify SKUs, auto-match unique SKU overlaps, and
                cache provider fulfillment costs. Shopify variants that are not fulfilled through Printify can remain
                unmapped and continue using manual cost configuration.
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
            <s-text>
              SKU coverage only affects automatic provider matching. Variants without SKUs can still stay manual; add or
              clean up SKUs when you want Printify-backed costs to sync automatically.
            </s-text>
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
                <strong>Token added</strong>
                <div>{formatTimestamp(printify?.credentialUpdatedAt ?? null)}</div>
              </div>
              <div>
                <strong>Estimated expiry</strong>
                <div>{formatEstimatedExpiry(printify?.credentialExpiresAt ?? null)}</div>
              </div>
              <div>
                <strong>Validated</strong>
                <div>{formatTimestamp(printify?.lastValidatedAt ?? null)}</div>
              </div>
              <div>
                <strong>Last sync</strong>
                <div>{formatTimestamp(printify?.lastSyncedAt ?? null)}</div>
              </div>
              <div>
                <strong>Cached POD lines</strong>
                <div>{printify?.latestCachedCostCount ?? 0}</div>
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
            {printify?.status === "sync_failed" ? (
              <s-banner tone="critical">
                <s-text>
                  Printify credentials may no longer be working. Reconnect the token if this keeps failing, especially if the
                  estimated expiry date has passed.
                </s-text>
              </s-banner>
            ) : null}
            {printify?.lastSyncError ? (
              <s-banner tone="warning">
                <s-text>{printify.lastSyncError}</s-text>
              </s-banner>
            ) : null}
            {printify?.latestSyncRunStatus === null && printify?.configured ? (
              <s-banner tone="info">
                <s-text>Run your first Printify sync to populate SKU matches and cached POD cost lines.</s-text>
              </s-banner>
            ) : null}
            {printify?.latestSyncRunStatus === "completed" && printifyUnresolvedVariants.length === 0 ? (
              <s-banner tone="success">
                <s-text>All uniquely matchable SKU overlaps are currently mapped to Printify.</s-text>
              </s-banner>
            ) : null}
            {printify?.latestSyncRunStatus === "completed" && printifyUnresolvedVariants.length > 0 ? (
              <s-banner tone="warning">
                <s-text>
                  {printifyUnresolvedVariants.length} variant{printifyUnresolvedVariants.length === 1 ? "" : "s"} still
                  could not be auto-matched to Printify. Review these only if you expect them to use provider-backed POD
                  costs.
                </s-text>
              </s-banner>
            ) : null}

            {saveErrorMessage ? (
              <s-banner tone="critical">
                <s-text>{saveErrorMessage}</s-text>
              </s-banner>
            ) : null}

            <saveFetcher.Form
              method="post"
              onSubmit={(event) => {
                event.preventDefault();
                submitPrintifyCredentials();
              }}
            >
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
                <s-banner tone="info">
                  <s-text>
                    Required Printify token scopes for the current rollout: <code>shops.read</code> and <code>products.read</code>.
                    Printify personal access tokens currently expire after 1 year.
                  </s-text>
                </s-banner>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={saveFetcher.state !== "idle"}
                    onClick={() => {
                      submitPrintifyCredentials();
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
                  {printify?.status === "validated" || printify?.status === "sync_failed" ? (
                    <button
                      type="button"
                      disabled={syncFetcher.state !== "idle"}
                      onClick={submitPrintifySync}
                      style={{
                        appearance: "none",
                        border: "1px solid var(--p-color-border, #d2d5d8)",
                        borderRadius: "999px",
                        padding: "0.7rem 1.1rem",
                        background: "var(--p-color-bg-surface, #fff)",
                        color: "var(--p-color-text, #303030)",
                        font: "inherit",
                        fontWeight: 600,
                        cursor: syncFetcher.state !== "idle" ? "not-allowed" : "pointer",
                        opacity: syncFetcher.state !== "idle" ? 0.6 : 1,
                      }}
                    >
                      Sync Printify catalog
                    </button>
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

            {printify?.latestSyncRunStatus === "completed" && printifyUnresolvedVariants.length > 0 ? (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                <strong>Needs review</strong>
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  {printifyUnresolvedVariants.map((variant: (typeof printifyUnresolvedVariants)[number]) => (
                    <div
                      key={variant.variantId}
                      style={{
                        border: "1px solid var(--p-color-border, #d0d5dd)",
                        borderRadius: "0.75rem",
                        padding: "0.85rem 1rem",
                        background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
                        display: "grid",
                        gap: "0.25rem",
                      }}
                    >
                      <strong>
                        {variant.productTitle} · {variant.variantTitle}
                      </strong>
                      <s-text>SKU: {variant.sku}</s-text>
                      <s-text>{variant.reason}</s-text>
                    </div>
                  ))}
                </div>
                <s-text>
                  Unresolved variants continue using manual cost configuration where available. Manual provider mapping lands
                  in a follow-on slice.
                </s-text>
              </div>
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
