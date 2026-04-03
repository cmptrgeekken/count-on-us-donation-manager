import { useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRouteError } from "@remix-run/react";
import {
  Page,
  Card,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Divider,
  Button,
  TextField,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import l10n from "../utils/localization";
import { getLocaleFromRequest } from "../utils/localization.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const locale = getLocaleFromRequest(request);

  const shop = await prisma.shop.findUnique({
    where: { shopId },
    select: {
      planTier: true,
      paymentRate: true,
      planOverride: true,
      currency: true,
      mistakeBuffer: true,
      defaultLaborRate: true
    },
  });

  return Response.json({
    localization: {
      currency: shop?.currency ?? "USD",
      locale,
    },
    planTier: shop?.planTier ?? "Unknown",
    paymentRate: shop?.paymentRate
      ? (Number(shop.paymentRate) * 100).toFixed(2)
      : null,
    planOverride: shop?.planOverride ?? false,
    mistakeBuffer: shop?.mistakeBuffer
      ? (Number(shop.mistakeBuffer) * 100).toFixed(2)
      : "",
    defaultLaborRate: shop?.defaultLaborRate
      ? Number(shop.defaultLaborRate).toFixed(2)
      : ""
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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
        defaultLaborRate
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

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

export default function Settings() {
  const { localization, planTier, paymentRate, planOverride, mistakeBuffer, defaultLaborRate } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const { formatMoney, formatPct, getCurrencySymbol } = l10n(localization.currency, localization.locale);

  // Accessible status announcement for screen readers
  const statusRef = useRef<HTMLDivElement>(null);

  const [rateInput, setRateInput] = useState(paymentRate ?? "");
  const [bufferInput, setBufferInput] = useState(mistakeBuffer ?? "");
  const [laborRateInput, setLaborRateInput] = useState(defaultLaborRate ?? "");

  const isSubmitting = fetcher.state !== "idle";
  const statusMessage = fetcher.data?.message ?? "";

  return (
    <Page>
      <TitleBar title="Settings" />

      {/* Screen reader announcements */}
      <div
        ref={statusRef}
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      >
        {statusMessage}
      </div>

      <BlockStack gap="600">
        {/* Shopify Payments */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Shopify Payments
            </Text>
            <Divider />

            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Plan
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Your current Shopify plan, used to look up your payment processing rate.
                </Text>
              </BlockStack>
              <Badge tone={planTier === "Unknown" ? "warning" : "success"}>
                {planTier}
              </Badge>
            </InlineStack>

            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Payment processing rate
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {planOverride
                    ? "Manually set — daily auto-detection paused."
                    : "Auto-detected daily from your plan."}
                </Text>
              </BlockStack>
              <Text as="p" variant="bodyMd">
                {paymentRate !== null ? `${formatPct(paymentRate / 100)}` : "Not detected"}
              </Text>
            </InlineStack>

            {planOverride && (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="update-rate" />
                <InlineStack gap="200" blockAlign="end">
                  <TextField
                    label="Override rate (%)"
                    name="paymentRate"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    autoComplete="off"
                    value={rateInput}
                    onChange={setRateInput}
                    helpText="Enter the percentage as a number, e.g. 2.90"
                    connectedRight={
                      <Button submit loading={isSubmitting}>
                        Save
                      </Button>
                    }
                  />
                </InlineStack>
              </fetcher.Form>
            )}

            <fetcher.Form method="post">
              <input
                type="hidden"
                name="intent"
                value={planOverride ? "disable-override" : "enable-override"}
              />
              <Button
                submit
                loading={isSubmitting}
                variant={planOverride ? "plain" : "secondary"}
                tone={planOverride ? "critical" : undefined}
              >
                {planOverride
                  ? "Remove override — resume auto-detection"
                  : "Set a manual rate override"}
              </Button>
            </fetcher.Form>
          </BlockStack>
        </Card>

        {/* Cost Defaults */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Cost Defaults
            </Text>
            <Divider />
            
            {/* <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Mistake buffer
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Applied to production material costs on every variant. Can be overridden per variant.
                </Text>
              </BlockStack>
            </InlineStack> */}
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="update-cost-defaults" />
              <div style={{ flex: 1 }}>
                <TextField
                  label="Mistake buffer (%)"
                  name="mistakeBuffer"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  autoComplete="off"
                  value={bufferInput}
                  onChange={setBufferInput}
                  helpText={`e.g. 5 = ${formatPct(.05)}. Added to production material costs to account for waste.`}
                 />
                </div>
                <div style={{ flex: 1 }}>
                  <TextField
                    label={`Default Labor Rate (${getCurrencySymbol()}/hr)`}
                    name="defaultLaborRate"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    autoComplete="off"
                    value={laborRateInput}
                    onChange={setLaborRateInput}
                    helpText={`e.g., ${formatMoney(15)}/hr. Leave blank to remove the shop default labor rate.`}
                  />
                </div>

                <div style={{ flex: 1 }}>
                  <Button submit loading={isSubmitting}>
                    Save
                  </Button>
                </div>
            </fetcher.Form>
          </BlockStack>
        </Card>

        {/* Donation Email — Phase 5 placeholder */}
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Donation Email
            </Text>
            <Divider />
            <EmptyState
              heading="Coming soon"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              fullWidth
            >
              <Text as="p" variant="bodyMd" tone="subdued">
                Configure post-purchase donation emails in a future update.
              </Text>
            </EmptyState>
          </BlockStack>
        </Card>

        {/* Audit Log — Phase 4 placeholder */}
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Audit Log
            </Text>
            <Divider />
            <EmptyState
              heading="Coming soon"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              fullWidth
            >
              <Text as="p" variant="bodyMd" tone="subdued">
                Browse your full audit history in a future update.
              </Text>
            </EmptyState>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Settings] ErrorBoundary caught:", error);
  return (
    <Page>
      <TitleBar title="Settings" />
      <Banner tone="critical">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" fontWeight="bold">
            Something went wrong loading settings.
          </Text>
          <Text as="p" variant="bodyMd">
            Please refresh the page. If the problem persists, contact support.
          </Text>
        </BlockStack>
      </Banner>
    </Page>
  );
}
