import { useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { Prisma } from "@prisma/client";

import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { normalizeFixedDecimalInput } from "../utils/input-formatting";
import {
  parseOptionalNonNegativeMoney,
  parsePercentInputToRate,
} from "../utils/money-parsing";
import { useAppLocalization } from "../utils/use-app-localization";

const SHOP_CURRENCY_QUERY = `#graphql
  query ShopCurrency {
    shop {
      currencyCode
    }
  }
`;

const TAX_RATE_PRESETS = [
  {
    value: "15.30",
    label: "15.30%",
    description: "Self-employment tax only baseline.",
  },
  {
    value: "22.00",
    label: "22.00%",
    description: "Common federal bracket starting point.",
  },
  {
    value: "25.00",
    label: "25.00%",
    description: "Balanced planning estimate for many sole proprietors.",
  },
  {
    value: "30.00",
    label: "30.00%",
    description: "Conservative blended estimate.",
  },
  {
    value: "35.00",
    label: "35.00%",
    description: "Very conservative placeholder until confirmed.",
  },
] as const;

function formatDateInput(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function parseOptionalDateInput(value: string | undefined, label: string) {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Response(`${label} must be a valid date.`, { status: 400 });
  }

  const [year, month, day] = raw.split("-").map((part) => Number(part));
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(normalized.getTime()) ||
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    throw new Response(`${label} must be a valid date.`, { status: 400 });
  }

  return normalized;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopId },
    select: {
      planTier: true,
      paymentRate: true,
      planOverride: true,
      currency: true,
      managedMarketsEnableDate: true,
      mistakeBuffer: true,
      defaultLaborRate: true,
      effectiveTaxRate: true,
      taxDeductionMode: true,
      postPurchaseEmailEnabled: true,
    },
  });

  return Response.json({
    planTier: shop?.planTier ?? "Unknown",
    paymentRate: shop?.paymentRate ? (Number(shop.paymentRate) * 100).toFixed(2) : null,
    planOverride: shop?.planOverride ?? false,
    managedMarketsEnableDate: formatDateInput(shop?.managedMarketsEnableDate),
    mistakeBuffer: shop?.mistakeBuffer ? (Number(shop.mistakeBuffer) * 100).toFixed(2) : "",
    defaultLaborRate: shop?.defaultLaborRate ? Number(shop.defaultLaborRate).toFixed(2) : "",
    effectiveTaxRate: shop?.effectiveTaxRate ? (Number(shop.effectiveTaxRate) * 100).toFixed(2) : "",
    taxDeductionMode: shop?.taxDeductionMode ?? "dont_deduct",
    postPurchaseEmailEnabled: shop?.postPurchaseEmailEnabled ?? true,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticateAdminRequest(request);
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
    let paymentRate: Prisma.Decimal;
    try {
      paymentRate = parsePercentInputToRate(formData.get("paymentRate")?.toString(), "Rate");
    } catch (error) {
      if (error instanceof Response) {
        return Response.json({ ok: false, message: await error.text() }, { status: error.status });
      }
      throw error;
    }

    await prisma.shop.update({
      where: { shopId },
      data: { paymentRate },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "Shop",
        action: "PAYMENT_RATE_UPDATED",
        actor: "merchant",
        payload: { paymentRate: paymentRate.toString() },
      },
    });

    return Response.json({ ok: true, message: "Payment rate updated." });
  }

  if (intent === "update-managed-markets-date") {
    let managedMarketsEnableDate: Date | null;
    try {
      managedMarketsEnableDate = parseOptionalDateInput(
        formData.get("managedMarketsEnableDate")?.toString(),
        "Managed Markets enable date",
      );
    } catch (error) {
      if (error instanceof Response) {
        return Response.json({ ok: false, message: await error.text() }, { status: error.status });
      }
      throw error;
    }

    await prisma.shop.update({
      where: { shopId },
      data: { managedMarketsEnableDate },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "Shop",
        action: "MANAGED_MARKETS_ENABLE_DATE_UPDATED",
        actor: "merchant",
        payload: { managedMarketsEnableDate: managedMarketsEnableDate?.toISOString() ?? null },
      },
    });

    return Response.json({
      ok: true,
      message: managedMarketsEnableDate
        ? "Managed Markets enable date updated."
        : "Managed Markets enable date cleared.",
    });
  }

  if (intent === "update-cost-defaults") {
    let mistakeBuffer: Prisma.Decimal;
    let defaultLaborRate: Prisma.Decimal | null;
    try {
      mistakeBuffer = parsePercentInputToRate(
        formData.get("mistakeBuffer")?.toString(),
        "Mistake buffer",
      );
      defaultLaborRate = parseOptionalNonNegativeMoney(
        formData.get("defaultLaborRate")?.toString(),
        "Labor rate",
      );
    } catch (error) {
      if (error instanceof Response) {
        return Response.json({ ok: false, message: await error.text() }, { status: error.status });
      }
      throw error;
    }

    await prisma.shop.update({
      where: { shopId },
      data: {
        mistakeBuffer,
        defaultLaborRate,
      },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "Shop",
        action: "COST_DEFAULTS_UPDATED",
        actor: "merchant",
        payload: {
          mistakeBuffer: mistakeBuffer.toString(),
          defaultLaborRate: defaultLaborRate?.toString() ?? null,
        },
      },
    });

    return Response.json({ ok: true, message: "Cost defaults updated." });
  }

    if (intent === "update-tax-settings") {
      let effectiveTaxRate: Prisma.Decimal | null;
      const taxDeductionMode = formData.get("taxDeductionMode")?.toString() ?? "dont_deduct";

      try {
        effectiveTaxRate = parseOptionalNonNegativeMoney(
          formData.get("effectiveTaxRate")?.toString(),
          "Effective tax rate",
        );
      } catch (error) {
        if (error instanceof Response) {
          return Response.json({ ok: false, message: await error.text() }, { status: error.status });
        }
        throw error;
      }

      if (!["dont_deduct", "non_501c3_only", "all_causes"].includes(taxDeductionMode)) {
        return Response.json({ ok: false, message: "Tax deduction mode is invalid." }, { status: 400 });
      }

      const normalizedRate =
        effectiveTaxRate === null
          ? null
          : effectiveTaxRate
              .div(new Prisma.Decimal(100))
              .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

      if (effectiveTaxRate !== null && effectiveTaxRate.greaterThan(new Prisma.Decimal(100))) {
        return Response.json({ ok: false, message: "Effective tax rate must be between 0 and 100." }, { status: 400 });
      }

      await prisma.shop.update({
        where: { shopId },
        data: {
          effectiveTaxRate: normalizedRate,
          taxDeductionMode,
        },
      });

      await prisma.auditLog.create({
        data: {
          shopId,
          entity: "Shop",
          action: "TAX_SETTINGS_UPDATED",
          actor: "merchant",
          payload: {
            effectiveTaxRate: normalizedRate?.toString() ?? null,
            taxDeductionMode,
          },
        },
      });

      return Response.json({ ok: true, message: "Tax settings updated." });
    }

  if (intent === "update-email-settings") {
    const postPurchaseEmailEnabled = formData.get("postPurchaseEmailEnabled") === "on";

    await prisma.shop.update({
      where: { shopId },
      data: {
        postPurchaseEmailEnabled,
      },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "Shop",
        action: "POST_PURCHASE_EMAIL_SETTINGS_UPDATED",
        actor: "merchant",
        payload: {
          postPurchaseEmailEnabled,
        },
      },
    });

    return Response.json({
      ok: true,
      message: postPurchaseEmailEnabled
        ? "Post-purchase donation email enabled."
        : "Post-purchase donation email disabled.",
    });
  }

  if (intent === "refresh-shop-currency") {
    if (!admin) {
      return Response.json(
        { ok: false, message: "Shopify admin is unavailable in local fixture mode." },
        { status: 400 },
      );
    }

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
  const {
    planTier,
    paymentRate,
    planOverride,
    managedMarketsEnableDate,
    mistakeBuffer,
    defaultLaborRate,
    effectiveTaxRate,
    taxDeductionMode,
    postPurchaseEmailEnabled,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const { currency, locale, formatMoney, formatPct, getCurrencySymbol } = useAppLocalization();

  const statusRef = useRef<HTMLDivElement>(null);
  const [rateInput, setRateInput] = useState(paymentRate ?? "");
  const [managedMarketsEnableDateInput, setManagedMarketsEnableDateInput] = useState(managedMarketsEnableDate ?? "");
  const [bufferInput, setBufferInput] = useState(mistakeBuffer ?? "");
  const [laborRateInput, setLaborRateInput] = useState(defaultLaborRate ?? "");
  const [effectiveTaxRateInput, setEffectiveTaxRateInput] = useState(effectiveTaxRate ?? "");
  const [taxDeductionModeInput, setTaxDeductionModeInput] = useState(taxDeductionMode ?? "dont_deduct");
  const [postPurchaseEmailEnabledInput, setPostPurchaseEmailEnabledInput] = useState(postPurchaseEmailEnabled ?? true);

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

            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="update-managed-markets-date" />
              <div style={{ display: "grid", gap: "0.75rem" }}>
                <div style={{ display: "grid", gap: "0.35rem" }}>
                  <label htmlFor="managed-markets-enable-date">Managed Markets enable date</label>
                  <input
                    id="managed-markets-enable-date"
                    name="managedMarketsEnableDate"
                    type="date"
                    value={managedMarketsEnableDateInput}
                    onChange={(event) => setManagedMarketsEnableDateInput(event.currentTarget.value)}
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
                  Use the date Managed Markets went live for your shop so international fee assumptions line up with the
                  correct period. Leave blank if Managed Markets has never been enabled.
                </s-text>
                <div>
                  <s-button type="submit" disabled={isSubmitting}>Save Managed Markets date</s-button>
                </div>
              </div>
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
                onBlur={(event) => setLaborRateInput(normalizeFixedDecimalInput((event.currentTarget as HTMLInputElement).value))}
                type="number"
                min={0}
                step={0.01}
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

        <s-section heading="Tax Estimation">
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="update-tax-settings" />
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <s-text-field
                label="Effective tax rate (%)"
                name="effectiveTaxRate"
                value={effectiveTaxRateInput}
                onChange={(event) => setEffectiveTaxRateInput((event.currentTarget as HTMLInputElement).value)}
                onBlur={(event) =>
                  setEffectiveTaxRateInput(normalizeFixedDecimalInput((event.currentTarget as HTMLInputElement).value))
                }
                type="number"
                min={0}
                max={100}
                step={0.01}
              />
              <s-text>
                Example: 25 = {formatPct(0.25)}. This is used for estimated reserve reporting only, not tax filing.
              </s-text>
              <div style={{ display: "grid", gap: "0.5rem" }}>
                <strong>Planning presets</strong>
                <s-text>
                  These are rough starting points for planning only. They are not tax advice, and your real blended rate may differ.
                </s-text>
                <div style={{ display: "grid", gap: "0.5rem" }}>
                  {TAX_RATE_PRESETS.map((preset) => (
                    <div
                      key={preset.value}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "0.75rem",
                        flexWrap: "wrap",
                        padding: "0.6rem 0.75rem",
                        border: "1px solid var(--p-color-border, #d2d5d8)",
                        borderRadius: "0.75rem",
                        background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
                      }}
                    >
                      <div style={{ display: "grid", gap: "0.2rem" }}>
                        <strong>{preset.label}</strong>
                        <s-text>{preset.description}</s-text>
                      </div>
                      <s-button type="button" variant="secondary" onClick={() => setEffectiveTaxRateInput(preset.value)}>
                        Use {preset.label}
                      </s-button>
                    </div>
                  ))}
                </div>
                <s-text>
                  If you are unsure, start conservative and confirm the rate with your accountant or tax preparer.
                </s-text>
                <s-text>
                  U.S. merchants can use the{" "}
                  <a href="https://apps.irs.gov/app/tax-withholding-estimator" target="_blank" rel="noreferrer">
                    IRS Tax Withholding Estimator
                  </a>{" "}
                  as an initial reference point before setting a blended reserve rate here.
                </s-text>
              </div>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <label htmlFor="tax-deduction-mode">Tax deduction mode</label>
                <select
                  id="tax-deduction-mode"
                  name="taxDeductionMode"
                  value={taxDeductionModeInput}
                  onChange={(event) => setTaxDeductionModeInput(event.currentTarget.value)}
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
                >
                  <option value="dont_deduct">Don&apos;t deduct</option>
                  <option value="non_501c3_only">Deduct from non-501(c)3 causes only</option>
                  <option value="all_causes">Deduct from all causes</option>
                </select>
              </div>
              <s-text>
                Choose which causes should absorb the estimated tax reserve in reporting.
              </s-text>
              <div>
                <s-button type="submit" disabled={isSubmitting}>Save tax settings</s-button>
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
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="update-email-settings" />
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <label
                htmlFor="post-purchase-email-enabled"
                style={{ display: "flex", alignItems: "start", gap: "0.75rem", cursor: "pointer" }}
              >
                <input
                  id="post-purchase-email-enabled"
                  type="checkbox"
                  name="postPurchaseEmailEnabled"
                  checked={postPurchaseEmailEnabledInput}
                  onChange={(event) => setPostPurchaseEmailEnabledInput(event.currentTarget.checked)}
                  style={{ marginTop: "0.2rem" }}
                />
                <span style={{ display: "grid", gap: "0.25rem" }}>
                  <strong>Send post-purchase donation summary emails</strong>
                  <s-text>
                    When enabled, customers receive a donation summary email after their order snapshot is created.
                  </s-text>
                </span>
              </label>
              <s-text>
                The email uses the order&apos;s `contact_email` field, includes per-cause amounts and donation links, and points
                customers to the public donation receipts page.
              </s-text>
              <div>
                <s-button type="submit" disabled={isSubmitting}>Save email settings</s-button>
              </div>
            </div>
          </fetcher.Form>
        </s-section>

        <s-section heading="Audit Log">
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <s-text>Browse financial change history, filter by event type, and inspect payload details.</s-text>
            <div>
              <Link to="/app/audit-log">
                <s-button>Open audit log</s-button>
              </Link>
            </div>
          </div>
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
