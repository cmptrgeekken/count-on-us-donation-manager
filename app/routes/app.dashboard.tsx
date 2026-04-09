import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Form, useLoaderData, useRouteError } from "@remix-run/react";

import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import {
  getSetupWizardProgress,
  setupWizardSteps,
  updateSetupWizardState,
} from "../services/setupWizard.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopId },
    select: { catalogSynced: true },
  });

  const catalogSynced = shop?.catalogSynced ?? false;
  const setupWizard = await getSetupWizardProgress(shopId);

  if (!catalogSynced) {
    return Response.json({
      catalogSynced: false,
      productCount: 0,
      variantCount: 0,
      configuredCount: 0,
      setupWizard,
    });
  }

  const [productCount, variantCount, configuredCount] = await Promise.all([
    prisma.product.count({ where: { shopId } }),
    prisma.variant.count({ where: { shopId } }),
    prisma.variantCostConfig.count({ where: { shopId } }),
  ]);

  return Response.json({ catalogSynced: true, productCount, variantCount, configuredCount, setupWizard });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();
  const stepIndex = Number(formData.get("stepIndex"));

  if (
    !intent ||
    !Number.isInteger(stepIndex) ||
    stepIndex < 0 ||
    stepIndex >= setupWizardSteps.length
  ) {
    return Response.json({ ok: false, message: "Invalid setup wizard action." }, { status: 400 });
  }

  if (intent === "complete-setup-step") {
    await updateSetupWizardState({ shopId, stepIndex, action: "complete" });
    return Response.json({ ok: true, message: "Setup step marked complete." });
  }

  if (intent === "skip-setup-step") {
    await updateSetupWizardState({ shopId, stepIndex, action: "skip" });
    return Response.json({ ok: true, message: "Setup step skipped for now." });
  }

  if (intent === "resume-setup-step") {
    await updateSetupWizardState({ shopId, stepIndex, action: "resume" });
    return Response.json({ ok: true, message: "Setup step resumed." });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

export default function Dashboard() {
  const { catalogSynced, productCount, variantCount, configuredCount, setupWizard } = useLoaderData<typeof loader>();

  const prevSyncedRef = useRef(catalogSynced);
  const liveRef = useRef<HTMLDivElement>(null);
  const isInternalAppHref = (href: string) => href.startsWith("/app/");

  useEffect(() => {
    if (!prevSyncedRef.current && catalogSynced && liveRef.current) {
      liveRef.current.textContent = "Store catalog sync complete.";
    }
    prevSyncedRef.current = catalogSynced;
  }, [catalogSynced]);

  return (
    <>
      <ui-title-bar title="Dashboard" />

      <div
        ref={liveRef}
        aria-live="polite"
        aria-atomic="true"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}
      />

      <s-page>
        {!catalogSynced && (
          <s-banner tone="info" heading="Catalog sync in progress">
            <s-text>
              We&apos;re syncing your store catalog. This may take a few minutes. You can start exploring the app while this runs.
            </s-text>
          </s-banner>
        )}

        {setupWizard.checklistVisible && setupWizard.currentStepView ? (
          <s-section heading="Setup wizard">
            <div style={{ display: "grid", gap: "1rem" }}>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <strong>
                  Step {setupWizard.currentStepView.index + 1} of {setupWizard.totalCount}: {setupWizard.currentStepView.title}
                </strong>
                <s-text>{setupWizard.currentStepView.description}</s-text>
                <div
                  role="progressbar"
                  aria-label="Setup progress"
                  aria-valuemin={0}
                  aria-valuemax={setupWizard.totalCount}
                  aria-valuenow={setupWizard.completedCount}
                  style={{
                    width: "100%",
                    height: "0.75rem",
                    borderRadius: "999px",
                    background: "var(--p-color-bg-surface-secondary, #f3f3f3)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${(setupWizard.completedCount / setupWizard.totalCount) * 100}%`,
                      height: "100%",
                      background: "var(--p-color-bg-fill-brand, #006fbb)",
                    }}
                  />
                </div>
                <s-text>
                  {setupWizard.completedCount} of {setupWizard.totalCount} steps complete
                </s-text>
              </div>

              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                {setupWizard.currentStepView.external || !isInternalAppHref(setupWizard.currentStepView.href) ? (
                  <a
                    href={setupWizard.currentStepView.href}
                    target={setupWizard.currentStepView.external ? "_blank" : undefined}
                    rel={setupWizard.currentStepView.external ? "noreferrer" : undefined}
                  >
                    <s-button variant="primary">{setupWizard.currentStepView.actionLabel}</s-button>
                  </a>
                ) : (
                  <Link to={setupWizard.currentStepView.href}>
                    <s-button variant="primary">{setupWizard.currentStepView.actionLabel}</s-button>
                  </Link>
                )}

                {setupWizard.currentStepView.manualCompletion ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="complete-setup-step" />
                    <input type="hidden" name="stepIndex" value={setupWizard.currentStepView.index} />
                    <s-button type="submit" variant="secondary">Mark complete</s-button>
                  </Form>
                ) : null}

                <Form method="post">
                  <input type="hidden" name="intent" value="skip-setup-step" />
                  <input type="hidden" name="stepIndex" value={setupWizard.currentStepView.index} />
                  <s-button type="submit" variant="secondary">
                    {setupWizard.currentStepView.optional ? "Skip optional step" : "Skip for now"}
                  </s-button>
                </Form>
              </div>
            </div>
          </s-section>
        ) : null}

        {catalogSynced && (
          <s-section heading="Catalog">
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "1.75rem", fontWeight: 650 }}>{productCount}</div>
                <s-text>{productCount === 1 ? "Product" : "Products"}</s-text>
              </div>
              <div>
                <div style={{ fontSize: "1.75rem", fontWeight: 650 }}>{variantCount}</div>
                <s-text>{variantCount === 1 ? "Variant" : "Variants"}</s-text>
              </div>
              <div>
                <div style={{ fontSize: "1.75rem", fontWeight: 650 }}>{configuredCount}</div>
                <s-text>{configuredCount === 1 ? "Variant configured" : "Variants configured"}</s-text>
              </div>
            </div>
            <div style={{ marginTop: "1rem" }}>
              <Link to="/app/variants">
                <s-button>View all variants</s-button>
              </Link>
            </div>
          </s-section>
        )}

        <s-section heading="Welcome to Count On Us">
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <s-text>
              Track production costs, calculate donation pools, and allocate donations to your chosen causes with full transparency for your customers.
            </s-text>
            <s-text>Complete the setup steps to get started.</s-text>
          </div>
        </s-section>

        {setupWizard.checklistVisible ? (
          <s-section heading="Setup checklist">
            {(() => {
              const incompleteSteps = setupWizard.steps.filter(
                (step: (typeof setupWizard.steps)[number]) => !step.completed,
              );

              return (
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <s-banner tone="warning">
                <s-text>
                  Some setup steps are still incomplete or were skipped earlier. Keep working through these until every item is complete.
                </s-text>
              </s-banner>

              <div style={{ display: "grid", gap: "0.75rem" }}>
                {incompleteSteps.map((step: (typeof incompleteSteps)[number]) => (
                    <div
                      key={step.key}
                      style={{
                        display: "grid",
                        gap: "0.5rem",
                        padding: "0.9rem 1rem",
                        border: "1px solid var(--p-color-border, #d2d5d8)",
                        borderRadius: "0.9rem",
                        background: "var(--p-color-bg-surface, #fff)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                        <div style={{ display: "grid", gap: "0.25rem" }}>
                          <strong>{step.title}</strong>
                          <s-text>{step.description}</s-text>
                        </div>
                        <s-badge tone={step.skipped ? "warning" : "critical"}>
                          {step.statusLabel}
                        </s-badge>
                      </div>

                      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                        {step.external || !isInternalAppHref(step.href) ? (
                          <a
                            href={step.href}
                            target={step.external ? "_blank" : undefined}
                            rel={step.external ? "noreferrer" : undefined}
                          >
                            <s-button variant="secondary">{step.actionLabel}</s-button>
                          </a>
                        ) : (
                          <Link to={step.href}>
                            <s-button variant="secondary">{step.actionLabel}</s-button>
                          </Link>
                        )}

                        {step.manualCompletion ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="complete-setup-step" />
                            <input type="hidden" name="stepIndex" value={step.index} />
                            <s-button type="submit" variant="secondary">Mark complete</s-button>
                          </Form>
                        ) : null}

                        {step.skipped ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="resume-setup-step" />
                            <input type="hidden" name="stepIndex" value={step.index} />
                            <s-button type="submit" variant="secondary">Resume step</s-button>
                          </Form>
                        ) : null}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
              );
            })()}
          </s-section>
        ) : null}
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Dashboard] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Dashboard" />
      <s-page>
        <s-banner tone="critical" heading="Dashboard unavailable">
          <p style={{ margin: 0, fontWeight: 650 }}>Something went wrong loading the dashboard.</p>
          <p style={{ margin: "0.5rem 0 0" }}>Please refresh the page. If the problem persists, contact support.</p>
        </s-banner>
      </s-page>
    </>
  );
}
