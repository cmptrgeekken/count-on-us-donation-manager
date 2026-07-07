const SHOPIFY_TOP_LEVEL_CONTEXT_PARAMS = ["shop", "host", "locale"] as const;
const DEFAULT_APP_BASE_PATH = "/app";

function isSkippableHref(href: string): boolean {
  const trimmed = href.trim();
  return (
    trimmed === "" ||
    trimmed.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)
  );
}

export function withEmbeddedAppContext(href: string, currentSearch: string, origin: string): string {
  if (isSkippableHref(href)) return href;

  const contextParams = new URLSearchParams(currentSearch);
  if (!contextParams.has("shop") || !contextParams.has("host")) return href;

  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return href;
  }

  if (url.origin !== origin || !url.pathname.startsWith("/app")) return href;

  const originalUrl = new URL(href, origin);
  SHOPIFY_TOP_LEVEL_CONTEXT_PARAMS.forEach((param) => {
    const value = contextParams.get(param);
    if (value && !url.searchParams.has(param)) {
      url.searchParams.set(param, value);
    }
  });
  url.searchParams.delete("embedded");
  url.searchParams.delete("id_token");

  const nextHref = `${url.pathname}${url.search}${url.hash}`;
  const originalHref = `${originalUrl.pathname}${originalUrl.search}${originalUrl.hash}`;
  return nextHref === originalHref ? href : nextHref;
}

export function getShopifyAdminAppBaseUrl(referrer: string): string | null {
  if (!referrer) return null;

  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }

  if (url.hostname !== "admin.shopify.com") return null;

  const match = url.pathname.match(/^\/store\/[^/]+\/apps\/[^/]+/);
  return match ? `${url.origin}${match[0]}` : null;
}

function decodeShopifyHost(host: string): string | null {
  const normalized = host.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  try {
    return globalThis.atob(padded);
  } catch {
    return null;
  }
}

export function getShopifyAdminAppBaseUrlFromContext(currentSearch: string, apiKey: string): string | null {
  if (!apiKey) return null;

  const host = new URLSearchParams(currentSearch).get("host");
  if (!host) return null;

  const decodedHost = decodeShopifyHost(host);
  if (!decodedHost || !decodedHost.startsWith("admin.shopify.com/store/")) return null;

  return `https://${decodedHost}/apps/${apiKey}`;
}

export function toShopifyAdminAppHref(
  href: string,
  currentSearch: string,
  origin: string,
  adminAppBaseUrl: string | null,
  appBasePath = DEFAULT_APP_BASE_PATH,
): string {
  if (!adminAppBaseUrl || isSkippableHref(href)) return href;

  const contextParams = new URLSearchParams(currentSearch);
  if (!contextParams.has("shop") || !contextParams.has("host")) return href;

  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return href;
  }

  if (url.origin !== origin || !url.pathname.startsWith(appBasePath)) return href;

  const adminUrl = new URL(adminAppBaseUrl);
  adminUrl.pathname = `${adminUrl.pathname}${url.pathname}`;
  url.searchParams.delete("embedded");
  url.searchParams.delete("id_token");
  adminUrl.search = url.search;
  adminUrl.hash = url.hash;

  return adminUrl.toString();
}
