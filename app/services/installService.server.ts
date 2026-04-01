import { prisma } from "~/db.server";
import { jobQueue } from "~/jobs/queue.server";
import { detectAndStorePlan } from "~/services/planDetectionService.server";

type AdminContext = {
  graphql: (query: string) => Promise<Response>;
};

/**
 * Handles post-install logic after OAuth completes.
 *
 * Three cases:
 * 1. Reinstall within 48hr deletion window — cancel the pending DeletionJob,
 *    retain existing data, skip fresh install.
 * 2. Re-auth without prior uninstall (token refresh) — Shop already exists,
 *    nothing to do.
 * 3. Fresh install — create Shop, WizardState, AuditLog, detect plan.
 *
 * Returns true on fresh install, false otherwise.
 */
export async function handlePostInstall(
  shopId: string,
  admin: AdminContext,
): Promise<boolean> {
  // Case 1: pending deletion job means merchant reinstalled within window
  const pendingDeletion = await prisma.deletionJob.findUnique({
    where: { shopId },
  });

  if (pendingDeletion && pendingDeletion.status === "pending") {
    await prisma.deletionJob.update({
      where: { shopId },
      data: { status: "cancelled" },
    });

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "DeletionJob",
        entityId: pendingDeletion.id,
        action: "CANCELLED",
        actor: "system",
        payload: { reason: "Reinstall within 48hr deletion window" },
      },
    });

    return false;
  }

  // Case 2: re-auth — shop record already exists
  const existing = await prisma.shop.findUnique({
    where: { shopId },
    select: { id: true, catalogSynced: true },
  });
  if (existing) {
    console.log(`Catalog Status`, existing)
    // Backfill: if catalog hasn't been synced yet (e.g. Phase 2 deployed to an
    // existing merchant), enqueue the sync now rather than waiting for reinstall.
    if (!existing.catalogSynced) {
      await jobQueue.send("catalog.sync", { shopId });
    }
    return false;
  }

  // Case 3: fresh install
  const shop = await prisma.shop.create({
    data: {
      shopId,
      shopifyDomain: shopId,
    },
  });

  await prisma.wizardState.create({
    data: {
      shopId,
      currentStep: 0,
      completedSteps: [],
      skippedSteps: [],
    },
  });

  await prisma.auditLog.create({
    data: {
      shopId,
      entity: "Shop",
      entityId: shop.id,
      action: "CREATE",
      actor: "system",
      payload: { shopId },
    },
  });

  await detectAndStorePlan(shopId, admin);

  // Enqueue catalog sync as a background job — can take many seconds for large catalogs
  await jobQueue.send("catalog.sync", { shopId });
  console.log(`Running catalog.sync for ${shopId} -- installService.server.ts:96`)

  return true;
}
