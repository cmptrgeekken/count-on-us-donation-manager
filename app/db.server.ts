import { PrismaClient, type Prisma } from "@prisma/client";

// Tenant-scoped models: every read/update/delete query MUST include a shopId filter.
// This extension enforces that invariant at the ORM layer.
const TENANT_SCOPED_MODELS = [
  "Shop", "WizardState", "AuditLog", "DeletionJob",
  "MaterialLibraryItem", "EquipmentLibraryItem", "CostTemplate",
  // CostTemplateMaterialLine and CostTemplateEquipmentLine have no shopId field —
  // they are protected through their parent CostTemplate (cascade delete).
  "Product", "Variant", "VariantCostConfig",
  "VariantMaterialLine", "VariantEquipmentLine",
  "Cause", "ProductCauseAssignment",
  "OrderSnapshot", "OrderSnapshotLine",
  "LineCauseAllocation", "Adjustment",
  "ReportingPeriod", "CauseAllocation", "Disbursement",
  "TaxTrueUp", "ShopifyChargeTransaction",
  "BusinessExpense", "TaxOffsetCache",
];

// Operations that query via a `where` clause (excludes creates which use `data`)
const SCOPED_OPERATIONS = [
  "findUnique",
  "findFirst",
  "findMany",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
  "count",
  "aggregate",
];

function createPrismaClient() {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  }).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (
            model &&
            TENANT_SCOPED_MODELS.includes(model) &&
            SCOPED_OPERATIONS.includes(operation)
          ) {
            const where = (args as { where?: Record<string, unknown> }).where;
            // Accept direct shopId field OR a Prisma compound unique key (e.g.
            // shopId_shopifyId) whose value object itself contains shopId.
            const hasShopId =
              where?.shopId !== undefined ||
              Object.entries(where ?? {}).some(
                ([k, v]) =>
                  k.includes("shopId") &&
                  v !== null &&
                  typeof v === "object" &&
                  "shopId" in (v as object),
              );

            if (!hasShopId) {
              const message =
                `Security violation: unscoped query on tenant model '${model}' ` +
                `(operation: ${operation}). Add a shopId filter.`;

              if (process.env.NODE_ENV === "production") {
                // Never throw in production — log and allow through rather than
                // causing an availability incident. Investigate immediately.
                console.error("CRITICAL SECURITY:", message);
              } else {
                console.log('Args', args);
                throw new Error(message);
              }
            }
          }

          return query(args);
        },
      },
    },
  });
}

type PrismaClientWithExtension = ReturnType<typeof createPrismaClient>;

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClientWithExtension | undefined;
}

// Singleton — prevents multiple connection pools during hot reload in dev
export const prisma: PrismaClientWithExtension =
  global.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

export type DbClient = PrismaClientWithExtension | Prisma.TransactionClient;
export type TransactionCapableDbClient = PrismaClientWithExtension;

export default prisma;
