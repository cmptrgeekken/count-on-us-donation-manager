export function getLocaleFromRequest(request: Request): string {
  const header = request.headers.get("accept-language");
  const primaryLocale = header?.split(",")[0]?.trim();
  return primaryLocale || "en-US";
}
