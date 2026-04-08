import { PgBoss } from "pg-boss";

function createQueue() {
  return new PgBoss({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.JOBS_POOL_SIZE ?? "3", 10),
    // Retention: completed jobs older than 7 days are cleaned up
    warningRetentionDays: 7,
  });
}

declare global {
  // eslint-disable-next-line no-var
  var __jobQueue: PgBoss | undefined;
  // eslint-disable-next-line no-var
  var __jobQueueStarted: boolean | undefined;
}

export const jobQueue: PgBoss = global.__jobQueue ?? createQueue();

if (!global.__jobQueue) {
  global.__jobQueue = jobQueue;
}

// Per-job defaults for webhook/background jobs
export const DEFAULT_JOB_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true, // exponential: 30s, 60s, 120s
  expireInHours: 24,
} as const;

export async function startJobQueue(): Promise<void> {
  if (global.__jobQueueStarted) return;
  global.__jobQueueStarted = true;

  await jobQueue.start();

  // Register all job processors
  const { registerAllProcessors } = await import("./processors.server");
  await registerAllProcessors(jobQueue);

  // Recurring jobs
  await jobQueue.schedule("plan.detect.daily", "0 6 * * *", {});
  await jobQueue.schedule("reconciliation.daily", "0 3 * * *", {});
  await jobQueue.schedule("shopify-charges.daily", "0 4 * * *", {});
  await jobQueue.schedule("reporting.tax-offset.daily", "15 * * * *", {});

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    await jobQueue.stop();
    process.exit(0);
  });
}
