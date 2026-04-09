/* eslint-disable import/no-unresolved */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { DonationSummary } from "./DonationSummary.jsx";

export default async () => {
  render(
    <DonationSummary
      modeLabel="Thank you donation summary"
      getOrderId={() => shopify.orderConfirmation.value?.order?.id ?? null}
    />,
    document.body,
  );
};
