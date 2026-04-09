import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

const ASSET_ROOT = path.resolve(process.cwd(), "extensions/count-on-us-product-widget");

type FixtureMode = "default" | "no-donation";

function buildFixturePayload(mode: FixtureMode) {
  if (mode === "no-donation") {
    return {
      lines: [
        {
          productId: "gid://shopify/Product/9",
          variantId: "gid://shopify/ProductVariant/9",
          quantity: 1,
        },
      ],
      payloads: {
        "gid://shopify/Product/9": {
          productId: "gid://shopify/Product/9",
          visible: false,
          variants: [],
        },
      },
    };
  }

  return {
    lines: [
      {
        productId: "gid://shopify/Product/1",
        variantId: "gid://shopify/ProductVariant/1",
        quantity: 2,
      },
      {
        productId: "gid://shopify/Product/2",
        variantId: "gid://shopify/ProductVariant/2",
        quantity: 1,
      },
    ],
    payloads: {
      "gid://shopify/Product/1": {
        productId: "gid://shopify/Product/1",
        visible: true,
        variants: [
          {
            variantId: "gid://shopify/ProductVariant/1",
            price: "20.00",
            currencyCode: "USD",
            laborCost: "3.00",
            materialLines: [],
            equipmentLines: [],
            shippingMaterialLines: [],
            podCostTotal: "0.00",
            mistakeBufferAmount: "0.00",
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
                estimatedDonationAmount: "5.00",
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
        ],
      },
      "gid://shopify/Product/2": {
        productId: "gid://shopify/Product/2",
        visible: true,
        variants: [
          {
            variantId: "gid://shopify/ProductVariant/2",
            price: "15.00",
            currencyCode: "USD",
            laborCost: "2.00",
            materialLines: [],
            equipmentLines: [],
            shippingMaterialLines: [],
            podCostTotal: "0.00",
            mistakeBufferAmount: "0.00",
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
                donationPercentage: "50.00",
                estimatedDonationAmount: "3.00",
                donationCurrencyCode: "USD",
                donationLink: "https://example.com/neighborhood-arts",
              },
              {
                causeId: "cause-2",
                name: "Community Library",
                iconUrl: null,
                donationPercentage: "50.00",
                estimatedDonationAmount: "3.00",
                donationCurrencyCode: "USD",
                donationLink: null,
              },
            ],
            taxReserve: {
              suppressed: false,
              estimatedRate: "25.00",
              estimatedAmount: "1.00",
            },
          },
        ],
      },
    },
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "no-donation" ? "no-donation" : "default";

  const [css, script] = await Promise.all([
    readFile(path.join(ASSET_ROOT, "assets", "donation-widget.css"), "utf8"),
    readFile(path.join(ASSET_ROOT, "assets", "donation-widget.js"), "utf8"),
  ]);

  return Response.json({
    mode,
    css,
    script,
    fixture: buildFixturePayload(mode),
  });
};

export default function CartDonationSummaryFixtureRoute() {
  const { css, script, fixture, mode } = useLoaderData<typeof loader>();

  const fetchShim = `
    window.__COUNT_ON_US_FIXTURE__ = ${JSON.stringify(fixture)};
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const prefix = "/apps/count-on-us/products/";
      if (url.includes(prefix)) {
        const encodedProductId = url.split(prefix)[1].split("?")[0];
        const productId = decodeURIComponent(encodedProductId);
        const payload = window.__COUNT_ON_US_FIXTURE__.payloads[productId];
        if (!payload) {
          return new Response(JSON.stringify({ ok: false, message: "Missing fixture payload" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ ok: true, data: payload }), {
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
        <title>Cart Donation Summary Fixture</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f6f3eb", margin: 0, padding: "2rem" }}>
        <main style={{ maxWidth: "48rem", margin: "0 auto", display: "grid", gap: "1rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Cart donation summary fixture</h1>
          <p style={{ margin: 0, color: "#4b5563" }}>
            Mode: <strong>{mode}</strong>
          </p>

          <div className="count-on-us-widget" data-count-on-us-cart-summary data-proxy-base="/apps/count-on-us">
            <div className="count-on-us-widget__header">
              <h3 className="count-on-us-widget__heading">See your donation impact</h3>
              <p className="count-on-us-widget__description">
                Open a cart-level view of the estimated donation totals across the causes in your cart.
              </p>
            </div>

            <button
              type="button"
              className="count-on-us-widget__toggle"
              data-count-on-us-cart-trigger
              aria-haspopup="dialog"
              aria-expanded="false"
            >
              <span>See your donation impact</span>
              <span aria-hidden="true">+</span>
            </button>

            <script
              type="application/json"
              data-count-on-us-cart-lines
              dangerouslySetInnerHTML={{ __html: JSON.stringify(fixture.lines) }}
            />
          </div>

          <button type="button">Focusable control after widget</button>
        </main>

        <script dangerouslySetInnerHTML={{ __html: fetchShim }} />
        <script dangerouslySetInnerHTML={{ __html: script }} />
      </body>
    </html>
  );
}
