import { describe, expect, it } from "vitest";

import { resolveSetupWizardProgress } from "./setupWizard.server";

describe("resolveSetupWizardProgress", () => {
  it("starts at the first incomplete step after catalog sync", () => {
    const result = resolveSetupWizardProgress({
      shopDomain: "fixture.myshopify.com",
      catalogSynced: true,
      signals: {
        causeCount: 0,
        paymentRateConfigured: true,
        libraryCount: 0,
        templateCount: 0,
        configuredVariantCount: 0,
        productCauseAssignmentCount: 0,
      },
      storedState: null,
    });

    expect(result.currentStep).toBe(0);
    expect(result.currentStepView?.title).toContain("Create your first cause");
    expect(result.steps[1]?.completed).toBe(true);
  });

  it("advances past skipped steps while keeping them on the checklist", () => {
    const result = resolveSetupWizardProgress({
      shopDomain: "fixture.myshopify.com",
      catalogSynced: true,
      signals: {
        causeCount: 0,
        paymentRateConfigured: true,
        libraryCount: 0,
        templateCount: 0,
        configuredVariantCount: 0,
        productCauseAssignmentCount: 0,
      },
      storedState: {
        currentStep: 1,
        completedSteps: [],
        skippedSteps: [0],
      },
    });

    expect(result.currentStep).toBe(2);
    expect(result.steps[0]?.skipped).toBe(true);
    expect(result.steps[0]?.pending).toBe(true);
    expect(result.pendingCount).toBeGreaterThan(0);
  });

  it("treats manual storefront activation as complete when marked", () => {
    const result = resolveSetupWizardProgress({
      shopDomain: "fixture.myshopify.com",
      catalogSynced: true,
      signals: {
        causeCount: 1,
        paymentRateConfigured: true,
        libraryCount: 1,
        templateCount: 1,
        configuredVariantCount: 1,
        productCauseAssignmentCount: 1,
      },
      storedState: {
        currentStep: 8,
        completedSteps: [2, 6, 8],
        skippedSteps: [],
      },
    });

    expect(result.steps[8]?.completed).toBe(true);
    expect(result.steps[8]?.href).toContain("/admin/themes/current/editor");
    expect(result.allComplete).toBe(true);
  });

  it("suppresses the wizard until catalog sync finishes", () => {
    const result = resolveSetupWizardProgress({
      shopDomain: "fixture.myshopify.com",
      catalogSynced: false,
      signals: {
        causeCount: 0,
        paymentRateConfigured: false,
        libraryCount: 0,
        templateCount: 0,
        configuredVariantCount: 0,
        productCauseAssignmentCount: 0,
      },
      storedState: null,
    });

    expect(result.currentStep).toBeNull();
    expect(result.checklistVisible).toBe(false);
  });
});
