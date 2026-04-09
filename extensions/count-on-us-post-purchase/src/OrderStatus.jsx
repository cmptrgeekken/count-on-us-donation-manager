/* eslint-disable import/no-unresolved */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { DonationSummary } from "./DonationSummary.jsx";

export default async () => {
  render(
    <DonationSummary
      modeLabel="Order status donation summary"
      getOrderId={() => shopify.order.value?.id ?? null}
    />,
    document.body,
  );
};
