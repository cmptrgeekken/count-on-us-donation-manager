/* eslint-disable import/no-unresolved */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  Banner,
  BlockStack,
  InlineStack,
  Link,
  Text,
  useApi,
  useExtensionTarget,
  useOrder,
} from "@shopify/ui-extensions-react/checkout";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 30000;

render(<Extension />, document.body);

function Extension() {
  const api = useApi();
  const order = useOrder();
  const extensionTarget = useExtensionTarget();
  const [state, setState] = useState({ status: "loading", payload: null });

  const orderId = order?.id;
  const modeLabel = useMemo(
    () =>
      extensionTarget === "purchase.thank-you.block.render"
        ? "Thank you donation summary"
        : "Order status donation summary",
    [extensionTarget],
  );

  useEffect(() => {
    let alive = true;
    let timeoutId = null;

    async function pollDonationSummary() {
      if (!orderId) {
        if (alive) {
          setState({ status: "hidden", payload: null });
        }
        return;
      }

      const startedAt = Date.now();
      while (alive && Date.now() - startedAt < POLL_TIMEOUT_MS) {
        try {
          const token = await api.sessionToken.get();
          const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/donation`, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          });

          if (response.status === 404) {
            if (alive) {
              setState({ status: "hidden", payload: null });
            }
            return;
          }

          if (response.ok) {
            const json = await response.json();
            if (json?.data?.status === "confirmed") {
              if (alive) {
                setState({ status: "confirmed", payload: json.data });
              }
              return;
            }

            if (json?.data?.status === "pending") {
              if (alive) {
                setState({ status: "pending", payload: json.data });
              }
            }
          }
        } catch (_error) {
          if (alive) {
            setState({ status: "hidden", payload: null });
          }
          return;
        }

        await new Promise((resolve) => {
          timeoutId = setTimeout(resolve, POLL_INTERVAL_MS);
        });
      }

      if (alive && state.payload?.estimated) {
        setState({ status: "timeout", payload: state.payload });
      }
    }

    void pollDonationSummary();

    return () => {
      alive = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [api.sessionToken, orderId, state.payload]);

  if (state.status === "hidden") {
    return null;
  }

  const payload = state.payload;
  const causes =
    payload?.status === "confirmed"
      ? payload.causes
      : payload?.estimated?.causes ?? [];
  const total =
    payload?.status === "confirmed"
      ? payload.totalDonated
      : payload?.estimated?.totalDonated ?? "0.00";

  return (
    <BlockStack spacing="base" aria-label={modeLabel}>
      <Text emphasis="bold">Donation impact</Text>
      {state.status === "pending" || state.status === "timeout" ? (
        <Banner tone="info">
          <Text>
            {state.status === "timeout"
              ? "Estimated — we'll confirm this shortly."
              : "Estimated donation amounts while we confirm the final snapshot."}
          </Text>
        </Banner>
      ) : null}
      {state.status === "confirmed" ? (
        <Banner tone="success">
          <Text>Confirmed donation amounts for this order.</Text>
        </Banner>
      ) : null}
      <Text>Total donated: {total}</Text>
      <BlockStack spacing="tight">
        {causes.map((cause) => (
          <InlineStack key={cause.causeId} align="space-between">
            <Text>{cause.name}</Text>
            <InlineStack spacing="tight">
              <Text>{cause.amount}</Text>
              {cause.donationLink ? <Link to={cause.donationLink}>Donate direct</Link> : null}
            </InlineStack>
          </InlineStack>
        ))}
      </BlockStack>
    </BlockStack>
  );
}
