import type { PgBoss } from "pg-boss";
import { prisma } from "../db.server";
import { fullSync, incrementalSync } from "../services/catalogSync.server";
import { processOrderUpdate, processRefund } from "../services/adjustmentService.server";
import { runReconciliation } from "../services/reconciliationService.server";
import { createReportingPeriodFromPayout } from "../services/reportingPeriodService.server";
import { createSnapshot } from "../services/snapshotService.server";
import { unauthenticated } from "../shopify.server";

const QUEUES = [
  "plan.detect.daily",
  "plan.detect",
  "orders.snapshot",
  "orders.updated",
  "orders.refund",
  "reconciliation.daily",
  "reconciliation.shop",
  "reporting.period.open",
  "shop.delete",
  "webhook.compliance",
  "catalog.sync",
  "catalog.sync.incremental",
];

export async function registerAllProcessors(boss: PgBoss): Promise<void> {
  for (const name of QUEUES) {
    await boss.createQueue(name);
  }

  await boss.work("plan.detect.daily", async () => {
    const shops = await prisma.shop.findMany({
      where: { planOverride: false },
      select: { shopId: true },
    });

    for (const shop of shops) {
      await boss.send("plan.detect", { shopId: shop.shopId });
    }
  });

  await boss.work<{ shopId: string }>("plan.detect", async (jobs) => {
    const job = jobs[0];
    if (!job) return;
    console.log(`[plan.detect] Phase 1 placeholder for shop: ${job.data.shopId}`);
  });

  await boss.work<{ shopId: string; shopifyOrderId: string; payload?: unknown }>(
    "orders.snapshot",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId, payload } = job.data;
      await createSnapshot(shopId, payload as any, prisma);
    },
  );

  await boss.work<{ shopId: string; shopifyOrderId: string; payload?: unknown }>(
    "orders.updated",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId, payload } = job.data;
      await processOrderUpdate(shopId, payload as any, prisma);
    },
  );

  await boss.work<{ shopId: string; payload?: unknown }>(
    "orders.refund",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId, payload } = job.data;
      await processRefund(shopId, payload as any, prisma);
    },
  );

  await boss.work("reconciliation.daily", async () => {
    const shops = await prisma.shop.findMany({
      select: { shopId: true },
    });

    for (const shop of shops) {
      await boss.send(
        "reconciliation.shop",
        { shopId: shop.shopId },
        {
          singletonKey: shop.shopId,
          singletonSeconds: 6 * 60 * 60,
        },
      );
    }
  });

  await boss.work<{ shopId: string }>("reconciliation.shop", async (jobs) => {
    const job = jobs[0];
    if (!job) return;

    const { shopId } = job.data;
    try {
      const { admin } = await unauthenticated.admin(shopId);
      await runReconciliation(shopId, admin, prisma);
    } catch (error) {
      await prisma.auditLog.create({
        data: {
          shopId,
          entity: "OrderSnapshot",
          action: "RECONCILIATION_RUN_FAILED",
          actor: "system",
          payload: {
            message: error instanceof Error ? error.message : "Unknown reconciliation failure",
          },
        },
      });
      throw error;
    }
  });

  await boss.work<{ shopId: string; payload?: unknown }>(
    "reporting.period.open",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId, payload } = job.data;
      await createReportingPeriodFromPayout(shopId, payload as any, prisma);
    },
  );

  await boss.work<{ shopId: string; deletionJobId: string }>(
    "shop.delete",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId } = job.data;

      const deletionJob = await prisma.deletionJob.findUnique({
        where: { shopId },
      });

      if (!deletionJob || deletionJob.status === "cancelled") {
        console.log(`[shop.delete] Skipped - DeletionJob cancelled for shop ${shopId}`);
        return;
      }

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

  await boss.work<{ shopId: string }>("catalog.sync", async (jobs) => {
    const job = jobs[0];
    if (!job) return;
    const { shopId } = job.data;

    const { admin } = await unauthenticated.admin(shopId);
    await fullSync(shopId, admin);
  });

  await boss.work<{ shopId: string; productGid: string }>(
    "catalog.sync.incremental",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId, productGid } = job.data;

      const { admin } = await unauthenticated.admin(shopId);
      await incrementalSync(shopId, admin, productGid);
    },
  );

  await boss.work<{ shopId: string; topic: string }>(
    "webhook.compliance",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId, topic } = job.data;

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
