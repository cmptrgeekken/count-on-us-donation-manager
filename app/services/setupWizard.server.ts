import { prisma } from "../db.server";

export type SetupWizardStepDefinition = {
  index: number;
  key: string;
  title: string;
  description: string;
  href?: string;
  actionLabel: string;
  manualCompletion: boolean;
  optional?: boolean;
  external?: boolean;
};

export const setupWizardSteps = [
  {
    index: 0,
    key: "first-cause",
    title: "Create your first cause",
    description: "Add at least one cause so products can begin carrying donation allocations.",
    href: "/app/causes",
    actionLabel: "Open Causes",
    manualCompletion: false,
  },
  {
    index: 1,
    key: "shopify-payments-rate",
    title: "Confirm Shopify Payments fee rate",
    description: "Review the detected fee rate or add a manual override in Settings if Shopify detection is off.",
    href: "/app/settings",
    actionLabel: "Open Settings",
    manualCompletion: false,
  },
  {
    index: 2,
    key: "managed-markets-date",
    title: "Review Managed Markets enable date",
    description:
      "Managed Markets setup is still tracked manually. Review your international fee assumptions in Settings and mark this step complete when handled.",
    href: "/app/settings",
    actionLabel: "Open Settings",
    manualCompletion: true,
  },
  {
    index: 3,
    key: "libraries",
    title: "Set up material and equipment libraries",
    description: "Add at least one material or equipment record so templates have reusable building blocks.",
    href: "/app/materials",
    actionLabel: "Open Libraries",
    manualCompletion: false,
  },
  {
    index: 4,
    key: "cost-template",
    title: "Create a cost template",
    description: "Bundle reusable materials and equipment into a template for quicker variant setup.",
    href: "/app/templates",
    actionLabel: "Open Templates",
    manualCompletion: false,
  },
  {
    index: 5,
    key: "variant-costs",
    title: "Configure variant costs",
    description: "Assign templates or direct cost lines to at least one variant.",
    href: "/app/variants",
    actionLabel: "Open Variants",
    manualCompletion: false,
  },
  {
    index: 6,
    key: "pod-providers",
    title: "Connect POD providers",
    description:
      "Optional. Review Provider Connections and mark this step complete when you decide whether POD integrations are needed.",
    href: "/app/provider-connections",
    actionLabel: "Open Provider Connections",
    manualCompletion: true,
    optional: true,
  },
  {
    index: 7,
    key: "product-causes",
    title: "Assign causes to products",
    description: "Map causes to products so storefront and reporting flows can allocate donations correctly.",
    href: "/app/products",
    actionLabel: "Open Products",
    manualCompletion: false,
  },
  {
    index: 8,
    key: "storefront-widget",
    title: "Enable the storefront widget",
    description:
      "Open the Shopify Theme Editor and place the donation widget. Mark the step complete after you have activated it in your theme.",
    actionLabel: "Open Theme Editor",
    manualCompletion: true,
    external: true,
  },
] satisfies readonly SetupWizardStepDefinition[];

export type SetupWizardStepView = SetupWizardStepDefinition & {
  href: string;
  completed: boolean;
  skipped: boolean;
  pending: boolean;
  statusLabel: string;
};

type SetupWizardSignals = {
  causeCount: number;
  paymentRateConfigured: boolean;
  libraryCount: number;
  templateCount: number;
  configuredVariantCount: number;
  productCauseAssignmentCount: number;
};

type StoredWizardState = {
  currentStep: number;
  completedSteps: number[];
  skippedSteps: number[];
} | null;

export function resolveSetupWizardProgress(input: {
  shopDomain: string;
  catalogSynced: boolean;
  signals: SetupWizardSignals;
  storedState: StoredWizardState;
}) {
  const themeEditorHref = `https://${input.shopDomain}/admin/themes/current/editor?context=apps`;

  const completionByStep = new Map<number, boolean>([
    [0, input.signals.causeCount > 0],
    [1, input.signals.paymentRateConfigured],
    [2, false],
    [3, input.signals.libraryCount > 0],
    [4, input.signals.templateCount > 0],
    [5, input.signals.configuredVariantCount > 0],
    [6, false],
    [7, input.signals.productCauseAssignmentCount > 0],
    [8, false],
  ]);

  const completedSteps = new Set(input.storedState?.completedSteps ?? []);
  const skippedSteps = new Set(input.storedState?.skippedSteps ?? []);

  const steps: SetupWizardStepView[] = setupWizardSteps.map((step) => {
    const derivedComplete = completionByStep.get(step.index) ?? false;
    const completed = derivedComplete || completedSteps.has(step.index);
    const skipped = !completed && skippedSteps.has(step.index);
    return {
      ...step,
      href: step.key === "storefront-widget" ? themeEditorHref : step.href ?? "/app/dashboard",
      completed,
      skipped,
      pending: !completed,
      statusLabel: completed ? "Complete" : skipped ? "Skipped for now" : "Needs attention",
    };
  });

  const currentStep =
    input.catalogSynced
      ? steps.find((step) => !step.completed && !step.skipped)?.index ?? null
      : null;
  const completedCount = steps.filter((step) => step.completed).length;
  const pendingCount = steps.filter((step) => !step.completed).length;

  return {
    catalogSynced: input.catalogSynced,
    currentStep,
    currentStepView: currentStep === null ? null : steps.find((step) => step.index === currentStep) ?? null,
    completedCount,
    totalCount: steps.length,
    pendingCount,
    allComplete: completedCount === steps.length,
    checklistVisible: input.catalogSynced && completedCount < steps.length,
    steps,
  };
}

export async function getSetupWizardProgress(shopId: string, db = prisma) {
  const [
    shop,
    wizardState,
    causeCount,
    materialCount,
    equipmentCount,
    templateCount,
    configuredVariantCount,
    productCauseAssignmentCount,
  ] = await Promise.all([
    db.shop.findUnique({
      where: { shopId },
      select: {
        shopifyDomain: true,
        catalogSynced: true,
        paymentRate: true,
      },
    }),
    db.wizardState.findUnique({
      where: { shopId },
      select: {
        currentStep: true,
        completedSteps: true,
        skippedSteps: true,
      },
    }),
    db.cause.count({ where: { shopId } }),
    db.materialLibraryItem.count({ where: { shopId } }),
    db.equipmentLibraryItem.count({ where: { shopId } }),
    db.costTemplate.count({ where: { shopId } }),
    db.variantCostConfig.count({ where: { shopId } }),
    db.productCauseAssignment.count({ where: { shopId } }),
  ]);

  return resolveSetupWizardProgress({
    shopDomain: shop?.shopifyDomain ?? shopId,
    catalogSynced: shop?.catalogSynced ?? false,
    signals: {
      causeCount,
      paymentRateConfigured: shop?.paymentRate !== null && shop?.paymentRate !== undefined,
      libraryCount: materialCount + equipmentCount,
      templateCount,
      configuredVariantCount,
      productCauseAssignmentCount,
    },
    storedState: wizardState,
  });
}

export async function updateSetupWizardState(
  input: {
    shopId: string;
    stepIndex: number;
    action: "complete" | "skip" | "resume";
  },
  db = prisma,
) {
  const existing = await db.wizardState.upsert({
    where: { shopId: input.shopId },
    update: {},
    create: {
      shopId: input.shopId,
      currentStep: 0,
      completedSteps: [],
      skippedSteps: [],
    },
    select: {
      currentStep: true,
      completedSteps: true,
      skippedSteps: true,
    },
  });

  const completed = new Set(existing.completedSteps);
  const skipped = new Set(existing.skippedSteps);
  let currentStep = existing.currentStep;

  if (input.action === "complete") {
    completed.add(input.stepIndex);
    skipped.delete(input.stepIndex);
    currentStep = Math.min(input.stepIndex + 1, setupWizardSteps.length - 1);
  } else if (input.action === "skip") {
    if (!completed.has(input.stepIndex)) {
      skipped.add(input.stepIndex);
    }
    currentStep = Math.min(input.stepIndex + 1, setupWizardSteps.length - 1);
  } else {
    skipped.delete(input.stepIndex);
    currentStep = input.stepIndex;
  }

  await db.$transaction([
    db.wizardState.update({
      where: { shopId: input.shopId },
      data: {
        currentStep,
        completedSteps: Array.from(completed).sort((left, right) => left - right),
        skippedSteps: Array.from(skipped).sort((left, right) => left - right),
      },
    }),
    db.shop.update({
      where: { shopId: input.shopId },
      data: {
        wizardStep: currentStep,
      },
    }),
  ]);
}
