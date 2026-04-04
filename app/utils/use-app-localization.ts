import { useRouteLoaderData } from "@remix-run/react";
import l10n from "./localization";

type AppLocalizationData = {
  apiKey: string;
  localization: {
    currency: string;
    locale: string;
  };
};

const FALLBACK_LOCALIZATION = {
  currency: "USD",
  locale: "en-US",
};

export function useAppLocalization() {
  const data = useRouteLoaderData<AppLocalizationData>("routes/app");
  const localization = data?.localization ?? FALLBACK_LOCALIZATION;

  return {
    ...localization,
    ...l10n(localization.currency, localization.locale),
  };
}
