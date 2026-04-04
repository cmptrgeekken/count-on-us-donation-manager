import { useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";

import { prisma } from "../db.server";
import { authenticate } from "../shopify.server";
import { useAppLocalization } from "../utils/use-app-localization";

const SHOP_CURRENCY_QUERY = `#graphql
  query ShopCurrency {
    shop {
      currencyCode
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopId },
    select: {
      planTier: true,
      paymentRate: true,
      planOverride: true,
      currency: true,
      mistakeBuffer: true,
      defaultLaborRate: true,
    },
  });

  return Response.json({
    planTier: shop?.planTier ?? "Unknown",
    paymentRate: shop?.paymentRate ? (Number(shop.paymentRate) * 100).toFixed(2) : null,
    planOverride: shop?.planOverride ?? false,
    mistakeBuffer: shop?.mistakeBuffer ? (Number(shop.mistakeBuffer) * 100).toFixed(2) : "",
    defaultLaborRate: shop?.defaultLaborRate ? Number(shop.defaultLaborRate).toFixed(2) : "",
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "enable-override") {
    await prisma.shop.update({
      where: { shopId },
      data: { planOverride: true },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "Shop",
        action: "PLAN_OVERRIDE_ENABLED",
        actor: "merchant",
      },
    });

    return Response.json({ ok: true, message: "Manual rate override enabled." });
  }

  if (intent === "disable-override") {
    await prisma.shop.update({
      where: { shopId },
      data: { planOverride: false },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "Shop",
        action: "PLAN_OVERRIDE_DISABLED",
        actor: "merchant",
      },
    });

    return Response.json({ ok: true, message: "Manual override removed. Daily detection will resume." });
  }

  if (intent === "update-rate") {
    const rateStr = formData.get("paymentRate")?.toString() ?? "";
    const rate = parseFloat(rateStr);

    if (isNaN(rate) || rate < 0 || rate > 100) {
      return Response.json({ ok: false, message: "Rate must be a number between 0 and 100." }, { status: 400 });
    }

    await prisma.shop.update({
      where: { shopId },
      data: { paymentRate: rate / 100 },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "Shop",
        action: "PAYMENT_RATE_UPDATED",
        actor: "merchant",
        payload: { paymentRate: rate / 100 },
      },
    });

    return Response.json({ ok: true, message: "Payment rate updated." });
  }

  if (intent === "update-cost-defaults") {
    const rateStr = formData.get("mistakeBuffer")?.toString() ?? "";
    const rate = parseFloat(rateStr);

    const defaultLaborRateStr = formData.get("defaultLaborRate")?.toString().trim() ?? "";
    const defaultLaborRate = defaultLaborRateStr ? parseFloat(defaultLaborRateStr) : null;

    if (isNaN(rate) || rate < 0 || rate > 100) {
      return Response.json({ ok: false, message: "Mistake buffer must be a number between 0 and 100." }, { status: 400 });
    }

    if (defaultLaborRate !== null && (isNaN(defaultLaborRate) || defaultLaborRate < 0)) {
      return Response.json({ ok: false, message: "Labor rate must be 0 or greater." }, { status: 400 });
    }

    await prisma.shop.update({
      where: { shopId },
      data: {
        mistakeBuffer: rate / 100,
        defaultLaborRate,
      },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "Shop",
        action: "COST_DEFAULTS_UPDATED",
        actor: "merchant",
        payload: { mistakeBuffer: rate / 100, defaultLaborRate },
      },
    });

    return Response.json({ ok: true, message: "Cost defaults updated." });
  }

  if (intent === "refresh-shop-currency") {
    const response = await admin.graphql(SHOP_CURRENCY_QUERY);
    const json = await response.json();
    const currency = json?.data?.shop?.currencyCode;

    if (typeof currency !== "string" || currency.length !== 3) {
      console.error("[Settings] Failed to refresh shop currency:", json);
      return Response.json({ ok: false, message: "Unable to refresh shop currency from Shopify." }, { status: 502 });
    }

    await prisma.shop.update({
      where: { shopId },
      data: { currency },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "Shop",
        action: "SHOP_CURRENCY_REFRESHED",
        actor: "merchant",
        payload: { currency },
      },
    });

    return Response.json({ ok: true, message: `Shop currency refreshed to ${currency}.` });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

export default function Settings() {
  const { planTier, paymentRate, planOverride, mistakeBuffer, defaultLaborRate } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const { currency, locale, formatMoney, formatPct, getCurrencySymbol } = useAppLocalization();

  const statusRef = useRef<HTMLDivElement>(null);
  const [rateInput, setRateInput] = useState(paymentRate ?? "");
  const [bufferInput, setBufferInput] = useState(mistakeBuffer ?? "");
  const [laborRateInput, setLaborRateInput] = useState(defaultLaborRate ?? "");

  const isSubmitting = fetcher.state !== "idle";
  const statusMessage = fetcher.data?.message ?? "";

  return (
    <>
      <ui-title-bar title="Settings" />

      <div
        ref={statusRef}
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      >
        {statusMessage}
      </div>

      <s-page>
        <s-section heading="Shopify Payments">
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: "0.25rem" }}>
                <strong>Plan</strong>
                <s-text>Your current Shopify plan, used to look up your payment processing rate.</s-text>
              </div>
              <div>{planTier}</div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: "0.25rem" }}>
                <strong>Payment processing rate</strong>
                <s-text>
                  {planOverride ? "Manually set - daily auto-detection paused." : "Auto-detected daily from your plan."}
                </s-text>
              </div>
              <div>{paymentRate !== null ? formatPct(Number(paymentRate) / 100) : "Not detected"}</div>
            </div>

            {planOverride && (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="update-rate" />
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <s-text-field
                    label="Override rate (%)"
                    name="paymentRate"
                    value={rateInput}
                    onChange={(event) => setRateInput((event.currentTarget as HTMLInputElement).value)}
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                  />
                  <s-text>Enter the percentage as a number, for example 2.90.</s-text>
                  <div>
                    <s-button type="submit" disabled={isSubmitting}>Save</s-button>
                  </div>
                </div>
              </fetcher.Form>
            )}

            <fetcher.Form method="post">
              <input type="hidden" name="intent" value={planOverride ? "disable-override" : "enable-override"} />
              <s-button
                type="submit"
                disabled={isSubmitting}
                variant={planOverride ? "secondary" : "primary"}
                tone={planOverride ? "critical" : undefined}
              >
                {planOverride ? "Remove override and resume auto-detection" : "Set a manual rate override"}
              </s-button>
            </fetcher.Form>
          </div>
        </s-section>

        <s-section heading="Cost Defaults">
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="update-cost-defaults" />
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <s-text-field
                label="Mistake buffer (%)"
                name="mistakeBuffer"
                value={bufferInput}
                onChange={(event) => setBufferInput((event.currentTarget as HTMLInputElement).value)}
                type="number"
                min={0}
                max={100}
                step={0.1}
              />
              <s-text>
                Example: 5 = {formatPct(0.05)}. Added to production material costs to account for waste.
              </s-text>
              <s-text-field
                label={`Default labor rate (${getCurrencySymbol()}/hr)`}
                name="defaultLaborRate"
                value={laborRateInput}
                onChange={(event) => setLaborRateInput((event.currentTarget as HTMLInputElement).value)}
                type="number"
                min={0}
                step={0.1}
              />
              <s-text>
                Example: {formatMoney(15)}/hr. Leave blank to remove the shop default labor rate.
              </s-text>
              <div>
                <s-button type="submit" disabled={isSubmitting}>Save cost defaults</s-button>
              </div>
            </div>
          </fetcher.Form>
        </s-section>

        <s-section heading="Localization">
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: "0.25rem" }}>
                <strong>Shop currency</strong>
                <s-text>
                  Used throughout the admin when formatting money values. Refresh this if your Shopify store currency changed.
                </s-text>
              </div>
              <div>{currency}</div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: "0.25rem" }}>
                <strong>Active locale</strong>
                <s-text>
                  Derived from the current admin request and used for number formatting in this session.
                </s-text>
              </div>
              <div>{locale}</div>
            </div>

            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="refresh-shop-currency" />
              <s-button type="submit" disabled={isSubmitting}>Refresh from Shopify</s-button>
            </fetcher.Form>
          </div>
        </s-section>

        <s-section heading="Donation Email">
          <s-text>This feature will be available in a future update.</s-text>
        </s-section>

        <s-section heading="Audit Log">
          <s-text>Browse your full audit history in a future update.</s-text>
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Settings] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Settings" />
      <s-page>
        <s-banner tone="critical" heading="Settings unavailable">
          <p style={{ margin: 0, fontWeight: 650 }}>Something went wrong loading settings.</p>
          <p style={{ margin: "0.5rem 0 0" }}>Please refresh the page. If the problem persists, contact support.</p>
        </s-banner>
      </s-page>
    </>
  );
}
