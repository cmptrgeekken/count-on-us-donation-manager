export function getLocaleFromRequest(request: Request): string {
  const header = request.headers.get("accept-language");
  const primaryLocale = header?.split(",")[0]?.split(";")[0]?.trim();

  if (!primaryLocale) {
    return "en-US";
  }

  try {
    const [supportedLocale] = Intl.NumberFormat.supportedLocalesOf([primaryLocale]);
    return supportedLocale || "en-US";
  } catch {
    return "en-US";
  }
}
