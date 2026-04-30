import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

const ASSET_ROOT = path.resolve(process.cwd(), "extensions/count-on-us-product-widget");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const showLineItemDetails = url.searchParams.get("lineDetails") === "1";
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
        reconciliation: {
          estimatedTotal: "20.00",
          allocatedDonations: "4.00",
          retainedByShop: "5.97",
          labor: "3.00",
          materials: "2.00",
          equipment: "1.00",
          packaging: "0.50",
          pod: "0.00",
          mistakeBuffer: "0.50",
          shopifyFees: "2.03",
          taxReserve: "1.00",
          remainder: "0.00",
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
        reconciliation: {
          estimatedTotal: "35.00",
          allocatedDonations: "8.00",
          retainedByShop: "11.93",
          labor: "5.00",
          materials: "4.00",
          equipment: "2.00",
          packaging: "1.25",
          pod: "0.00",
          mistakeBuffer: "0.75",
          shopifyFees: "2.07",
          taxReserve: "2.00",
          remainder: "0.00",
        },
      },
    ],
  };

  return Response.json({
    host: url.host,
    css,
    script,
    payload,
    showLineItemDetails,
  });
};

export default function ProductDonationWidgetFixtureRoute() {
  const { host, css, script, payload, showLineItemDetails } = useLoaderData<typeof loader>();

  const fetchShim = `
    const fixturePayload = ${JSON.stringify(payload)};
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = new URL(typeof input === "string" ? input : input.url, window.location.origin);
      const prefix = "/apps/count-on-us/products/";
      if (requestUrl.pathname.startsWith(prefix)) {
        const encodedProductId = requestUrl.pathname.slice(prefix.length);
        const productId = decodeURIComponent(encodedProductId);
        if (productId !== fixturePayload.productId) {
          return new Response(JSON.stringify({ ok: false, message: "Missing fixture payload" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (requestUrl.searchParams.get("metadataOnly") === "1") {
          return new Response(JSON.stringify({
            data: {
              productId: fixturePayload.productId,
              deliveryMode: fixturePayload.deliveryMode,
              visible: fixturePayload.visible,
              totalLineItemCount: fixturePayload.totalLineItemCount
            }
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }

        return new Response(JSON.stringify({
          data: fixturePayload
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    };
  `;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <main style={{ maxWidth: "48rem", margin: "0 auto", display: "grid", gap: "1rem", padding: "2rem" }}>
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
            data-show-line-item-details={showLineItemDetails ? "true" : "false"}
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

            triggerBoot();

            const ensureReady = () => {
              if (markReady()) return;
              triggerBoot();
              window.setTimeout(ensureReady, 50);
            };

            ensureReady();
          `,
        }}
      />
    </>
  );
}
