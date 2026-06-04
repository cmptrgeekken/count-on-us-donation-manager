import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  buildPublicTransparencyPage,
  type PublicDisclosureTier,
  type PublicTransparencyRollup,
} from "../services/publicTransparency.server";
import { authenticatePublicAppProxyRequest } from "../utils/public-auth.server";
import { checkRateLimit } from "../utils/rate-limit.server";

const disclosureTiers = new Set<PublicDisclosureTier>(["minimal", "standard", "detailed"]);
const rollups = new Set<PublicTransparencyRollup>(["all", "month", "year", "period"]);

function getClientIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "anonymous";
}

function parseDisclosureTier(value: string | null): PublicDisclosureTier {
  return value && disclosureTiers.has(value as PublicDisclosureTier) ? (value as PublicDisclosureTier) : "minimal";
}

function parseRollup(value: string | null): PublicTransparencyRollup {
  return value && rollups.has(value as PublicTransparencyRollup) ? (value as PublicTransparencyRollup) : "all";
}

function parseBooleanSetting(value: string | null, fallback: boolean) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shopifyDomain } = await authenticatePublicAppProxyRequest(request);
  const rateLimit = checkRateLimit({
    key: `public-transparency:${shopifyDomain}:${getClientIpAddress(request)}`,
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    throw new Response("Too many transparency requests. Please try again shortly.", {
      status: 429,
      headers: rateLimit.headers,
    });
  }

  const url = new URL(request.url);
  const page = await buildPublicTransparencyPage(shopifyDomain, {
    presentation: {
      requestedDisclosureTier: parseDisclosureTier(url.searchParams.get("tier")),
      showOverviewTotals: parseBooleanSetting(url.searchParams.get("showOverviewTotals"), true),
      showReceiptHistory: parseBooleanSetting(url.searchParams.get("showReceiptHistory"), true),
      showCauseSummaries: parseBooleanSetting(url.searchParams.get("showCauseSummaries"), true),
      showReconciliation: parseBooleanSetting(url.searchParams.get("showReconciliation"), true),
      rollup: parseRollup(url.searchParams.get("rollup")),
      month: url.searchParams.get("month") ?? undefined,
      year: url.searchParams.get("year") ?? undefined,
      periodId: url.searchParams.get("periodId") ?? undefined,
    },
  });

  return Response.json(page, {
    headers: rateLimit.headers,
  });
};
