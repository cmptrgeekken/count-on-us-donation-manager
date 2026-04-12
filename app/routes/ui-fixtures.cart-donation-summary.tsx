import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

const ASSET_ROOT = path.resolve(process.cwd(), "extensions/count-on-us-product-widget");

type FixtureMode = "default" | "mixed-no-cause" | "no-donation" | "duplicate-product";
type FixtureLine = {
  productId: string;
  variantId: string;
  quantity: number;
  lineSubtotal?: number;
};

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

  if (mode === "mixed-no-cause") {
    return {
      lines: [
        {
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 2,
          lineSubtotal: 40,
        },
        {
          productId: "gid://shopify/Product/2",
          variantId: "gid://shopify/ProductVariant/2",
          quantity: 1,
          lineSubtotal: 15,
        },
        {
          productId: "gid://shopify/Product/3",
          variantId: "gid://shopify/ProductVariant/3",
          quantity: 1,
          lineSubtotal: 30,
        },
      ],
      payloads: {
        "gid://shopify/Product/1": {
          productId: "gid://shopify/Product/1",
          visible: true,
          variants: [
            {
              variantId: "gid://shopify/ProductVariant/1",
              price: "40.00",
              currencyCode: "USD",
              laborCost: "6.00",
              materialLines: [{ name: "Paper", lineCost: "1.50" }],
              equipmentLines: [{ name: "Press", lineCost: "0.75" }],
              shippingMaterialLines: [{ name: "Mailer", lineCost: "0.40" }],
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
                  estimatedDonationAmount: "20.73",
                  donationCurrencyCode: "USD",
                  donationLink: "https://example.com/neighborhood-arts",
                },
              ],
              taxReserve: {
                suppressed: false,
                estimatedRate: "25.00",
                estimatedAmount: "6.91",
              },
              reconciliation: {
                estimatedTotal: "40.00",
                allocatedDonations: "20.73",
                retainedByShop: "0.00",
                labor: "6.00",
                materials: "3.00",
                equipment: "1.50",
                packaging: "0.40",
                pod: "0.00",
                mistakeBuffer: "0.00",
                shopifyFees: "1.46",
                taxReserve: "6.91",
                remainder: "0.00",
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
              materialLines: [{ name: "Ink", lineCost: "2.00" }],
              equipmentLines: [{ name: "Printer", lineCost: "1.25" }],
              shippingMaterialLines: [{ name: "Box", lineCost: "0.60" }],
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
                  estimatedDonationAmount: "3.15",
                  donationCurrencyCode: "USD",
                  donationLink: "https://example.com/neighborhood-arts",
                },
                {
                  causeId: "cause-2",
                  name: "Community Library",
                  iconUrl: null,
                  donationPercentage: "50.00",
                  estimatedDonationAmount: "3.16",
                  donationCurrencyCode: "USD",
                  donationLink: null,
                },
              ],
              taxReserve: {
                suppressed: false,
                estimatedRate: "25.00",
                estimatedAmount: "2.10",
              },
              reconciliation: {
                estimatedTotal: "15.00",
                allocatedDonations: "6.31",
                retainedByShop: "0.00",
                labor: "2.00",
                materials: "2.00",
                equipment: "1.25",
                packaging: "0.60",
                pod: "0.00",
                mistakeBuffer: "0.00",
                shopifyFees: "0.74",
                taxReserve: "2.10",
                remainder: "0.00",
              },
            },
          ],
        },
        "gid://shopify/Product/3": {
          productId: "gid://shopify/Product/3",
          visible: false,
          variants: [
            {
              variantId: "gid://shopify/ProductVariant/3",
              price: "30.00",
              currencyCode: "USD",
              laborCost: "4.00",
              materialLines: [{ name: "Canvas", lineCost: "5.00" }],
              equipmentLines: [{ name: "Cutter", lineCost: "1.00" }],
              shippingMaterialLines: [{ name: "Sleeve", lineCost: "0.50" }],
              podCostTotal: "0.00",
              mistakeBufferAmount: "0.50",
              shopifyFees: {
                processingRate: "2.90",
                processingFlatFee: "0.30",
                managedMarketsRate: "0.00",
                managedMarketsApplicable: false,
              },
              causes: [],
              taxReserve: {
                suppressed: false,
                estimatedRate: "25.00",
                estimatedAmount: "4.52",
              },
              reconciliation: {
                estimatedTotal: "30.00",
                allocatedDonations: "0.00",
                retainedByShop: "14.03",
                labor: "4.00",
                materials: "5.00",
                equipment: "1.00",
                packaging: "0.50",
                pod: "0.00",
                mistakeBuffer: "0.50",
                shopifyFees: "0.45",
                taxReserve: "4.52",
                remainder: "0.00",
              },
            },
          ],
        },
      },
    };
  }

  if (mode === "duplicate-product") {
    return {
      lines: [
        {
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/1",
          quantity: 2,
          lineSubtotal: 40,
        },
        {
          productId: "gid://shopify/Product/2",
          variantId: "gid://shopify/ProductVariant/2",
          quantity: 1,
          lineSubtotal: 15,
        },
        {
          productId: "gid://shopify/Product/1",
          variantId: "gid://shopify/ProductVariant/4",
          quantity: 1,
          lineSubtotal: 34,
        },
      ],
      payloads: {
        "gid://shopify/Product/1": {
          productId: "gid://shopify/Product/1",
          visible: true,
          variants: [
            {
              variantId: "gid://shopify/ProductVariant/1",
              price: "40.00",
              currencyCode: "USD",
              laborCost: "6.00",
              materialLines: [{ name: "Paper", lineCost: "1.50" }],
              equipmentLines: [{ name: "Press", lineCost: "0.75" }],
              shippingMaterialLines: [{ name: "Mailer", lineCost: "0.40" }],
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
                  estimatedDonationAmount: "20.73",
                  donationCurrencyCode: "USD",
                  donationLink: "https://example.com/neighborhood-arts",
                },
              ],
              taxReserve: {
                suppressed: false,
                estimatedRate: "25.00",
                estimatedAmount: "6.91",
              },
              reconciliation: {
                estimatedTotal: "40.00",
                allocatedDonations: "20.73",
                retainedByShop: "0.00",
                labor: "6.00",
                materials: "3.00",
                equipment: "1.50",
                packaging: "0.40",
                pod: "0.00",
                mistakeBuffer: "0.00",
                shopifyFees: "1.46",
                taxReserve: "6.91",
                remainder: "0.00",
              },
            },
            {
              variantId: "gid://shopify/ProductVariant/4",
              price: "34.00",
              currencyCode: "USD",
              laborCost: "4.00",
              materialLines: [{ name: "Cotton", lineCost: "4.50" }],
              equipmentLines: [{ name: "Press", lineCost: "1.00" }],
              shippingMaterialLines: [{ name: "Mailer", lineCost: "0.40" }],
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
                  donationPercentage: "60.00",
                  estimatedDonationAmount: "10.68",
                  donationCurrencyCode: "USD",
                  donationLink: "https://example.com/neighborhood-arts",
                },
                {
                  causeId: "cause-2",
                  name: "Community Library",
                  iconUrl: null,
                  donationPercentage: "40.00",
                  estimatedDonationAmount: "7.12",
                  donationCurrencyCode: "USD",
                  donationLink: null,
                },
              ],
              taxReserve: {
                suppressed: false,
                estimatedRate: "25.00",
                estimatedAmount: "5.93",
              },
              reconciliation: {
                estimatedTotal: "34.00",
                allocatedDonations: "17.80",
                retainedByShop: "0.00",
                labor: "4.00",
                materials: "4.50",
                equipment: "1.00",
                packaging: "0.40",
                pod: "0.00",
                mistakeBuffer: "0.00",
                shopifyFees: "1.29",
                taxReserve: "5.93",
                remainder: "0.00",
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
              materialLines: [{ name: "Ink", lineCost: "2.00" }],
              equipmentLines: [{ name: "Printer", lineCost: "1.25" }],
              shippingMaterialLines: [{ name: "Box", lineCost: "0.60" }],
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
                  estimatedDonationAmount: "3.15",
                  donationCurrencyCode: "USD",
                  donationLink: "https://example.com/neighborhood-arts",
                },
                {
                  causeId: "cause-2",
                  name: "Community Library",
                  iconUrl: null,
                  donationPercentage: "50.00",
                  estimatedDonationAmount: "3.16",
                  donationCurrencyCode: "USD",
                  donationLink: null,
                },
              ],
              taxReserve: {
                suppressed: false,
                estimatedRate: "25.00",
                estimatedAmount: "2.10",
              },
              reconciliation: {
                estimatedTotal: "15.00",
                allocatedDonations: "6.31",
                retainedByShop: "0.00",
                labor: "2.00",
                materials: "2.00",
                equipment: "1.25",
                packaging: "0.60",
                pod: "0.00",
                mistakeBuffer: "0.00",
                shopifyFees: "0.74",
                taxReserve: "2.10",
                remainder: "0.00",
              },
            },
          ],
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
        lineSubtotal: 40,
      },
      {
        productId: "gid://shopify/Product/2",
        variantId: "gid://shopify/ProductVariant/2",
        quantity: 1,
        lineSubtotal: 15,
      },
    ],
    payloads: {
      "gid://shopify/Product/1": {
        productId: "gid://shopify/Product/1",
        visible: true,
        variants: [
          {
            variantId: "gid://shopify/ProductVariant/1",
            price: "40.00",
            currencyCode: "USD",
            laborCost: "6.00",
            materialLines: [{ name: "Paper", lineCost: "1.50" }],
            equipmentLines: [{ name: "Press", lineCost: "0.75" }],
            shippingMaterialLines: [{ name: "Mailer", lineCost: "0.40" }],
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
                estimatedDonationAmount: "20.73",
                donationCurrencyCode: "USD",
                donationLink: "https://example.com/neighborhood-arts",
              },
            ],
            taxReserve: {
              suppressed: false,
              estimatedRate: "25.00",
              estimatedAmount: "6.91",
            },
            reconciliation: {
              estimatedTotal: "40.00",
              allocatedDonations: "20.73",
              retainedByShop: "0.00",
              labor: "6.00",
              materials: "3.00",
              equipment: "1.50",
              packaging: "0.40",
              pod: "0.00",
              mistakeBuffer: "0.00",
              shopifyFees: "1.46",
              taxReserve: "6.91",
              remainder: "0.00",
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
            materialLines: [{ name: "Ink", lineCost: "2.00" }],
            equipmentLines: [{ name: "Printer", lineCost: "1.25" }],
            shippingMaterialLines: [{ name: "Box", lineCost: "0.60" }],
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
                estimatedDonationAmount: "3.15",
                donationCurrencyCode: "USD",
                donationLink: "https://example.com/neighborhood-arts",
              },
              {
                causeId: "cause-2",
                name: "Community Library",
                iconUrl: null,
                donationPercentage: "50.00",
                estimatedDonationAmount: "3.16",
                donationCurrencyCode: "USD",
                donationLink: null,
              },
            ],
            taxReserve: {
              suppressed: false,
              estimatedRate: "25.00",
              estimatedAmount: "2.10",
            },
            reconciliation: {
              estimatedTotal: "15.00",
              allocatedDonations: "6.31",
              retainedByShop: "0.00",
              labor: "2.00",
              materials: "2.00",
              equipment: "1.25",
              packaging: "0.60",
              pod: "0.00",
              mistakeBuffer: "0.00",
              shopifyFees: "0.74",
              taxReserve: "2.10",
              remainder: "0.00",
            },
          },
        ],
      },
    },
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const rawMode = url.searchParams.get("mode");
  const mode: FixtureMode =
    rawMode === "no-donation"
      ? "no-donation"
      : rawMode === "mixed-no-cause"
        ? "mixed-no-cause"
        : rawMode === "duplicate-product"
          ? "duplicate-product"
          : "default";

  const [css, script] = await Promise.all([
    readFile(path.join(ASSET_ROOT, "assets", "donation-widget.css"), "utf8"),
    readFile(path.join(ASSET_ROOT, "assets", "cart-donation-summary.js"), "utf8"),
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
    window.__COUNT_ON_US_FIXTURE_UNIT_PRICES__ = Object.fromEntries(
      window.__COUNT_ON_US_FIXTURE__.lines.map((line, index) => [
        index,
        line.lineSubtotal != null && line.quantity ? Number(line.lineSubtotal) / Number(line.quantity) : 0,
      ]),
    );
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      const prefix = "/apps/count-on-us/products/";
      if (url.includes("/cart.js")) {
        const items = window.__COUNT_ON_US_FIXTURE__.lines.map((line) => ({
          product_id: Number(String(line.productId).split("/").pop()),
          variant_id: Number(String(line.variantId).split("/").pop()),
          quantity: line.quantity,
          final_line_price: Math.round(Number(line.lineSubtotal || 0) * 100),
        }));

        return new Response(JSON.stringify({ items }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(prefix)) {
        const parsedUrl = new URL(url, window.location.origin);
        const encodedProductId = url.split(prefix)[1].split("?")[0];
        const productId = decodeURIComponent(encodedProductId);
        const payload = window.__COUNT_ON_US_FIXTURE__.payloads[productId];
        if (!payload) {
          return new Response(JSON.stringify({ ok: false, message: "Missing fixture payload" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        const data =
          parsedUrl.searchParams.get("metadataOnly") === "1"
            ? {
                productId: payload.productId,
                deliveryMode: "preload",
                visible: payload.visible,
                totalLineItemCount: payload.variants[0]?.materialLines?.length ?? 0,
              }
            : (() => {
                const requestedVariantId = parsedUrl.searchParams.get("variantId");
                if (!requestedVariantId) {
                  return payload;
                }

                const matchingVariant = payload.variants.find((variant) => variant.variantId === requestedVariantId);
                return {
                  ...payload,
                  variants: matchingVariant ? [matchingVariant] : [],
                  visible: payload.visible && Boolean(matchingVariant),
                };
              })();

        return new Response(JSON.stringify({ ok: true, data }), {
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

          <section style={{ display: "grid", gap: "0.75rem" }}>
            {(fixture.lines as FixtureLine[]).map((line, index) => (
              <article
                key={`${line.productId}-${index}`}
                className="cart-item"
                style={{
                  display: "grid",
                  gap: "0.35rem",
                  padding: "0.85rem 1rem",
                  borderRadius: "14px",
                  background: "#ffffff",
                  border: "1px solid rgba(17, 24, 39, 0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline" }}>
                  <a href={`/products/fixture-${index + 1}`} style={{ color: "#111827", fontWeight: 600, textDecoration: "none" }}>
                    Fixture cart item {index + 1}
                  </a>
                  <span data-fixture-qty style={{ color: "#6b7280", fontSize: "0.92rem" }}>
                    Qty {line.quantity}
                  </span>
                </div>
                <label style={{ display: "grid", gap: "0.25rem", maxWidth: "6rem" }}>
                  <span style={{ color: "#6b7280", fontSize: "0.82rem" }}>Quantity</span>
                  <input name="updates[]" type="number" defaultValue={line.quantity} min="0" />
                </label>
              </article>
            ))}
          </section>

          {mode === "no-donation" ? (
            <p style={{ margin: 0, color: "#6b7280" }}>No donation-linked items in this fixture cart.</p>
          ) : (
            <div
              className="count-on-us-widget count-on-us-widget--cart-summary"
              data-count-on-us-cart-summary
              data-proxy-base="/apps/count-on-us"
              data-count-on-us-cart-lines-json={encodeURIComponent(JSON.stringify(fixture.lines))}
            >
              <div className="count-on-us-widget__header">
                <h3 className="count-on-us-widget__heading">Your purchase is making a difference!</h3>
                <p className="count-on-us-widget__description">
                  Open a cart-level view of the causes your purchase supports and how the estimate is calculated.
                </p>
              </div>

              <button
                type="button"
                className="count-on-us-widget__toggle"
                data-count-on-us-cart-trigger
                aria-haspopup="dialog"
                aria-expanded="false"
              >
                <span>See donation details</span>
              </button>

              <script
                type="application/json"
                data-count-on-us-cart-lines
                dangerouslySetInnerHTML={{ __html: JSON.stringify(fixture.lines) }}
              />
            </div>
          )}

          <button type="button">Focusable control after widget</button>
        </main>

        <script dangerouslySetInnerHTML={{ __html: fetchShim }} />
        <script dangerouslySetInnerHTML={{ __html: script }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              document.querySelectorAll('.cart-item input[name="updates[]"]').forEach((input, index) => {
                input.addEventListener('input', (event) => {
                  const target = event.currentTarget;
                  const quantity = Math.max(0, Number.parseInt(target.value || '0', 10) || 0);
                  const unitPrice = window.__COUNT_ON_US_FIXTURE_UNIT_PRICES__[index] || 0;

                  if (quantity === 0) {
                    window.__COUNT_ON_US_FIXTURE__.lines.splice(index, 1);
                    target.closest('.cart-item')?.remove();
                    return;
                  }

                  const line = window.__COUNT_ON_US_FIXTURE__.lines[index];
                  if (!line) return;
                  line.quantity = quantity;
                  line.lineSubtotal = Number((unitPrice * quantity).toFixed(2));
                  const qtyNode = target.closest('.cart-item')?.querySelector('[data-fixture-qty]');
                  if (qtyNode) qtyNode.textContent = 'Qty ' + quantity;
                });
              });

              document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
            `,
          }}
        />
      </body>
    </html>
  );
}
