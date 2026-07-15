import type { PgBoss } from "pg-boss";
import { prisma } from "../db.server";
import { runAnalyticalRecalculation } from "../services/analyticalRecalculation.server";
import { syncShopifyCharges } from "../services/chargeSyncService.server";
import { fullSync, incrementalSync, syncCollection } from "../services/catalogSync.server";
import { processOrderUpdate, processRefund } from "../services/adjustmentService.server";
import { runFinancialBackfill } from "../services/financialBackfill.server";
import { runReconciliation } from "../services/reconciliationService.server";
import { createReportingPeriodFromPayout } from "../services/reportingPeriodService.server";
import { refreshTaxOffsetCacheForShop } from "../services/reportingService.server";
import { sendArtistSubmissionNotificationEmail } from "../services/artistSubmissionNotification.server";
import { sendPostPurchaseDonationEmail } from "../services/postPurchaseEmail.server";
import { runCustomerMerchandisingSync } from "../services/customerMerchandisingSync.server";
import { runProviderSync } from "../services/providerSync.server";
import { createSnapshot, replaceSnapshotForFulfillmentChange } from "../services/snapshotService.server";
import { unauthenticated } from "../shopify.server";

const QUEUES = [
  "plan.detect.daily",
  "plan.detect",
  "orders.snapshot",
  "orders.post-purchase-email",
  "artist-submission.notification",
  "orders.updated",
  "orders.refund",
  "reconciliation.daily",
  "reconciliation.shop",
  "shopify-charges.daily",
  "shopify-charges.shop",
  "reporting.period.open",
  "reporting.tax-offset.daily",
  "reporting.tax-offset.shop",
  "reporting.recalculate",
  "financial.backfill",
  "shop.delete",
  "webhook.compliance",
  "catalog.sync",
  "catalog.sync.incremental",
  "catalog.sync.collection",
  "customer-merchandising.sync",
  "provider.sync",
];

export async function registerAllProcessors(boss: PgBoss): Promise<void> {
  for (const name of QUEUES) {
    await boss.createQueue(name);
  }

  await boss.work("plan.detect.daily", async () => {
    const shops = await prisma.shop.findMany({
      where: { shopId: { not: "" }, planOverride: false },
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
      const result = await createSnapshot(shopId, payload as any, prisma);

      if (result.created && result.snapshotId) {
        await boss.send("orders.post-purchase-email", {
          shopId,
          snapshotId: result.snapshotId,
          contactEmail:
            (payload as { contact_email?: string | null })?.contact_email ??
            null,
        });
      }
    },
  );

  await boss.work<{ shopId: string; snapshotId: string; contactEmail?: string | null }>(
    "orders.post-purchase-email",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;

      const { shopId, snapshotId, contactEmail } = job.data;
      try {
        await sendPostPurchaseDonationEmail(
          {
            snapshotId,
            contactEmail,
          },
          prisma,
        );
      } catch (error) {
        await prisma.auditLog.create({
          data: {
            shopId,
            entity: "OrderSnapshot",
            entityId: snapshotId,
            action: "POST_PURCHASE_EMAIL_FAILED",
            actor: "system",
            payload: {
              message: error instanceof Error ? error.message : "Unknown post-purchase email failure",
            },
          },
        });
        throw error;
      }
    },
  );

  await boss.work<{ shopId: string; submissionId: string }>(
    "artist-submission.notification",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;

      const { shopId, submissionId } = job.data;
      try {
        await sendArtistSubmissionNotificationEmail(
          {
            shopId,
            submissionId,
          },
          prisma,
        );
      } catch (error) {
        await prisma.auditLog.create({
          data: {
            shopId,
            entity: "ArtistSubmission",
            entityId: submissionId,
            action: "ARTIST_SUBMISSION_NOTIFICATION_FAILED",
            actor: "system",
            payload: {
              message: error instanceof Error ? error.message : "Unknown artist submission notification failure",
            },
          },
        });
        throw error;
      }
    },
  );

  await boss.work<{ shopId: string; shopifyOrderId: string; payload?: unknown }>(
    "orders.updated",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId, payload } = job.data;
      const replacement = await replaceSnapshotForFulfillmentChange(shopId, payload as any, prisma);
      if (replacement.replaced) return;
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
      where: { shopId: { not: "" } },
      select: { shopId: true },
    });
    const oldestUnknownSnapshots = shops.length > 0
      ? await prisma.orderSnapshot.findMany({
          where: {
            shopId: { in: shops.map((shop) => shop.shopId) },
            currentForOrderRecord: {
              lifecycle: { is: { state: { in: ["unknown", "review_required"] } } },
            },
          },
          distinct: ["shopId"],
          orderBy: [{ shopId: "asc" }, { createdAt: "asc" }],
          select: { shopId: true, createdAt: true },
        })
      : [];
    const reconciliationSinceByShop = new Map(
      oldestUnknownSnapshots.map((snapshot) => [snapshot.shopId, snapshot.createdAt.toISOString()]),
    );

    for (const shop of shops) {
      await boss.send(
        "reconciliation.shop",
        {
          shopId: shop.shopId,
          ...(reconciliationSinceByShop.get(shop.shopId)
            ? { since: reconciliationSinceByShop.get(shop.shopId) }
            : {}),
        },
        {
          singletonKey: shop.shopId,
          singletonSeconds: 6 * 60 * 60,
        },
      );
    }
  });

  await boss.work<{ shopId: string; since?: string; until?: string; searchQuery?: string }>("reconciliation.shop", async (jobs) => {
    const job = jobs[0];
    if (!job) return;

    const { shopId } = job.data;
    try {
      const { admin } = await unauthenticated.admin(shopId);
      await runReconciliation(shopId, admin, prisma, {
        since: job.data.since ? new Date(job.data.since) : undefined,
        until: job.data.until ? new Date(job.data.until) : undefined,
        searchQuery: job.data.searchQuery,
      });
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

  await boss.work("shopify-charges.daily", async () => {
    const shops = await prisma.shop.findMany({
      where: { shopId: { not: "" } },
      select: { shopId: true },
    });

    for (const shop of shops) {
      await boss.send(
        "shopify-charges.shop",
        { shopId: shop.shopId },
        {
          singletonKey: shop.shopId,
          singletonSeconds: 6 * 60 * 60,
        },
      );
    }
  });

  await boss.work<{ shopId: string; payoutId?: string; payoutDate?: string; since?: string; until?: string }>(
    "shopify-charges.shop",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;

      const { shopId, payoutId, payoutDate, since, until } = job.data;
      try {
        const { admin } = await unauthenticated.admin(shopId);
        await syncShopifyCharges({
          shopId,
          admin,
          payoutId,
          payoutDate,
          since: since ? new Date(since) : undefined,
          until: until ? new Date(until) : undefined,
          db: prisma,
        });
      } catch (error) {
        await prisma.auditLog.create({
          data: {
            shopId,
            entity: "ShopifyChargeTransaction",
            action: "SHOPIFY_CHARGES_SYNC_FAILED",
            actor: "system",
            payload: {
              message: error instanceof Error ? error.message : "Unknown Shopify charges sync failure",
            },
          },
        });
        throw error;
      }
    },
  );

  await boss.work<{ shopId: string; payload?: unknown }>(
    "reporting.period.open",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId, payload } = job.data;
      await createReportingPeriodFromPayout(shopId, payload as any, prisma);
    },
  );

  await boss.work("reporting.tax-offset.daily", async () => {
    const shops = await prisma.shop.findMany({
      where: { shopId: { not: "" } },
      select: { shopId: true },
    });

    for (const shop of shops) {
      await boss.send(
        "reporting.tax-offset.shop",
        { shopId: shop.shopId },
        {
          singletonKey: shop.shopId,
          singletonSeconds: 60 * 60,
        },
      );
    }
  });

  await boss.work<{ shopId: string }>("reporting.tax-offset.shop", async (jobs) => {
    const job = jobs[0];
    if (!job) return;

    const { shopId } = job.data;
    try {
      await refreshTaxOffsetCacheForShop(shopId, prisma);
    } catch (error) {
      await prisma.auditLog.create({
        data: {
          shopId,
          entity: "TaxOffsetCache",
          action: "TAX_OFFSET_CACHE_REFRESH_FAILED",
          actor: "system",
          payload: {
            message: error instanceof Error ? error.message : "Unknown tax offset cache refresh failure",
          },
        },
      });
      throw error;
    }
  });

  await boss.work<{ shopId: string; runId: string }>("reporting.recalculate", async (jobs) => {
    const job = jobs[0];
    if (!job) return;

    const { shopId, runId } = job.data;
    await runAnalyticalRecalculation(shopId, runId, prisma);
  });

  await boss.work<{
    shopId: string;
    since?: string;
    until?: string;
    closePeriods?: boolean;
    createMonthlyPeriods?: boolean;
  }>("financial.backfill", async (jobs) => {
    const job = jobs[0];
    if (!job) return;

    const { shopId, since, until, closePeriods, createMonthlyPeriods } = job.data;
    try {
      const { admin } = await unauthenticated.admin(shopId);
      await runFinancialBackfill({
        shopId,
        admin,
        since,
        until,
        closePeriods,
        createMonthlyPeriods,
        db: prisma,
      });
    } catch (error) {
      await prisma.auditLog.create({
        data: {
          shopId,
          entity: "ReportingPeriod",
          action: "FINANCIAL_BACKFILL_FAILED",
          actor: "system",
          payload: {
            since,
            until,
            message: error instanceof Error ? error.message : "Unknown financial backfill failure",
          },
        },
      });
      throw error;
    }
  });

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

  await boss.work<{ shopId: string; collectionGid: string }>(
    "catalog.sync.collection",
    async (jobs) => {
      const job = jobs[0];
      if (!job) return;
      const { shopId, collectionGid } = job.data;

      const { admin } = await unauthenticated.admin(shopId);
      await syncCollection(shopId, admin, collectionGid);
    },
  );

  await boss.work<{ shopId: string; runId: string }>("provider.sync", async (jobs) => {
    const job = jobs[0];
    if (!job) return;

    const { shopId, runId } = job.data;
    await runProviderSync({ shopId, runId }, prisma);
  });

  await boss.work<{ shopId: string; runId: string }>("customer-merchandising.sync", async (jobs) => {
    const job = jobs[0];
    if (!job) return;

    const { shopId, runId } = job.data;
    try {
      const { admin } = await unauthenticated.admin(shopId);
      await runCustomerMerchandisingSync({ admin, shopId, runId });
    } catch (error) {
      await prisma.customerMerchandisingSyncRun.updateMany({
        where: { id: runId, shopId, status: { in: ["queued", "running"] } },
        data: {
          status: "failed",
          completedAt: new Date(),
          errorSummary: error instanceof Error ? error.message : "Unknown Shopify sync failure",
        },
      });
      throw error;
    }
  });

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
