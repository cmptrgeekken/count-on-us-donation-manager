import type { PgBoss } from "pg-boss";
import { prisma } from "../db.server";
import { fullSync, incrementalSync } from "../services/catalogSync.server";
import shopify from "../shopify.server";

const QUEUES = [
  "plan.detect.daily",
  "plan.detect",
  "webhook.orders.create",
  "shop.delete",
  "webhook.compliance",
  "catalog.sync",
  "catalog.sync.incremental",
];

export async function registerAllProcessors(boss: PgBoss): Promise<void> {
  // pg-boss v12 requires queues to be explicitly created before workers can be registered
  for (const name of QUEUES) {
    await boss.createQueue(name);
  }

  // Daily plan re-detection: fan out one job per non-overridden shop
  await boss.work("plan.detect.daily", async (_jobs) => {
    const shops = await prisma.shop.findMany({
      where: { planOverride: false },
      select: { shopId: true },
    });

    for (const shop of shops) {
      await boss.send("plan.detect", { shopId: shop.shopId });
    }
  });

  // Per-shop plan detection
  // Phase 1: logs a placeholder. Full implementation requires retrieving the
  // offline access token from session storage to instantiate an Admin API client.
  await boss.work<{ shopId: string }>("plan.detect", async (jobs) => {
    const job = jobs[0];
    if (!job) return;
    console.log(`[plan.detect] Phase 1 placeholder for shop: ${job.data.shopId}`);
  });

  // orders/create stub — log receipt, no other processing in Phase 1
  await boss.work<{ shopId: string; orderId: string; topic: string }>(
    "webhook.orders.create",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId, orderId } = job.data;
      await prisma.auditLog.create({
        data: {
          shopId,
          entity: "Order",
          entityId: orderId,
          action: "RECEIVED",
          actor: "webhook",
          payload: { topic: "orders/create", note: "Phase 1 stub — no processing" },
        },
      });
    },
  );

  // shop.delete: runs 48hrs after uninstall — delete all shop data atomically
  await boss.work<{ shopId: string; deletionJobId: string }>(
    "shop.delete",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId } = job.data;

      const deletionJob = await prisma.deletionJob.findUnique({
        where: { shopId },
      });

      // Cancelled if merchant reinstalled within the window
      if (!deletionJob || deletionJob.status === "cancelled") {
        console.log(`[shop.delete] Skipped — DeletionJob cancelled for shop ${shopId}`);
        return;
      }

      // Delete in FK-safe order: children before parent
      await prisma.$transaction([
        prisma.auditLog.deleteMany({ where: { shopId } }),
        prisma.wizardState.deleteMany({ where: { shopId } }),
        prisma.deletionJob.deleteMany({ where: { shopId } }),
        prisma.shop.deleteMany({ where: { shopId } }),
        prisma.session.deleteMany({ where: { shop: shopId } }),
      ]);

      console.log(`[shop.delete] Completed data deletion for shop ${shopId}`);
    },
  );

  // Full catalog sync — runs after install
  await boss.work<{ shopId: string }>("catalog.sync", async (jobs) => {
    const job = jobs[0];
    if (!job) return;
    const { shopId } = job.data;

    const { admin } = await shopify.unauthenticated.admin(shopId);
    await fullSync(shopId, admin);
  });

  // Incremental sync — runs on products/update webhook
  await boss.work<{ shopId: string; productGid: string }>(
    "catalog.sync.incremental",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId, productGid } = job.data;

      const { admin } = await shopify.unauthenticated.admin(shopId);
      await incrementalSync(shopId, admin, productGid);
    },
  );

  // GDPR: log receipt for all compliance webhooks
  await boss.work<{ shopId: string; topic: string }>(
    "webhook.compliance",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId, topic } = job.data;

      // shop/redact triggers the same deletion flow as app/uninstalled
      if (topic === "shop/redact") {
        const existing = await prisma.deletionJob.findUnique({
          where: { shopId },
        });

        if (!existing) {
          const scheduledFor = new Date(Date.now() + 48 * 60 * 60 * 1000);
          const deletionJob = await prisma.deletionJob.create({
            data: {
              shopId,
              scheduledFor,
              status: "pending",
            },
          });

          await boss.sendAfter(
            "shop.delete",
            { shopId, deletionJobId: deletionJob.id },
            null,
            scheduledFor,
          );
        }
      }

      console.log(`[webhook.compliance] Received ${topic} for shop ${shopId}`);
    },
  );
}
