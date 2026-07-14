import { jsonResponse } from "~/utils/json-response.server";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import {
  Link,
  useFetcher,
  useLoaderData,
  useNavigate,
  useRouteError,
  useSearchParams,
} from "@remix-run/react";
import { Prisma } from "@prisma/client";
import {
  AssignmentFilterPicker,
  AssignmentPicker,
} from "../components/AssignmentControls";
import {
  ResourceTableHeader,
  TableColumnFilter,
  TableTextFilterFields,
} from "../components/admin-ui";
import { prisma } from "../db.server";
import {
  buildVariantEstimatePayload,
  type VariantEstimatePayload,
} from "../services/variantEstimate.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { parseOptionalPositiveWholeNumber } from "../utils/number-parsing";
import { buildTextFilter, parseTextMatchMode } from "../utils/text-filter";
import { materialLineValuesEqual } from "../utils/material-line-comparison";
import { useAppLocalization } from "../utils/use-app-localization";
import { isVariantCostConfigured } from "../utils/variant-cost-readiness";
import { buildProductSearchFilter } from "../utils/product-search";

type BulkAssignmentMismatch = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  materialNames: string[];
  equipmentNames: string[];
};

function nullableDecimalEqual(
  left: { toString(): string } | null,
  right: { toString(): string } | null,
) {
  if (left === null || right === null) return left === right;
  return left.toString() === right.toString();
}

function pushUnique(values: string[], value: string) {
  if (!values.includes(value)) values.push(value);
}

const filterControlStyle = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box" as const,
  padding: "0.75rem",
  borderRadius: "0.75rem",
  border: "1px solid var(--p-color-border, #d2d5d8)",
  background: "var(--p-color-bg-surface, #fff)",
  color: "var(--p-color-text, #303030)",
  font: "inherit",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const filterProductId = url.searchParams.get("product") ?? "";
  const filterCategory = url.searchParams.get("category") ?? "";
  const filterConfigured = url.searchParams.get("configured") ?? "";
  const filterProductTitle = url.searchParams.get("productTitle")?.trim() ?? "";
  const filterVariantTitle = url.searchParams.get("variantTitle")?.trim() ?? "";
  const filterSku = url.searchParams.get("sku")?.trim() ?? "";
  const filterTemplate = url.searchParams.get("template")?.trim() ?? "";
  const filterPodProvider = url.searchParams.get("podProvider")?.trim() ?? "";
  const filterTags = [
    ...new Set(
      url.searchParams
        .getAll("tag")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const filterCollectionIds = [
    ...new Set(
      url.searchParams
        .getAll("collection")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  const filterProductTitleMatch = parseTextMatchMode(
    url.searchParams.get("productTitleMatch"),
  );
  const filterVariantTitleMatch = parseTextMatchMode(
    url.searchParams.get("variantTitleMatch"),
  );
  const filterSkuMatch = parseTextMatchMode(
    url.searchParams.get("skuMatch"),
    true,
  );
  const filterTemplateMatch = parseTextMatchMode(
    url.searchParams.get("templateMatch"),
    true,
  );
  const filterPodProviderMatch = parseTextMatchMode(
    url.searchParams.get("podProviderMatch"),
    true,
  );

  const [
    allVariants,
    products,
    templates,
    shop,
    taxOffsetCache,
    availableTags,
    availableCollections,
  ] = await Promise.all([
    prisma.variant.findMany({
      where: {
        shopId,
        ...(filterProductId ? { productId: filterProductId } : {}),
        ...(filterCategory ||
        filterProductTitle ||
        filterTags.length > 0 ||
        filterCollectionIds.length > 0
          ? {
              product: {
                ...(filterCategory
                  ? { productCategoryPath: filterCategory }
                  : {}),
                ...(filterProductTitle
                  ? buildProductSearchFilter(
                      filterProductTitle,
                      filterProductTitleMatch,
                    )
                  : {}),
                ...(filterTags.length > 0
                  ? { tags: { some: { shopId, value: { in: filterTags } } } }
                  : {}),
                ...(filterCollectionIds.length > 0
                  ? {
                      collections: {
                        some: {
                          shopId,
                          collectionId: { in: filterCollectionIds },
                        },
                      },
                    }
                  : {}),
              },
            }
          : {}),
        ...(filterVariantTitle
          ? {
              title: buildTextFilter(
                filterVariantTitle,
                filterVariantTitleMatch,
              ),
            }
          : {}),
        ...(filterSkuMatch !== "empty" && filterSku
          ? { sku: buildTextFilter(filterSku, filterSkuMatch) }
          : {}),
        ...(filterTemplateMatch !== "empty" && filterTemplate
          ? {
              costConfig: {
                productionTemplate: {
                  name: buildTextFilter(filterTemplate, filterTemplateMatch),
                },
              },
            }
          : {}),
        ...(filterPodProviderMatch !== "empty" && filterPodProvider
          ? {
              providerMappings: {
                some: {
                  status: "mapped",
                  provider: buildTextFilter(
                    filterPodProvider,
                    filterPodProviderMatch,
                  ),
                },
              },
            }
          : {}),
        ...(filterSkuMatch === "empty" || filterTemplateMatch === "empty"
          ? {
              AND: [
                ...(filterSkuMatch === "empty"
                  ? [{ OR: [{ sku: null }, { sku: "" }] }]
                  : []),
                ...(filterTemplateMatch === "empty"
                  ? [
                      {
                        OR: [
                          { costConfig: { is: null } },
                          {
                            costConfig: {
                              is: { productionTemplate: { is: null } },
                            },
                          },
                        ],
                      },
                    ]
                  : []),
              ],
            }
          : {}),
        ...(filterPodProviderMatch === "empty"
          ? { providerMappings: { none: { status: "mapped" } } }
          : {}),
      },
      orderBy: [{ product: { title: "asc" } }, { title: "asc" }],
      include: {
        product: {
          select: { id: true, title: true, donationRoutingMode: true },
        },
        costConfig: {
          select: {
            productionTemplateId: true,
            shippingTemplateId: true,
            templateProductYield: true,
            productionTemplate: { select: { name: true } },
            _count: {
              select: {
                materialLines: true,
                equipmentLines: true,
              },
            },
          },
        },
        providerMappings: {
          where: { status: "mapped" },
          orderBy: [{ lastCostSyncedAt: "desc" }, { updatedAt: "desc" }],
          select: {
            provider: true,
            lastCostSyncedAt: true,
          },
        },
      },
    }),
    prisma.product.findMany({
      where: { shopId },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        productCategoryName: true,
        productCategoryPath: true,
      },
    }),
    prisma.costTemplate.findMany({
      where: { shopId, status: "active", type: "production" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.shop.findUnique({
      where: { shopId },
      select: {
        currency: true,
        paymentRate: true,
        effectiveTaxRate: true,
        taxDeductionMode: true,
      },
    }),
    prisma.taxOffsetCache.findUnique({
      where: { shopId },
      select: {
        widgetTaxSuppressed: true,
      },
    }),
    prisma.productTag.findMany({
      where: { shopId },
      distinct: ["value"],
      orderBy: { value: "asc" },
      select: { value: true },
    }),
    prisma.shopifyCollection.findMany({
      where: { shopId },
      orderBy: { title: "asc" },
      select: { id: true, title: true, handle: true },
    }),
  ]);

  const variants = allVariants.filter((variant) => {
    if (filterConfigured === "yes")
      return isVariantCostConfigured(variant.costConfig);
    if (filterConfigured === "no")
      return !isVariantCostConfigured(variant.costConfig);
    return true;
  });

  const productIds = [...new Set(variants.map((variant) => variant.productId))];
  const causeAssignments = await prisma.productCauseAssignment.findMany({
    where: {
      shopId,
      productId: { in: productIds },
      cause: {
        status: "active",
      },
    },
    orderBy: [{ percentage: "desc" }, { cause: { name: "asc" } }],
    select: {
      productId: true,
      causeId: true,
      percentage: true,
      cause: {
        select: {
          id: true,
          name: true,
          is501c3: true,
          iconUrl: true,
          donationLink: true,
        },
      },
    },
  });
  const artistAssignments = await prisma.productArtistAssignment.findMany({
    where: {
      shopId,
      productId: { in: productIds },
      status: "active",
    },
    orderBy: [{ attributionOrder: "asc" }, { createdAt: "asc" }],
    select: {
      productId: true,
      collaborationShare: true,
      payoutEnabledOverride: true,
      payoutRateOverride: true,
      artist: {
        select: {
          paymentEnabled: true,
          defaultPayoutRate: true,
          causeAssignments: {
            select: {
              causeId: true,
              percentage: true,
              cause: {
                select: {
                  id: true,
                  name: true,
                  is501c3: true,
                  iconUrl: true,
                  donationLink: true,
                },
              },
            },
          },
        },
      },
    },
  });
  const causeAssignmentsByProductId = new Map<
    string,
    typeof causeAssignments
  >();
  for (const assignment of causeAssignments) {
    if (!assignment.productId) continue;
    const current = causeAssignmentsByProductId.get(assignment.productId) ?? [];
    current.push(assignment);
    causeAssignmentsByProductId.set(assignment.productId, current);
  }
  const artistAssignmentsByProductId = new Map<
    string,
    typeof artistAssignments
  >();
  for (const assignment of artistAssignments) {
    if (!assignment.productId) continue;
    const current =
      artistAssignmentsByProductId.get(assignment.productId) ?? [];
    current.push(assignment);
    artistAssignmentsByProductId.set(assignment.productId, current);
  }
  const widgetTaxSuppressed = taxOffsetCache?.widgetTaxSuppressed ?? true;
  const estimates = shop
    ? await Promise.all(
        variants.map((variant) =>
          buildVariantEstimatePayload({
            shopId,
            variant,
            causeAssignments:
              causeAssignmentsByProductId.get(variant.productId) ?? [],
            artistAssignments:
              artistAssignmentsByProductId.get(variant.productId) ?? [],
            donationRoutingMode: variant.product.donationRoutingMode,
            shop,
            widgetTaxSuppressed,
            db: prisma,
          }),
        ),
      )
    : variants.map(() => null);

  return jsonResponse({
    variants: variants.map((v, index) => ({
      id: v.id,
      shopifyId: v.shopifyId,
      productId: v.productId,
      productTitle: v.product.title,
      title: v.title,
      sku: v.sku ?? "",
      price: v.price.toString(),
      hasConfig: isVariantCostConfigured(v.costConfig),
      templateName: v.costConfig?.productionTemplate?.name ?? null,
      templateProductYield:
        v.costConfig?.templateProductYield?.toString() ?? null,
      mappedProviders: Array.from(
        new Set(v.providerMappings.map((mapping) => mapping.provider)),
      ),
      latestProviderSyncAt:
        v.providerMappings[0]?.lastCostSyncedAt?.toISOString() ?? null,
      estimate: estimates[index],
    })),
    products: products.map((p) => ({ id: p.id, title: p.title })),
    categories: Array.from(
      new Map(
        products
          .filter((p) => p.productCategoryPath)
          .map((p) => [
            p.productCategoryPath ?? "",
            {
              value: p.productCategoryPath ?? "",
              label: p.productCategoryName ?? p.productCategoryPath ?? "",
            },
          ]),
      ).values(),
    ).sort((a, b) => a.label.localeCompare(b.label)),
    templates: templates.map((t) => ({ id: t.id, name: t.name })),
    availableTags: availableTags.map((tag) => ({
      id: tag.value,
      label: tag.value,
    })),
    availableCollections: availableCollections.map((collection) => ({
      id: collection.id,
      label: collection.title,
      description: collection.handle,
    })),
    filterProductId,
    filterCategory,
    filterConfigured,
    filterProductTitle,
    filterVariantTitle,
    filterSku,
    filterTemplate,
    filterPodProvider,
    filterTags,
    filterCollectionIds,
    filterProductTitleMatch,
    filterVariantTitleMatch,
    filterSkuMatch,
    filterTemplateMatch,
    filterPodProviderMatch,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "bulk-assign-template") {
    const templateId = formData.get("templateId")?.toString() ?? "";
    const templateProductYieldInput =
      formData.get("templateProductYield")?.toString() ?? "";
    let templateProductYield: number | null;
    try {
      templateProductYield = parseOptionalPositiveWholeNumber(
        templateProductYieldInput,
        "Template product yield",
      );
    } catch (error) {
      if (error instanceof Response) {
        return jsonResponse(
          { ok: false, message: await error.text() },
          { status: error.status },
        );
      }
      throw error;
    }
    const variantIds = [...new Set(formData.getAll("variantId").map(String))];
    const cleanupExactDuplicates =
      formData.get("cleanupExactDuplicates")?.toString() === "true";

    if (!templateId) {
      return jsonResponse(
        { ok: false, message: "No template selected." },
        { status: 400 },
      );
    }
    if (variantIds.length === 0) {
      return jsonResponse(
        { ok: false, message: "No variants selected." },
        { status: 400 },
      );
    }

    const template = await prisma.costTemplate.findFirst({
      where: { id: templateId, shopId },
      select: {
        shopId: true,
        materialLines: {
          select: {
            id: true,
            materialId: true,
            quantity: true,
            yield: true,
            usesPerVariant: true,
            material: { select: { name: true, costingModel: true } },
          },
        },
        defaultShippingTemplate: {
          select: {
            materialLines: {
              select: {
                id: true,
                materialId: true,
                quantity: true,
                yield: true,
                usesPerVariant: true,
                material: { select: { name: true, costingModel: true } },
              },
            },
          },
        },
        equipmentLines: {
          select: {
            id: true,
            equipmentId: true,
            usageMode: true,
            minutes: true,
            uses: true,
            yieldDurationMinutes: true,
            yieldUses: true,
            yieldQuantity: true,
            equipment: { select: { name: true } },
          },
        },
      },
    });

    if (!template) {
      return jsonResponse(
        { ok: false, message: "Template not found." },
        { status: 404 },
      );
    }

    const variantsToAssign = await prisma.variant.findMany({
      where: { id: { in: variantIds }, shopId },
      select: {
        id: true,
        title: true,
        product: { select: { title: true } },
        costConfig: {
          include: {
            materialLines: {
              where: { templateLineId: null },
              include: { material: { select: { name: true } } },
            },
            equipmentLines: {
              where: { templateLineId: null },
              include: { equipment: { select: { name: true } } },
            },
            shippingTemplate: {
              select: {
                materialLines: {
                  select: {
                    id: true,
                    materialId: true,
                    quantity: true,
                    yield: true,
                    usesPerVariant: true,
                    material: { select: { name: true, costingModel: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (variantsToAssign.length !== variantIds.length) {
      return jsonResponse(
        {
          ok: false,
          message: "One or more selected variants could not be found.",
        },
        { status: 404 },
      );
    }

    const templateEquipmentLinesByEquipmentId = new Map<
      string,
      typeof template.equipmentLines
    >();
    for (const line of template.equipmentLines) {
      templateEquipmentLinesByEquipmentId.set(line.equipmentId, [
        ...(templateEquipmentLinesByEquipmentId.get(line.equipmentId) ?? []),
        line,
      ]);
    }

    const exactDuplicateMaterialLineIds: string[] = [];
    const exactDuplicateEquipmentLineIds: string[] = [];
    const mismatches: BulkAssignmentMismatch[] = [];

    for (const variant of variantsToAssign) {
      if (!variant.costConfig) continue;

      const mismatch: BulkAssignmentMismatch = {
        variantId: variant.id,
        productTitle: variant.product.title,
        variantTitle: variant.title,
        materialNames: [],
        equipmentNames: [],
      };

      const effectiveShippingMaterialLines =
        variant.costConfig.shippingTemplate?.materialLines ??
        template.defaultShippingTemplate?.materialLines ??
        [];
      const effectiveTemplateMaterialLines = [
        ...template.materialLines,
        ...effectiveShippingMaterialLines,
      ];
      const productionTemplateLineIds = new Set(
        template.materialLines.map((line) => line.id),
      );
      const templateMaterialLinesByMaterialId = new Map<
        string,
        typeof effectiveTemplateMaterialLines
      >();
      for (const line of effectiveTemplateMaterialLines) {
        templateMaterialLinesByMaterialId.set(line.materialId, [
          ...(templateMaterialLinesByMaterialId.get(line.materialId) ?? []),
          line,
        ]);
      }

      for (const variantLine of variant.costConfig.materialLines) {
        const matchingTemplateLines =
          templateMaterialLinesByMaterialId.get(variantLine.materialId) ?? [];
        if (matchingTemplateLines.length !== 1) continue;

        const templateLine = matchingTemplateLines[0];
        const effectiveTemplateYield =
          productionTemplateLineIds.has(templateLine.id) &&
          templateProductYield &&
          templateLine.material.costingModel === "yield"
            ? new Prisma.Decimal(templateProductYield)
            : templateLine.yield;
        const isExactDuplicate = materialLineValuesEqual(
          templateLine.material.costingModel,
          variantLine,
          { ...templateLine, yield: effectiveTemplateYield },
        );

        if (isExactDuplicate) {
          exactDuplicateMaterialLineIds.push(variantLine.id);
        } else {
          pushUnique(mismatch.materialNames, variantLine.material.name);
        }
      }

      for (const variantLine of variant.costConfig.equipmentLines) {
        const matchingTemplateLines =
          templateEquipmentLinesByEquipmentId.get(variantLine.equipmentId) ??
          [];
        if (matchingTemplateLines.length !== 1) continue;

        const templateLine = matchingTemplateLines[0];
        const effectiveTemplateYieldQuantity =
          templateProductYield &&
          (templateLine.usageMode === "duration_yield" ||
            templateLine.usageMode === "use_yield")
            ? new Prisma.Decimal(templateProductYield)
            : templateLine.yieldQuantity;
        const isExactDuplicate =
          variantLine.usageMode === templateLine.usageMode &&
          nullableDecimalEqual(variantLine.minutes, templateLine.minutes) &&
          nullableDecimalEqual(variantLine.uses, templateLine.uses) &&
          nullableDecimalEqual(
            variantLine.yieldDurationMinutes,
            templateLine.yieldDurationMinutes,
          ) &&
          nullableDecimalEqual(variantLine.yieldUses, templateLine.yieldUses) &&
          nullableDecimalEqual(
            variantLine.yieldQuantity,
            effectiveTemplateYieldQuantity,
          );

        if (isExactDuplicate) {
          exactDuplicateEquipmentLineIds.push(variantLine.id);
        } else {
          pushUnique(mismatch.equipmentNames, variantLine.equipment.name);
        }
      }

      if (
        mismatch.materialNames.length > 0 ||
        mismatch.equipmentNames.length > 0
      ) {
        mismatches.push(mismatch);
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const variant of variantsToAssign) {
        if (variant.costConfig) {
          await tx.variantCostConfig.updateMany({
            where: { id: variant.costConfig.id, shopId },
            data: { productionTemplateId: templateId, templateProductYield },
          });
        } else {
          await tx.variantCostConfig.create({
            data: {
              shopId,
              variantId: variant.id,
              productionTemplateId: templateId,
              templateProductYield,
            },
          });
        }
      }

      if (cleanupExactDuplicates && exactDuplicateMaterialLineIds.length > 0) {
        await tx.variantMaterialLine.deleteMany({
          where: { id: { in: exactDuplicateMaterialLineIds }, shopId },
        });
      }

      if (cleanupExactDuplicates && exactDuplicateEquipmentLineIds.length > 0) {
        await tx.variantEquipmentLine.deleteMany({
          where: { id: { in: exactDuplicateEquipmentLineIds }, shopId },
        });
      }

      if (cleanupExactDuplicates) {
        const deletedLineCountByConfigId = new Map<string, number>();
        for (const variant of variantsToAssign) {
          const config = variant.costConfig;
          if (!config) continue;

          const deletedMaterialCount = config.materialLines.filter((line) =>
            exactDuplicateMaterialLineIds.includes(line.id),
          ).length;
          const deletedEquipmentCount = config.equipmentLines.filter((line) =>
            exactDuplicateEquipmentLineIds.includes(line.id),
          ).length;
          const deletedCount = deletedMaterialCount + deletedEquipmentCount;

          if (deletedCount > 0) {
            deletedLineCountByConfigId.set(config.id, deletedCount);
          }
        }

        for (const [configId, deletedCount] of deletedLineCountByConfigId) {
          await tx.variantCostConfig.updateMany({
            where: { id: configId, shopId },
            data: { lineItemCount: { decrement: deletedCount } },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "VariantCostConfig",
          action: "BULK_TEMPLATE_ASSIGNED",
          actor: "merchant",
          payload: {
            templateId,
            templateProductYield,
            variantCount: variantIds.length,
            cleanupExactDuplicates,
            cleanedMaterialLineCount: cleanupExactDuplicates
              ? exactDuplicateMaterialLineIds.length
              : 0,
            cleanedEquipmentLineCount: cleanupExactDuplicates
              ? exactDuplicateEquipmentLineIds.length
              : 0,
            mismatchVariantCount: mismatches.length,
          },
        },
      });
    });

    const cleanedLineCount = cleanupExactDuplicates
      ? exactDuplicateMaterialLineIds.length +
        exactDuplicateEquipmentLineIds.length
      : 0;

    return jsonResponse({
      ok: true,
      message: cleanupExactDuplicates
        ? `Template assigned to ${variantIds.length} variant(s). Removed ${cleanedLineCount} exact duplicate line item(s).`
        : `Template assigned to ${variantIds.length} variant(s).`,
      cleanedLineCount,
      mismatches,
    });
  }

  return jsonResponse(
    { ok: false, message: "Unknown action." },
    { status: 400 },
  );
};

type VariantRow = {
  id: string;
  shopifyId: string;
  productId: string;
  productTitle: string;
  title: string;
  sku: string;
  price: string;
  hasConfig: boolean;
  templateName: string | null;
  templateProductYield: string | null;
  mappedProviders: string[];
  latestProviderSyncAt: string | null;
  estimate: VariantEstimatePayload | null;
};

function formatProviderLabel(provider: string) {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function estimateTotalCost(estimate: VariantEstimatePayload) {
  return [
    estimate.reconciliation.labor,
    estimate.reconciliation.materials,
    estimate.reconciliation.packaging,
    estimate.reconciliation.equipment,
    estimate.reconciliation.pod,
    estimate.reconciliation.mistakeBuffer,
    estimate.reconciliation.artistPayout,
    estimate.reconciliation.shopifyFees,
    estimate.reconciliation.taxReserve,
  ]
    .reduce((sum, amount) => sum + Number(amount), 0)
    .toFixed(2);
}

export default function VariantsPage() {
  const {
    variants,
    products,
    categories,
    templates,
    availableTags,
    availableCollections,
    filterProductId,
    filterCategory,
    filterConfigured,
    filterProductTitle,
    filterVariantTitle,
    filterSku,
    filterTemplate,
    filterPodProvider,
    filterTags,
    filterCollectionIds,
    filterProductTitleMatch,
    filterVariantTitleMatch,
    filterSkuMatch,
    filterTemplateMatch,
    filterPodProviderMatch,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{
    ok: boolean;
    message: string;
    cleanedLineCount?: number;
    mismatches?: BulkAssignmentMismatch[];
  }>();
  const { formatMoney } = useAppLocalization();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const assignDialogRef = useRef<HTMLDialogElement>(null);
  const confirmDialogRef = useRef<HTMLDialogElement>(null);

  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateProductYield, setTemplateProductYield] = useState("");
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingAssign, setPendingAssign] = useState<string[]>([]);
  const [overwriteCount, setOverwriteCount] = useState(0);
  const [cleanupExactDuplicates, setCleanupExactDuplicates] = useState(false);
  const [exportingEstimates, setExportingEstimates] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    setSelectedVariantIds((current) =>
      current.filter((id) =>
        variants.some((variant: VariantRow) => variant.id === id),
      ),
    );
  }, [variants]);

  useEffect(() => {
    const dialog = assignDialogRef.current;
    if (!dialog) return;

    if (assignDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!assignDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [assignDialogOpen]);

  useEffect(() => {
    const dialog = confirmDialogRef.current;
    if (!dialog) return;

    if (confirmDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!confirmDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [confirmDialogOpen]);

  const isSubmitting = fetcher.state !== "idle";
  const statusMessage = fetcher.data?.message ?? "";
  const assignmentMismatches = fetcher.data?.ok
    ? (fetcher.data.mismatches ?? [])
    : [];
  const allSelected =
    variants.length > 0 && selectedVariantIds.length === variants.length;
  const selectedTemplate =
    templates.find(
      (template: { id: string; name: string }) =>
        template.id === selectedTemplateId,
    ) ?? null;
  const hasActiveFilters = Boolean(
    filterProductId ||
    filterCategory ||
    filterConfigured ||
    filterProductTitle ||
    filterTags.length > 0 ||
    filterCollectionIds.length > 0 ||
    filterVariantTitle ||
    filterSku ||
    filterTemplate ||
    filterPodProvider ||
    filterSkuMatch === "empty" ||
    filterTemplateMatch === "empty" ||
    filterPodProviderMatch === "empty",
  );

  const selectedConfiguredCount = useMemo(
    () =>
      variants.filter(
        (variant: VariantRow) =>
          selectedVariantIds.includes(variant.id) && variant.hasConfig,
      ).length,
    [selectedVariantIds, variants],
  );

  function updateSelection(id: string, checked: boolean) {
    setSelectedVariantIds((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((value) => value !== id),
    );
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedVariantIds(
      checked ? variants.map((variant: VariantRow) => variant.id) : [],
    );
  }

  function clearSelection() {
    setSelectedVariantIds([]);
  }

  function openAssignDialog() {
    setSelectedTemplateId("");
    setTemplateProductYield("");
    setCleanupExactDuplicates(false);
    setAssignDialogOpen(true);
  }

  function closeAssignDialog() {
    setAssignDialogOpen(false);
  }

  function closeConfirmDialog() {
    setConfirmDialogOpen(false);
    setPendingAssign([]);
    setOverwriteCount(0);
  }

  function submitAssign(ids: string[]) {
    const fd = new FormData();
    fd.append("intent", "bulk-assign-template");
    fd.append("templateId", selectedTemplateId);
    fd.append("templateProductYield", templateProductYield);
    if (cleanupExactDuplicates) fd.append("cleanupExactDuplicates", "true");
    ids.forEach((id) => fd.append("variantId", id));
    fetcher.submit(fd, { method: "post" });
    clearSelection();
    closeAssignDialog();
    closeConfirmDialog();
  }

  function handleBulkAssign() {
    if (selectedVariantIds.length === 0 || !selectedTemplateId) {
      return;
    }

    setPendingAssign(selectedVariantIds);

    if (selectedConfiguredCount > 0) {
      setOverwriteCount(selectedConfiguredCount);
      setConfirmDialogOpen(true);
    } else {
      submitAssign(selectedVariantIds);
    }
  }

  function applyFilters(form: HTMLFormElement) {
    const formData = new FormData(form);
    const params = new URLSearchParams(searchParams);

    for (const name of [
      "product",
      "category",
      "configured",
      "productTitle",
      "variantTitle",
      "sku",
      "template",
      "podProvider",
    ]) {
      if (!formData.has(name)) continue;
      const value = formData.get(name)?.toString().trim() ?? "";
      if (value) params.set(name, value);
      else params.delete(name);
    }
    for (const name of [
      "productTitleMatch",
      "variantTitleMatch",
      "skuMatch",
      "templateMatch",
      "podProviderMatch",
    ]) {
      if (!formData.has(name)) continue;
      const value = formData.get(name)?.toString() ?? "contains";
      if (value !== "contains") params.set(name, value);
      else params.delete(name);
    }
    for (const name of ["tag", "collection"]) {
      params.delete(name);
      for (const value of formData.getAll(name).map(String).filter(Boolean))
        params.append(name, value);
    }

    navigate(`?${params.toString()}`);
  }

  function clearFilterNames(names: string[]): void {
    const params = new URLSearchParams(searchParams);
    for (const name of names) params.delete(name);
    navigate(`?${params.toString()}`);
  }

  function clearFilters() {
    const params = new URLSearchParams(searchParams);
    params.delete("product");
    params.delete("category");
    params.delete("configured");
    params.delete("productTitle");
    params.delete("variantTitle");
    params.delete("sku");
    params.delete("template");
    params.delete("podProvider");
    params.delete("productTitleMatch");
    params.delete("variantTitleMatch");
    params.delete("skuMatch");
    params.delete("templateMatch");
    params.delete("podProviderMatch");
    params.delete("tag");
    params.delete("collection");
    navigate(`?${params.toString()}`);
  }

  function exportUrl() {
    const params = new URLSearchParams();
    const product = searchParams.get("product");
    const category = searchParams.get("category");
    const configured = searchParams.get("configured");
    const productTitle = searchParams.get("productTitle");
    const variantTitle = searchParams.get("variantTitle");
    const sku = searchParams.get("sku");
    const template = searchParams.get("template");
    const podProvider = searchParams.get("podProvider");
    const productTitleMatch = searchParams.get("productTitleMatch");
    const variantTitleMatch = searchParams.get("variantTitleMatch");
    const skuMatch = searchParams.get("skuMatch");
    const templateMatch = searchParams.get("templateMatch");
    const podProviderMatch = searchParams.get("podProviderMatch");
    const tags = searchParams.getAll("tag");
    const collections = searchParams.getAll("collection");
    if (product) params.set("product", product);
    if (category) params.set("category", category);
    if (configured) params.set("configured", configured);
    if (productTitle) params.set("productTitle", productTitle);
    if (variantTitle) params.set("variantTitle", variantTitle);
    if (sku) params.set("sku", sku);
    if (template) params.set("template", template);
    if (podProvider) params.set("podProvider", podProvider);
    if (productTitleMatch) params.set("productTitleMatch", productTitleMatch);
    if (variantTitleMatch) params.set("variantTitleMatch", variantTitleMatch);
    if (skuMatch) params.set("skuMatch", skuMatch);
    if (templateMatch) params.set("templateMatch", templateMatch);
    if (podProviderMatch) params.set("podProviderMatch", podProviderMatch);
    tags.forEach((tag) => params.append("tag", tag));
    collections.forEach((collection) =>
      params.append("collection", collection),
    );
    const query = params.toString();
    return `/app/variants-export${query ? `?${query}` : ""}`;
  }

  async function exportEstimates() {
    setExportError("");
    setExportingEstimates(true);
    try {
      const response = await fetch(exportUrl(), {
        credentials: "same-origin",
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Unable to export variant estimates.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "variant-estimates.csv";
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Unable to export variant estimates.",
      );
    } finally {
      setExportingEstimates(false);
    }
  }

  return (
    <>
      <ui-title-bar title="Variants" />

      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
        }}
      >
        {statusMessage}
      </div>

      <s-page>
        {fetcher.data && !fetcher.data.ok && (
          <s-banner tone="critical">
            <s-text>{fetcher.data.message}</s-text>
          </s-banner>
        )}
        {fetcher.data?.ok && fetcher.data.message && (
          <s-banner tone="success">
            <s-text>{fetcher.data.message}</s-text>
          </s-banner>
        )}
        {assignmentMismatches.length > 0 && (
          <s-banner tone="warning">
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <s-text>
                Review {assignmentMismatches.length} variant
                {assignmentMismatches.length === 1 ? "" : "s"} with matching
                template items but different line settings.
              </s-text>
              <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                {assignmentMismatches.map((mismatch) => (
                  <li key={mismatch.variantId}>
                    <Link to={`/app/variants/${mismatch.variantId}`}>
                      {mismatch.productTitle} / {mismatch.variantTitle}
                    </Link>
                    {mismatch.materialNames.length > 0
                      ? ` - Materials: ${mismatch.materialNames.join(", ")}`
                      : ""}
                    {mismatch.equipmentNames.length > 0
                      ? `${mismatch.materialNames.length > 0 ? "; " : " - "}Equipment: ${mismatch.equipmentNames.join(", ")}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          </s-banner>
        )}
        {exportError ? (
          <s-banner tone="critical">
            <s-text>{exportError}</s-text>
          </s-banner>
        ) : null}

        {variants.length === 0 &&
        !filterProductId &&
        !filterCategory &&
        !filterConfigured &&
        !filterProductTitle &&
        !filterVariantTitle &&
        !filterSku &&
        !filterTemplate &&
        !filterPodProvider &&
        filterSkuMatch !== "empty" &&
        filterTemplateMatch !== "empty" &&
        filterPodProviderMatch !== "empty" ? (
          <s-section heading="No variants synced yet">
            <s-text>
              Variants will appear here after the initial catalog sync
              completes.
            </s-text>
          </s-section>
        ) : (
          <>
            {selectedVariantIds.length > 0 && (
              <s-section>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "1rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "grid", gap: "0.25rem" }}>
                    <strong>
                      {selectedVariantIds.length} variant
                      {selectedVariantIds.length !== 1 ? "s" : ""} selected
                    </strong>
                    <s-text color="subdued">
                      {selectedConfiguredCount > 0
                        ? `${selectedConfiguredCount} selected variant(s) already have a configuration.`
                        : "Assign a template to the selected variants."}
                    </s-text>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.75rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <s-button variant="secondary" onClick={clearSelection}>
                      Clear selection
                    </s-button>
                    <s-button
                      variant="primary"
                      onClick={openAssignDialog}
                      disabled={templates.length === 0}
                    >
                      Assign template
                    </s-button>
                  </div>
                </div>
              </s-section>
            )}

            <s-section padding="none">
              <s-table>
                <ResourceTableHeader
                  title="Variants"
                  description="Filter, select, assign templates, and export detailed estimates."
                  action={
                    <>
                      {hasActiveFilters ? (
                        <s-button variant="secondary" onClick={clearFilters}>
                          Clear filters
                        </s-button>
                      ) : null}
                      <s-button
                        variant="secondary"
                        onClick={() => void exportEstimates()}
                        disabled={exportingEstimates}
                      >
                        {exportingEstimates
                          ? "Exporting..."
                          : "Export estimates CSV"}
                      </s-button>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(event) =>
                            toggleSelectAll(event.currentTarget.checked)
                          }
                        />
                        <span>Select all visible</span>
                      </label>
                    </>
                  }
                />

                <s-table-header-row>
                  <s-table-header>Select</s-table-header>
                  <s-table-header listSlot="secondary">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <span>Product</span>
                      <TableColumnFilter
                        title="Product"
                        active={Boolean(
                          filterProductId ||
                          filterCategory ||
                          filterProductTitle ||
                          filterTags.length > 0 ||
                          filterCollectionIds.length > 0,
                        )}
                        onApply={applyFilters}
                        onClear={() =>
                          clearFilterNames([
                            "product",
                            "category",
                            "productTitle",
                            "productTitleMatch",
                            "tag",
                            "collection",
                          ])
                        }
                      >
                        <label htmlFor="variants-product-filter">Product</label>
                        <select
                          id="variants-product-filter"
                          name="product"
                          defaultValue={filterProductId}
                          style={filterControlStyle}
                        >
                          <option value="">All products</option>
                          {products.map(
                            (product: { id: string; title: string }) => (
                              <option key={product.id} value={product.id}>
                                {product.title}
                              </option>
                            ),
                          )}
                        </select>
                        <label htmlFor="variants-category-filter">
                          Product category
                        </label>
                        <select
                          id="variants-category-filter"
                          name="category"
                          defaultValue={filterCategory}
                          style={filterControlStyle}
                        >
                          <option value="">All categories</option>
                          {categories.map(
                            (category: { value: string; label: string }) => (
                              <option
                                key={category.value}
                                value={category.value}
                              >
                                {category.label}
                              </option>
                            ),
                          )}
                        </select>
                        <TableTextFilterFields
                          id="variants-product-title-filter"
                          name="productTitle"
                          label="Product title or handle"
                          value={filterProductTitle}
                          matchId="variants-product-title-match-filter"
                          matchName="productTitleMatch"
                          matchValue={filterProductTitleMatch}
                          fieldStyle={filterControlStyle}
                        />
                        <AssignmentFilterPicker
                          id="variants-tag-filter"
                          name="tag"
                          label="Tags"
                          options={availableTags}
                          values={filterTags}
                          searchPlaceholder="Search tags"
                          emptyText="No matching tags."
                        />
                        <AssignmentFilterPicker
                          id="variants-collection-filter"
                          name="collection"
                          label="Collections"
                          options={availableCollections}
                          values={filterCollectionIds}
                          searchPlaceholder="Search collections"
                          emptyText="No matching collections."
                        />
                      </TableColumnFilter>
                    </div>
                  </s-table-header>
                  <s-table-header listSlot="primary">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <span>Variant</span>
                      <TableColumnFilter
                        title="Variant"
                        active={Boolean(filterVariantTitle)}
                        onApply={applyFilters}
                        onClear={() =>
                          clearFilterNames([
                            "variantTitle",
                            "variantTitleMatch",
                          ])
                        }
                      >
                        <TableTextFilterFields
                          id="variants-variant-title-filter"
                          name="variantTitle"
                          label="Variant title"
                          value={filterVariantTitle}
                          matchId="variants-variant-title-match-filter"
                          matchName="variantTitleMatch"
                          matchValue={filterVariantTitleMatch}
                          fieldStyle={filterControlStyle}
                        />
                      </TableColumnFilter>
                    </div>
                  </s-table-header>
                  <s-table-header listSlot="secondary">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <span>SKU</span>
                      <TableColumnFilter
                        title="SKU"
                        active={Boolean(
                          filterSku || filterSkuMatch === "empty",
                        )}
                        onApply={applyFilters}
                        onClear={() => clearFilterNames(["sku", "skuMatch"])}
                      >
                        <TableTextFilterFields
                          id="variants-sku-filter"
                          name="sku"
                          label="SKU"
                          value={filterSku}
                          matchId="variants-sku-match-filter"
                          matchName="skuMatch"
                          matchValue={filterSkuMatch}
                          allowEmpty
                          fieldStyle={filterControlStyle}
                        />
                      </TableColumnFilter>
                    </div>
                  </s-table-header>
                  <s-table-header listSlot="labeled" format="currency">
                    Price
                  </s-table-header>
                  <s-table-header listSlot="labeled" format="currency">
                    Est. costs
                  </s-table-header>
                  <s-table-header listSlot="labeled" format="currency">
                    Est. donation
                  </s-table-header>
                  <s-table-header listSlot="secondary">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <span>Template</span>
                      <TableColumnFilter
                        title="Template"
                        active={Boolean(
                          filterTemplate || filterTemplateMatch === "empty",
                        )}
                        onApply={applyFilters}
                        onClear={() =>
                          clearFilterNames(["template", "templateMatch"])
                        }
                      >
                        <TableTextFilterFields
                          id="variants-template-filter"
                          name="template"
                          label="Template"
                          value={filterTemplate}
                          matchId="variants-template-match-filter"
                          matchName="templateMatch"
                          matchValue={filterTemplateMatch}
                          allowEmpty
                          fieldStyle={filterControlStyle}
                        />
                      </TableColumnFilter>
                    </div>
                  </s-table-header>
                  <s-table-header listSlot="secondary">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <span>POD</span>
                      <TableColumnFilter
                        title="POD"
                        active={Boolean(
                          filterPodProvider ||
                          filterPodProviderMatch === "empty",
                        )}
                        onApply={applyFilters}
                        onClear={() =>
                          clearFilterNames(["podProvider", "podProviderMatch"])
                        }
                      >
                        <TableTextFilterFields
                          id="variants-pod-provider-filter"
                          name="podProvider"
                          label="POD provider"
                          value={filterPodProvider}
                          matchId="variants-pod-provider-match-filter"
                          matchName="podProviderMatch"
                          matchValue={filterPodProviderMatch}
                          allowEmpty
                          fieldStyle={filterControlStyle}
                        />
                      </TableColumnFilter>
                    </div>
                  </s-table-header>
                  <s-table-header listSlot="inline">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <span>Status</span>
                      <TableColumnFilter
                        title="Status"
                        active={Boolean(filterConfigured)}
                        onApply={applyFilters}
                        onClear={() => clearFilterNames(["configured"])}
                      >
                        <label htmlFor="variants-configured-filter">
                          Configuration status
                        </label>
                        <select
                          id="variants-configured-filter"
                          name="configured"
                          defaultValue={filterConfigured}
                          style={filterControlStyle}
                        >
                          <option value="">All</option>
                          <option value="yes">Configured</option>
                          <option value="no">Not configured</option>
                        </select>
                      </TableColumnFilter>
                    </div>
                  </s-table-header>
                  <s-table-header>Actions</s-table-header>
                </s-table-header-row>

                <s-table-body>
                  {variants.map((variant: VariantRow) => (
                    <s-table-row key={variant.id}>
                      <s-table-cell>
                        <input
                          type="checkbox"
                          checked={selectedVariantIds.includes(variant.id)}
                          onChange={(event) =>
                            updateSelection(
                              variant.id,
                              event.currentTarget.checked,
                            )
                          }
                          aria-label={`Select ${variant.title}`}
                        />
                      </s-table-cell>
                      <s-table-cell>{variant.productTitle}</s-table-cell>
                      <s-table-cell>{variant.title}</s-table-cell>
                      <s-table-cell>{variant.sku || "—"}</s-table-cell>
                      <s-table-cell>{formatMoney(variant.price)}</s-table-cell>
                      <s-table-cell>
                        {variant.estimate ? (
                          <strong>
                            {formatMoney(estimateTotalCost(variant.estimate))}
                          </strong>
                        ) : (
                          <s-text color="subdued">Unavailable</s-text>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        {variant.estimate ? (
                          <strong>
                            {formatMoney(
                              variant.estimate.reconciliation
                                .allocatedDonations,
                            )}
                          </strong>
                        ) : (
                          <s-text color="subdued">Unavailable</s-text>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        {variant.templateName ? (
                          <div style={{ display: "grid", gap: "0.2rem" }}>
                            <span>{variant.templateName}</span>
                            {variant.templateProductYield ? (
                              <s-text color="subdued">
                                Yield {variant.templateProductYield}
                              </s-text>
                            ) : null}
                          </div>
                        ) : (
                          "—"
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        {variant.mappedProviders.length > 0 ? (
                          <div style={{ display: "grid", gap: "0.2rem" }}>
                            <strong>
                              {variant.mappedProviders
                                .map(formatProviderLabel)
                                .join(", ")}
                            </strong>
                            <s-text color="subdued">
                              {variant.latestProviderSyncAt
                                ? `Last synced ${new Date(variant.latestProviderSyncAt).toLocaleString()}`
                                : "Mapped"}
                            </s-text>
                          </div>
                        ) : (
                          <s-text color="subdued">Manual / none</s-text>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        <div
                          style={{
                            display: "flex",
                            gap: "0.4rem",
                            flexWrap: "wrap",
                          }}
                        >
                          <s-badge
                            tone={variant.hasConfig ? "success" : "enabled"}
                          >
                            {variant.hasConfig
                              ? "Configured"
                              : "Not configured"}
                          </s-badge>
                          {variant.mappedProviders.length > 0 ? (
                            <s-badge tone="info">POD mapped</s-badge>
                          ) : null}
                        </div>
                      </s-table-cell>
                      <s-table-cell>
                        <Link to={`/app/variants/${variant.id}`}>
                          <s-button variant="secondary">Configure</s-button>
                        </Link>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-section>
          </>
        )}
      </s-page>

      <dialog
        ref={assignDialogRef}
        onClose={closeAssignDialog}
        style={{
          border: "none",
          borderRadius: "1rem",
          padding: 0,
          maxWidth: "36rem",
          width: "calc(100% - 2rem)",
        }}
      >
        <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              alignItems: "start",
            }}
          >
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>Assign template</strong>
              <s-text color="subdued">
                Assign a template to {selectedVariantIds.length} selected
                variant{selectedVariantIds.length !== 1 ? "s" : ""}.
              </s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={closeAssignDialog}
              style={{
                border: "none",
                background: "transparent",
                fontSize: "1.5rem",
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>

          {templates.length === 0 ? (
            <s-text>
              No active templates are available. Create a template first.
            </s-text>
          ) : (
            <div style={{ display: "grid", gap: "0.35rem" }}>
              <strong>Template</strong>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    color: selectedTemplate
                      ? "inherit"
                      : "var(--p-color-text-subdued, #6d7175)",
                  }}
                >
                  {selectedTemplate?.name ?? "No template selected"}
                </span>
                <AssignmentPicker
                  id="variants-bulk-template-picker"
                  label="Choose template"
                  triggerLabel={
                    selectedTemplate ? "Change template" : "Choose template"
                  }
                  options={templates.map(
                    (template: { id: string; name: string }) => ({
                      id: template.id,
                      label: template.name,
                    }),
                  )}
                  selectedIds={
                    selectedTemplateId
                      ? new Set([selectedTemplateId])
                      : new Set()
                  }
                  onAdd={(ids) => setSelectedTemplateId(ids[0] ?? "")}
                  multi={false}
                  hideSelected={false}
                  searchPlaceholder="Search templates"
                  emptyText="No templates match that search."
                />
              </div>
              <label
                style={{ display: "flex", gap: "0.5rem", alignItems: "start" }}
              >
                <input
                  type="checkbox"
                  checked={cleanupExactDuplicates}
                  onChange={(event) =>
                    setCleanupExactDuplicates(event.currentTarget.checked)
                  }
                />
                <span>
                  Remove exact duplicate variant lines already included in this
                  template.
                </span>
              </label>
              <div
                style={{ display: "grid", gap: "0.35rem", maxWidth: "14rem" }}
              >
                <label htmlFor="bulk-template-product-yield">
                  Products made
                </label>
                <input
                  id="bulk-template-product-yield"
                  type="number"
                  min={1}
                  step={1}
                  value={templateProductYield}
                  onChange={(event) =>
                    setTemplateProductYield(event.currentTarget.value)
                  }
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "0.75rem",
                    borderRadius: "0.75rem",
                    border: "1px solid var(--p-color-border, #d2d5d8)",
                    background: "var(--p-color-bg-surface, #fff)",
                    color: "var(--p-color-text, #303030)",
                    font: "inherit",
                  }}
                />
                <s-text color="subdued">
                  Optional. Use when the selected template makes a different
                  number of sellable items for these variants.
                </s-text>
              </div>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            <s-button variant="secondary" onClick={closeAssignDialog}>
              Cancel
            </s-button>
            <s-button
              variant="primary"
              disabled={
                isSubmitting ||
                templates.length === 0 ||
                selectedVariantIds.length === 0 ||
                !selectedTemplateId
              }
              onClick={handleBulkAssign}
            >
              Assign
            </s-button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={confirmDialogRef}
        onClose={closeConfirmDialog}
        style={{
          border: "none",
          borderRadius: "1rem",
          padding: 0,
          maxWidth: "36rem",
          width: "calc(100% - 2rem)",
        }}
      >
        <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              alignItems: "start",
            }}
          >
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>Overwrite existing configurations?</strong>
              <s-text color="subdued">
                Some selected variants already have a configuration.
              </s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={closeConfirmDialog}
              style={{
                border: "none",
                background: "transparent",
                fontSize: "1.5rem",
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>

          <s-text>
            {overwriteCount} of the selected variant(s) already have a cost
            configuration. Assigning this template will replace their current
            template assignment. Per-variant line overrides and labor settings
            will be preserved.
          </s-text>
          {cleanupExactDuplicates ? (
            <s-text>
              Exact duplicate variant material/equipment lines included in the
              template will be removed. Lines with different quantities, yields,
              uses, or equipment settings will be kept and shown for review
              after assignment.
            </s-text>
          ) : null}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            <s-button variant="secondary" onClick={closeConfirmDialog}>
              Cancel
            </s-button>
            <s-button
              variant="primary"
              tone="critical"
              disabled={isSubmitting}
              onClick={() => submitAssign(pendingAssign)}
            >
              Yes, overwrite
            </s-button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Variants] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Variants" />
      <s-page>
        <s-banner tone="critical">
          <s-text>
            Something went wrong loading variants. Please refresh the page.
          </s-text>
        </s-banner>
      </s-page>
    </>
  );
}
