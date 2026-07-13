import { jsonResponse } from "~/utils/json-response.server";
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRouteError, useSearchParams } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { adminFieldStyle, FetcherBanners, SectionHeader } from "../components/admin-ui";
import { prisma } from "../db.server";
import {
  cancelCustomerMerchandisingSyncRun,
  queueCustomerMerchandisingSyncRun,
} from "../services/customerMerchandisingSync.server";
import { canWriteShopifyProducts } from "../services/productPublicMetafieldService.server";
import { canSyncShopifyFiles } from "../services/shopifyIconFileService.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { normalizeFixedDecimalInput } from "../utils/input-formatting";
import {
  parseOptionalNonNegativeDecimal,
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

const optionalEmailSchema = z
  .union([z.literal(""), z.email({ message: "Notification email must be a valid email address." })])
  .transform((value) => value.toLowerCase() || null);

const customerMerchandisingSyncSchema = z.object({
  target: z.enum(["artists", "causes", "products", "all"]),
});

const cancelCustomerMerchandisingSyncSchema = z.object({
  runId: z.string().cuid(),
});

function formatDateInput(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeFailureMessagesFromResultSummary(resultSummary: unknown): string | null {
  if (!isRecord(resultSummary)) return null;

  const failureMessages: Record<string, number> = {};
  for (const phaseResult of Object.values(resultSummary)) {
    if (!isRecord(phaseResult) || !isRecord(phaseResult.failureMessages)) continue;
    for (const [message, count] of Object.entries(phaseResult.failureMessages)) {
      if (typeof count !== "number" || count <= 0) continue;
      failureMessages[message] = (failureMessages[message] ?? 0) + count;
    }
  }

  const entries = Object.entries(failureMessages).sort(([, leftCount], [, rightCount]) => rightCount - leftCount);
  if (entries.length === 0) return null;

  return entries
    .slice(0, 3)
    .map(([message, count]) => (count > 1 ? `${message} (${count}x)` : message))
    .join("; ");
}

function isGenericSyncFailureSummary(value: string | null | undefined): boolean {
  return /^\d+ items? failed\.$/.test(value ?? "");
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
  const { admin, session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const [shop, latestCustomerMerchandisingSyncRun, canSyncShopifyIconFiles, canSyncShopifyProductPublicData] =
    await Promise.all([
    prisma.shop.findUnique({
      where: { shopId },
      select: {
        planTier: true,
        paymentRate: true,
        planOverride: true,
        currency: true,
        managedMarketsEnableDate: true,
        mistakeBuffer: true,
        defaultLaborRate: true,
        defaultElectricityCostPerKwh: true,
        effectiveTaxRate: true,
        taxDeductionMode: true,
        postPurchaseEmailEnabled: true,
        artistSubmissionNotificationEmail: true,
        productDescriptionDonationSummaryEnabled: true,
      },
    }),
    prisma.customerMerchandisingSyncRun.findFirst({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        target: true,
        status: true,
        totalCount: true,
        syncedCount: true,
        failedCount: true,
        skippedCount: true,
        errorSummary: true,
        resultSummary: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    }),
      canSyncShopifyFiles({ admin, shopId }),
      canWriteShopifyProducts({ admin, shopId }),
    ]);

  const latestDetailedSyncErrorSummary = summarizeFailureMessagesFromResultSummary(
    latestCustomerMerchandisingSyncRun?.resultSummary,
  );
  const latestSyncErrorSummary =
    latestCustomerMerchandisingSyncRun?.errorSummary && !isGenericSyncFailureSummary(latestCustomerMerchandisingSyncRun.errorSummary)
      ? latestCustomerMerchandisingSyncRun.errorSummary
      : latestDetailedSyncErrorSummary
        ? latestCustomerMerchandisingSyncRun?.failedCount
          ? `${latestCustomerMerchandisingSyncRun.failedCount} item${latestCustomerMerchandisingSyncRun.failedCount === 1 ? "" : "s"} failed. ${latestDetailedSyncErrorSummary}`
          : latestDetailedSyncErrorSummary
        : latestCustomerMerchandisingSyncRun?.errorSummary;

  return jsonResponse({
    planTier: shop?.planTier ?? "Unknown",
    paymentRate: shop?.paymentRate ? (Number(shop.paymentRate) * 100).toFixed(2) : null,
    planOverride: shop?.planOverride ?? false,
    managedMarketsEnableDate: formatDateInput(shop?.managedMarketsEnableDate),
    mistakeBuffer: shop?.mistakeBuffer ? (Number(shop.mistakeBuffer) * 100).toFixed(2) : "",
    defaultLaborRate: shop?.defaultLaborRate ? Number(shop.defaultLaborRate).toFixed(2) : "",
    defaultElectricityCostPerKwh: shop?.defaultElectricityCostPerKwh?.toString() ?? "",
    effectiveTaxRate: shop?.effectiveTaxRate ? (Number(shop.effectiveTaxRate) * 100).toFixed(2) : "",
    taxDeductionMode: shop?.taxDeductionMode ?? "dont_deduct",
    postPurchaseEmailEnabled: shop?.postPurchaseEmailEnabled ?? false,
    artistSubmissionNotificationEmail: shop?.artistSubmissionNotificationEmail ?? "",
    productDescriptionDonationSummaryEnabled: shop?.productDescriptionDonationSummaryEnabled ?? false,
    canSyncShopifyIconFiles,
    canSyncShopifyProductPublicData,
    latestCustomerMerchandisingSyncRun: latestCustomerMerchandisingSyncRun
      ? {
          ...latestCustomerMerchandisingSyncRun,
          errorSummary: latestSyncErrorSummary,
        }
      : null,
  });
};

type SettingsTab = "financial" | "costs" | "tax" | "notifications" | "localization" | "advanced";

const SETTINGS_TABS: Array<{ value: SettingsTab; label: string }> = [
  { value: "financial", label: "Financial" },
  { value: "costs", label: "Cost Defaults" },
  { value: "tax", label: "Tax" },
  { value: "notifications", label: "Notifications" },
  { value: "localization", label: "Localization" },
  { value: "advanced", label: "Advanced" },
];

function parseSettingsTab(value: string | null): SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.value === value) ? (value as SettingsTab) : "financial";
}

function isCustomerMerchandisingSyncActive(status: string | null | undefined) {
  return status === "queued" || status === "running";
}

function formatCustomerMerchandisingSyncStatus(status: string) {
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  if (status === "completed_with_errors") return "Completed with errors";
  if (status === "canceled") return "Canceled";
  if (status === "failed") return "Failed";
  return status;
}

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

    return jsonResponse({ ok: true, message: "Manual rate override enabled." });
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

    return jsonResponse({ ok: true, message: "Manual override removed. Daily detection will resume." });
  }

  if (intent === "update-rate") {
    let paymentRate: Prisma.Decimal;
    try {
      paymentRate = parsePercentInputToRate(formData.get("paymentRate")?.toString(), "Rate");
    } catch (error) {
      if (error instanceof Response) {
        return jsonResponse({ ok: false, message: await error.text() }, { status: error.status });
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

    return jsonResponse({ ok: true, message: "Payment rate updated." });
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
        return jsonResponse({ ok: false, message: await error.text() }, { status: error.status });
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

    return jsonResponse({
      ok: true,
      message: managedMarketsEnableDate
        ? "Managed Markets enable date updated."
        : "Managed Markets enable date cleared.",
    });
  }

  if (intent === "update-cost-defaults") {
    let mistakeBuffer: Prisma.Decimal;
    let defaultLaborRate: Prisma.Decimal | null;
    let defaultElectricityCostPerKwh: Prisma.Decimal | null;
    try {
      mistakeBuffer = parsePercentInputToRate(
        formData.get("mistakeBuffer")?.toString(),
        "Mistake buffer",
      );
      defaultLaborRate = parseOptionalNonNegativeMoney(
        formData.get("defaultLaborRate")?.toString(),
        "Labor rate",
      );
      defaultElectricityCostPerKwh = parseOptionalNonNegativeDecimal(
        formData.get("defaultElectricityCostPerKwh")?.toString(),
        "Electricity cost per kWh",
        6,
      );
    } catch (error) {
      if (error instanceof Response) {
        return jsonResponse({ ok: false, message: await error.text() }, { status: error.status });
      }
      throw error;
    }

    await prisma.shop.update({
      where: { shopId },
      data: {
        mistakeBuffer,
        defaultLaborRate,
        defaultElectricityCostPerKwh,
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
          defaultElectricityCostPerKwh: defaultElectricityCostPerKwh?.toString() ?? null,
        },
      },
    });

    return jsonResponse({ ok: true, message: "Cost defaults updated." });
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
          return jsonResponse({ ok: false, message: await error.text() }, { status: error.status });
        }
        throw error;
      }

      if (!["dont_deduct", "non_501c3_only", "all_causes"].includes(taxDeductionMode)) {
        return jsonResponse({ ok: false, message: "Tax deduction mode is invalid." }, { status: 400 });
      }

      const normalizedRate =
        effectiveTaxRate === null
          ? null
          : effectiveTaxRate
              .div(new Prisma.Decimal(100))
              .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

      if (effectiveTaxRate !== null && effectiveTaxRate.greaterThan(new Prisma.Decimal(100))) {
        return jsonResponse({ ok: false, message: "Effective tax rate must be between 0 and 100." }, { status: 400 });
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

      return jsonResponse({ ok: true, message: "Tax settings updated." });
    }

  if (intent === "update-email-settings") {
    const postPurchaseEmailEnabled = formData.get("postPurchaseEmailEnabled") === "on";
    const parsedNotificationEmail = optionalEmailSchema.safeParse(
      formData.get("artistSubmissionNotificationEmail")?.toString().trim() ?? "",
    );

    if (!parsedNotificationEmail.success) {
      return jsonResponse(
        {
          ok: false,
          message: parsedNotificationEmail.error.issues[0]?.message ?? "Notification email is invalid.",
        },
        { status: 400 },
      );
    }

    await prisma.shop.update({
      where: { shopId },
      data: {
        postPurchaseEmailEnabled,
        artistSubmissionNotificationEmail: parsedNotificationEmail.data,
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
          artistSubmissionNotificationEmail: parsedNotificationEmail.data,
        },
      },
    });

    return jsonResponse({
      ok: true,
      message: postPurchaseEmailEnabled
        ? "Post-purchase donation email enabled."
        : "Post-purchase donation email disabled.",
    });
  }

  if (intent === "update-customer-merchandising-settings") {
    const productDescriptionDonationSummaryEnabled =
      formData.get("productDescriptionDonationSummaryEnabled") === "on";

    await prisma.shop.update({
      where: { shopId },
      data: {
        productDescriptionDonationSummaryEnabled,
      },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "Shop",
        action: "CUSTOMER_MERCHANDISING_SETTINGS_UPDATED",
        actor: "merchant",
        payload: {
          productDescriptionDonationSummaryEnabled,
        },
      },
    });

    return jsonResponse({ ok: true, message: "Customer merchandising settings updated." });
  }

  if (intent === "sync-customer-merchandising-to-shopify") {
    const parsed = customerMerchandisingSyncSchema.safeParse({
      target: formData.get("target")?.toString(),
    });
    if (!parsed.success) {
      return jsonResponse({ ok: false, message: "Choose a valid Shopify sync target." }, { status: 400 });
    }

    const { runId } = await queueCustomerMerchandisingSyncRun({
      shopId,
      target: parsed.data.target,
    });

    return jsonResponse({
      ok: true,
      message: "Shopify storefront sync queued. Progress will update below.",
      runId,
    });
  }

  if (intent === "cancel-customer-merchandising-sync") {
    const parsed = cancelCustomerMerchandisingSyncSchema.safeParse({
      runId: formData.get("runId")?.toString(),
    });
    if (!parsed.success) {
      return jsonResponse({ ok: false, message: "Choose a valid sync run to cancel." }, { status: 400 });
    }

    const canceled = await cancelCustomerMerchandisingSyncRun({
      shopId,
      runId: parsed.data.runId,
    });

    return jsonResponse({
      ok: true,
      message: canceled
        ? "Shopify storefront sync canceled. Shopify may contain partial updates."
        : "That Shopify storefront sync is no longer running.",
      runId: parsed.data.runId,
    });
  }

  if (intent === "refresh-shop-currency") {
    if (!admin) {
      return jsonResponse(
        { ok: false, message: "Shopify admin is unavailable in local fixture mode." },
        { status: 400 },
      );
    }

    const response = await admin.graphql(SHOP_CURRENCY_QUERY);
    const json = await response.json();
    const currency = json?.data?.shop?.currencyCode;

    if (typeof currency !== "string" || currency.length !== 3) {
      console.error("[Settings] Failed to refresh shop currency:", json);
      return jsonResponse({ ok: false, message: "Unable to refresh shop currency from Shopify." }, { status: 502 });
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

    return jsonResponse({ ok: true, message: `Shop currency refreshed to ${currency}.` });
  }

  return jsonResponse({ ok: false, message: "Unknown action." }, { status: 400 });
};

export default function Settings() {
  const {
    planTier,
    paymentRate,
    planOverride,
    managedMarketsEnableDate,
    mistakeBuffer,
    defaultLaborRate,
    defaultElectricityCostPerKwh,
    effectiveTaxRate,
    taxDeductionMode,
    postPurchaseEmailEnabled,
    artistSubmissionNotificationEmail,
    productDescriptionDonationSummaryEnabled,
    canSyncShopifyIconFiles,
    canSyncShopifyProductPublicData,
    latestCustomerMerchandisingSyncRun,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string; runId?: string }>();
  const syncStatusFetcher = useFetcher<typeof loader>();
  const [searchParams] = useSearchParams();
  const { currency, locale, formatMoney, formatPct, getCurrencySymbol } = useAppLocalization();

  const statusRef = useRef<HTMLDivElement>(null);
  const syncStatusLoadRef = useRef(syncStatusFetcher.load);
  const [rateInput, setRateInput] = useState(paymentRate ?? "");
  const [managedMarketsEnableDateInput, setManagedMarketsEnableDateInput] = useState(managedMarketsEnableDate ?? "");
  const [bufferInput, setBufferInput] = useState(mistakeBuffer ?? "");
  const [laborRateInput, setLaborRateInput] = useState(defaultLaborRate ?? "");
  const [electricityRateInput, setElectricityRateInput] = useState(defaultElectricityCostPerKwh ?? "");
  const [effectiveTaxRateInput, setEffectiveTaxRateInput] = useState(effectiveTaxRate ?? "");
  const [taxDeductionModeInput, setTaxDeductionModeInput] = useState(taxDeductionMode ?? "dont_deduct");
  const [postPurchaseEmailEnabledInput, setPostPurchaseEmailEnabledInput] = useState(postPurchaseEmailEnabled ?? false);
  const [artistSubmissionNotificationEmailInput, setArtistSubmissionNotificationEmailInput] = useState(
    artistSubmissionNotificationEmail ?? "",
  );
  const [productDescriptionDonationSummaryEnabledInput, setProductDescriptionDonationSummaryEnabledInput] = useState(
    productDescriptionDonationSummaryEnabled ?? false,
  );
  const activeTab = parseSettingsTab(searchParams.get("section"));
  const latestSyncRun =
    syncStatusFetcher.data?.latestCustomerMerchandisingSyncRun ?? latestCustomerMerchandisingSyncRun;
  const queuedSyncRunId = fetcher.data?.runId;

  const isSubmitting = fetcher.state !== "idle";
  const isSyncRunning = isCustomerMerchandisingSyncActive(latestSyncRun?.status);
  const isQueuedSyncRunPending = Boolean(queuedSyncRunId && latestSyncRun?.id !== queuedSyncRunId);
  const shouldPollSyncStatus = isSyncRunning || isQueuedSyncRunPending;
  const statusMessage = fetcher.data?.message ?? "";
  const syncCompletedCount =
    (latestSyncRun?.syncedCount ?? 0) +
    (latestSyncRun?.failedCount ?? 0) +
    (latestSyncRun?.skippedCount ?? 0);
  const syncProgressPercent = latestSyncRun?.totalCount
    ? Math.min(100, Math.round(syncCompletedCount / latestSyncRun.totalCount * 100))
    : isSyncRunning
      ? 5
      : 0;

  useEffect(() => {
    syncStatusLoadRef.current = syncStatusFetcher.load;
  }, [syncStatusFetcher.load]);

  useEffect(() => {
    if (!shouldPollSyncStatus) return;
    syncStatusLoadRef.current("/app/settings?section=advanced");
    const id = window.setInterval(() => {
      syncStatusLoadRef.current("/app/settings?section=advanced");
    }, 2500);
    return () => window.clearInterval(id);
  }, [shouldPollSyncStatus]);

  return (
    <>
      <ui-title-bar title="Settings" />

      <div
        ref={statusRef}
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      >
        {statusMessage ? "Settings status updated." : ""}
      </div>

      <s-page>
        <FetcherBanners data={fetcher.data} />

        {activeTab === "financial" ? (
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
                    style={adminFieldStyle}
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
        ) : null}

        {activeTab === "costs" ? (
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
              <s-text-field
                label={`Default electricity cost (${getCurrencySymbol()}/kWh)`}
                name="defaultElectricityCostPerKwh"
                value={electricityRateInput}
                onChange={(event) => setElectricityRateInput((event.currentTarget as HTMLInputElement).value)}
                type="number"
                min={0}
                step={0.000001}
              />
              <s-text>
                Used for calculated equipment electricity costs unless an equipment item has its own override.
              </s-text>
              <div>
                <s-button type="submit" disabled={isSubmitting}>Save cost defaults</s-button>
              </div>
            </div>
          </fetcher.Form>
        </s-section>
        ) : null}

        {activeTab === "tax" ? (
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
                        borderRadius: "0.5rem",
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
                  style={adminFieldStyle}
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
        ) : null}

        {activeTab === "localization" ? (
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
        ) : null}

        {activeTab === "notifications" ? (
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
              <s-text-field
                label="Artist submission notification email"
                name="artistSubmissionNotificationEmail"
                value={artistSubmissionNotificationEmailInput}
                onChange={(event) =>
                  setArtistSubmissionNotificationEmailInput((event.currentTarget as HTMLInputElement).value)
                }
                type="email"
              />
              <s-text>
                Enter an address to receive an email whenever someone submits the Artist Submission form. Leave blank to disable these notifications.
              </s-text>
              <div>
                <s-button type="submit" disabled={isSubmitting}>Save email settings</s-button>
              </div>
            </div>
          </fetcher.Form>
        </s-section>
        ) : null}

        {activeTab === "advanced" ? (
        <s-section heading="Advanced">
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <SectionHeader
              title="Customer merchandising"
              description="Optional storefront and Shopify-native content enhancements for Artists, Causes, and donation summaries."
            />
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="update-customer-merchandising-settings" />
              <div style={{ display: "grid", gap: "0.85rem" }}>
                <label
                  htmlFor="product-description-summary-enabled"
                  style={{ display: "flex", alignItems: "start", gap: "0.75rem", cursor: "pointer" }}
                >
                  <input
                    id="product-description-summary-enabled"
                    type="checkbox"
                    name="productDescriptionDonationSummaryEnabled"
                    checked={productDescriptionDonationSummaryEnabledInput}
                    onChange={(event) => setProductDescriptionDonationSummaryEnabledInput(event.currentTarget.checked)}
                    style={{ marginTop: "0.2rem" }}
                  />
                  <span style={{ display: "grid", gap: "0.25rem" }}>
                    <strong>Inject donation summaries into product descriptions</strong>
                    <s-text>
                      Opt-in fallback for Shop and external channels. Count On Us only replaces its own marked block.
                    </s-text>
                  </span>
                </label>
                <div>
                  <s-button type="submit" disabled={isSubmitting}>Save customer merchandising settings</s-button>
                </div>
              </div>
            </fetcher.Form>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <SectionHeader
                title="Sync Shopify storefront data"
                description="Use these when enabling merchandising features on an existing store or after repairing stale Shopify metaobjects."
              />
              <div style={{ display: "grid", gap: "0.5rem" }}>
                <s-text>
                  Artist and Cause sync refreshes Shopify metaobjects, including uploaded icon proxy URLs. Product sync refreshes
                  public metafields used by filters and updates Count On Us product-description summary blocks according to the
                  setting above.
                </s-text>
                {!canSyncShopifyIconFiles ? (
                  <s-banner tone="warning">
                    <s-text>
                      Shopify file access is not granted, so Artist and Cause icon image uploads will be skipped. Public icon
                      URLs, metaobjects, and other granted sync surfaces will still run.
                    </s-text>
                  </s-banner>
                ) : null}
                {!canSyncShopifyProductPublicData ? (
                  <s-banner tone="warning">
                    <s-text>
                      Shopify product edit access is not granted, so product metafields and product-description summaries will
                      be skipped. Artist and Cause metaobjects can still sync.
                    </s-text>
                  </s-banner>
                ) : null}
                {latestSyncRun ? (
                  <div
                    style={{
                      border: "1px solid var(--p-color-border, #d2d5d8)",
                      borderRadius: "0.5rem",
                      padding: "0.75rem",
                      display: "grid",
                      gap: "0.5rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                      <strong>{formatCustomerMerchandisingSyncStatus(latestSyncRun.status)}</strong>
                      <s-text>
                        {latestSyncRun.target === "all" ? "All storefront data" : latestSyncRun.target}
                      </s-text>
                    </div>
                    <div
                      role="progressbar"
                      aria-label="Shopify storefront sync progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={syncProgressPercent}
                      style={{
                        width: "100%",
                        height: "0.6rem",
                        borderRadius: "999px",
                        background: "var(--p-color-bg-surface-secondary, #f1f2f4)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${syncProgressPercent}%`,
                          height: "100%",
                          background:
                            latestSyncRun.status === "failed"
                              ? "var(--p-color-bg-fill-critical, #c9372c)"
                              : "var(--p-color-bg-fill-brand, #005bd3)",
                          transition: "width 200ms ease",
                        }}
                      />
                    </div>
                    <s-text>
                      {syncCompletedCount}/{latestSyncRun.totalCount || "?"} processed, {latestSyncRun.syncedCount} synced,
                      {" "}{latestSyncRun.skippedCount} skipped, {latestSyncRun.failedCount} failed.
                    </s-text>
                    {latestSyncRun.errorSummary ? (
                      <span style={{ color: "var(--p-color-text-critical, #8e1f0b)", whiteSpace: "pre-wrap" }}>
                        {latestSyncRun.errorSummary}
                      </span>
                    ) : null}
                    {isCustomerMerchandisingSyncActive(latestSyncRun.status) ? (
                      <div style={{ display: "grid", gap: "0.4rem", justifyItems: "start" }}>
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="cancel-customer-merchandising-sync" />
                          <input type="hidden" name="runId" value={latestSyncRun.id} />
                          <s-button type="submit" tone="critical" disabled={isSubmitting}>
                            Cancel sync
                          </s-button>
                        </fetcher.Form>
                        <s-text>
                          Canceling stops after the current item finishes. Shopify changes already sent will not be rolled back.
                        </s-text>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="sync-customer-merchandising-to-shopify" />
                    <input type="hidden" name="target" value="artists" />
                    <s-button type="submit" disabled={isSubmitting || shouldPollSyncStatus}>Sync artists</s-button>
                  </fetcher.Form>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="sync-customer-merchandising-to-shopify" />
                    <input type="hidden" name="target" value="causes" />
                    <s-button type="submit" disabled={isSubmitting || shouldPollSyncStatus}>Sync causes</s-button>
                  </fetcher.Form>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="sync-customer-merchandising-to-shopify" />
                    <input type="hidden" name="target" value="products" />
                    <s-button type="submit" disabled={isSubmitting || shouldPollSyncStatus}>Sync products</s-button>
                  </fetcher.Form>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="sync-customer-merchandising-to-shopify" />
                    <input type="hidden" name="target" value="all" />
                    <s-button type="submit" disabled={isSubmitting || shouldPollSyncStatus} variant="primary">Sync all</s-button>
                  </fetcher.Form>
                </div>
              </div>
            </div>
            <s-banner tone="info">
              <div style={{ display: "grid", gap: "0.45rem" }}>
                <strong>Storefront filter setup required</strong>
                <s-text>
                  Artist and Cause directory links use Shopify product metafields:
                  {" "}donation_manager.artist_refs and donation_manager.cause_refs.
                </s-text>
                <s-text>
                  After assigning Artists or Causes to products, open Shopify Admin and use Shopify&apos;s Search &amp; Discovery app
                  to add both metaobject-reference metafields as collection filters, then save. To show icons in supported
                  themes, enable the filter visual display and choose the Icon image field. If Search &amp; Discovery is not
                  installed, install Shopify&apos;s free app from the Shopify App Store first. If existing products were assigned
                  before this feature was enabled, use Sync all above so Count On Us refreshes the Shopify metaobjects, icon
                  images, and product metafields.
                </s-text>
              </div>
            </s-banner>
            <SectionHeader
              title="Audit Log"
              description="Browse financial change history, filter by event type, and inspect payload details."
            />
            <div>
              <Link to="/app/audit-log">
                <s-button>Open audit log</s-button>
              </Link>
            </div>
            <s-text color="subdued">
              Future capability, disclosure, and data lifecycle controls should live in this advanced group rather than in the financial setup flow.
            </s-text>
          </div>
        </s-section>
        ) : null}
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
