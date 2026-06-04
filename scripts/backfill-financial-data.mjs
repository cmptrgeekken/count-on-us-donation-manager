import { PgBoss } from "pg-boss";

function usage() {
  return [
    "Usage:",
    "  npm run backfill:financial -- --shop=<shop.myshopify.com> [--since=YYYY-MM-DD] [--until=YYYY-MM-DD]",
    "",
    "Options:",
    "  --shop=<domain>                Required Shopify shop domain.",
    "  --since=YYYY-MM-DD             Inclusive order/transaction start date. Defaults to 60 days ago.",
    "  --until=YYYY-MM-DD             Exclusive order/transaction end date. Defaults to tomorrow.",
    "  --no-close-periods             Import snapshots/charges without closing reporting periods.",
    "  --create-monthly-periods       Create synthetic monthly reporting periods before closing.",
    "  --dry-run                      Print the queued payload without sending it.",
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const result = {
    shopId: "",
    since: null,
    until: null,
    closePeriods: true,
    createMonthlyPeriods: false,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg.startsWith("--shop=")) result.shopId = arg.slice("--shop=".length).trim();
    else if (arg.startsWith("--since=")) result.since = parseDateArg("since", arg.slice("--since=".length));
    else if (arg.startsWith("--until=")) result.until = parseDateArg("until", arg.slice("--until=".length));
    else if (arg === "--no-close-periods") result.closePeriods = false;
    else if (arg === "--create-monthly-periods") result.createMonthlyPeriods = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  if (!result.shopId) {
    throw new Error(`--shop is required.\n\n${usage()}`);
  }

  const since = result.since ?? defaultSinceDate();
  const until = result.until ?? defaultUntilDate();
  if (until <= since) {
    throw new Error("--until must be after --since.");
  }

  return {
    ...result,
    since,
    until,
  };
}

function parseDateArg(name, value) {
  const parsed = new Date(`${value.trim()}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --${name} date: ${value}`);
  }
  return parsed;
}

function defaultSinceDate() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - 60);
  return date;
}

function defaultUntilDate() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function toPayload(options) {
  return {
    shopId: options.shopId,
    since: options.since.toISOString(),
    until: options.until.toISOString(),
    closePeriods: options.closePeriods,
    createMonthlyPeriods: options.createMonthlyPeriods,
  };
}

async function enqueueBackfill(payload) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to enqueue financial backfill jobs.");
  }

  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });

  await boss.start();
  try {
    await boss.createQueue("financial.backfill");
    return await boss.send("financial.backfill", payload, {
      singletonKey: `${payload.shopId}:${payload.since}:${payload.until}`,
      singletonSeconds: 60 * 60,
      retryLimit: 1,
      expireInHours: 24,
    });
  } finally {
    await boss.stop();
  }
}

async function main() {
  const options = parseArgs();
  const payload = toPayload(options);

  if (options.dryRun) {
    console.log("Financial backfill dry run. No job was queued.");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const jobId = await enqueueBackfill(payload);
  console.log(`Queued financial backfill job ${jobId} for ${payload.shopId}.`);
  console.log(`Window: ${payload.since} to ${payload.until} (until is exclusive).`);
  console.log("The running app worker will reconcile orders, sync Shopify charges, and close/report periods with production services.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
