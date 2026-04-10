import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

const ASSET_ROOT = path.resolve(process.cwd(), "extensions/count-on-us-product-widget");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const [css, script] = await Promise.all([
    readFile(path.join(ASSET_ROOT, "assets", "donation-widget.css"), "utf8"),
    readFile(path.join(ASSET_ROOT, "assets", "product-donation-widget.js"), "utf8"),
  ]);

  const payload = {
    productId: "gid://shopify/Product/1",
    deliveryMode: "preload",
    visible: true,
    totalLineItemCount: 12,
    variants: [
      {
        variantId: "gid://shopify/ProductVariant/101",
        price: "20.00",
        currencyCode: "USD",
        laborCost: "3.00",
        materialLines: [{ name: "Paper", type: "production", lineCost: "2.00" }],
        equipmentLines: [{ name: "Press", lineCost: "1.00" }],
        shippingMaterialLines: [{ name: "Mailer", lineCost: "0.50" }],
        podCostTotal: "0.00",
        mistakeBufferAmount: "0.50",
        shopifyFees: {
          processingRate: "2.90",
          processingFlatFee: "0.30",
          managedMarketsRate: "0.00",
          managedMarketsApplicable: false,
        },
        causes: [
          {
            causeId: "cause-1",
            name: "Neighborhood Arts",
            iconUrl: null,
            donationPercentage: "100.00",
            estimatedDonationAmount: "4.00",
            donationCurrencyCode: "USD",
            donationLink: "https://example.com/neighborhood-arts",
          },
        ],
        taxReserve: {
          suppressed: false,
          estimatedRate: "25.00",
          estimatedAmount: "1.00",
        },
      },
      {
        variantId: "gid://shopify/ProductVariant/202",
        price: "35.00",
        currencyCode: "USD",
        laborCost: "5.00",
        materialLines: [{ name: "Canvas", type: "production", lineCost: "4.00" }],
        equipmentLines: [{ name: "Printer", lineCost: "2.00" }],
        shippingMaterialLines: [{ name: "Tube", lineCost: "1.25" }],
        podCostTotal: "0.00",
        mistakeBufferAmount: "0.75",
        shopifyFees: {
          processingRate: "2.90",
          processingFlatFee: "0.30",
          managedMarketsRate: "0.00",
          managedMarketsApplicable: false,
        },
        causes: [
          {
            causeId: "cause-2",
            name: "Community Library",
            iconUrl: null,
            donationPercentage: "100.00",
            estimatedDonationAmount: "8.00",
            donationCurrencyCode: "USD",
            donationLink: null,
          },
        ],
        taxReserve: {
          suppressed: false,
          estimatedRate: "25.00",
          estimatedAmount: "2.00",
        },
      },
    ],
  };

  return Response.json({
    host: url.host,
    css,
    script,
    payload,
  });
};

export default function ProductDonationWidgetFixtureRoute() {
  const { host, css, script, payload } = useLoaderData<typeof loader>();

  const fetchShim = `
    const fixturePayload = ${JSON.stringify(payload)};
    const expectedMetadataPath = "/apps/count-on-us/products/" + encodeURIComponent(fixturePayload.productId) + "?metadataOnly=1";
    const expectedPayloadPath = "/apps/count-on-us/products/" + encodeURIComponent(fixturePayload.productId);
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, window.location.origin);
      const pathWithQuery = requestUrl.pathname + requestUrl.search;
      if (pathWithQuery === expectedMetadataPath) {
        return new Response(JSON.stringify({
          data: {
            productId: fixturePayload.productId,
            deliveryMode: fixturePayload.deliveryMode,
            visible: fixturePayload.visible,
            totalLineItemCount: fixturePayload.totalLineItemCount
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (pathWithQuery === expectedPayloadPath) {
        return new Response(JSON.stringify({ data: fixturePayload }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
  `;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Product Donation Widget Fixture</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f6f3eb", margin: 0, padding: "2rem" }}>
        <main style={{ maxWidth: "48rem", margin: "0 auto", display: "grid", gap: "1rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Product donation widget fixture</h1>
          <form action="/cart/add" method="post" style={{ display: "grid", gap: "0.75rem" }}>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Variant</span>
              <select name="id" defaultValue="101">
                <option value="101">Sticker</option>
                <option value="202">Canvas print</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Quantity</span>
              <input name="quantity" type="number" min="1" defaultValue="1" />
            </label>

            <div
              className="count-on-us-widget"
              data-count-on-us-widget
              data-product-id="gid://shopify/Product/1"
              data-selected-variant-id="gid://shopify/ProductVariant/101"
              data-selected-quantity="1"
              data-proxy-base="/apps/count-on-us"
            >
              <div className="count-on-us-widget__header">
                <h3 className="count-on-us-widget__heading">See your donation impact</h3>
                <p className="count-on-us-widget__description">
                  Preview the cost breakdown, estimated donation by cause, and estimated tax reserve for this product.
                </p>
              </div>

              <button
                type="button"
                className="count-on-us-widget__toggle"
                data-count-on-us-toggle
                aria-expanded="false"
                aria-controls="count-on-us-widget-panel-fixture"
              >
                <span>See how we calculate this</span>
                <span aria-hidden="true">+</span>
              </button>

              <div
                id="count-on-us-widget-panel-fixture"
                className="count-on-us-widget__panel"
                data-count-on-us-panel
                hidden
              ></div>

              <div className="count-on-us-widget__visually-hidden" aria-live="polite" data-count-on-us-live></div>
            </div>
          </form>
          <p style={{ margin: 0, color: "#4b5563" }}>Host: {host}</p>
        </main>

        <script dangerouslySetInnerHTML={{ __html: fetchShim }} />
        <script dangerouslySetInnerHTML={{ __html: script }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.__COUNT_ON_US_PRODUCT_WIDGET_READY__ = false;
              window.__COUNT_ON_US_PRODUCT_WIDGET_OPEN__ = false;

              const markReady = () => {
                const widget = document.querySelector("[data-count-on-us-widget]");
                if (!widget) return false;

                if (widget.dataset.widgetInteractive === "true" && widget.dataset.widgetBound === "true") {
                  window.__COUNT_ON_US_PRODUCT_WIDGET_READY__ = true;
                  return true;
                }

                return false;
              };

              const triggerBoot = () => {
                document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
                window.dispatchEvent(new Event("load"));
              };

              const openWidget = () => {
                const toggle = document.querySelector("[data-count-on-us-toggle]");
                const panel = document.querySelector("[data-count-on-us-panel]");
                if (!toggle || !panel) return false;

                if (toggle.getAttribute("aria-expanded") !== "true") {
                  toggle.click();
                }

                if (toggle.getAttribute("aria-expanded") === "true" && !panel.hidden) {
                  window.__COUNT_ON_US_PRODUCT_WIDGET_OPEN__ = true;
                  return true;
                }

                return false;
              };

              triggerBoot();

              const ensureReady = () => {
                if (markReady() && openWidget()) return;
                triggerBoot();
                window.setTimeout(ensureReady, 50);
              };

              ensureReady();
            `,
          }}
        />
      </body>
    </html>
  );
}
