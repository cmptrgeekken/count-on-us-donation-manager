/* eslint-disable import/no-unresolved */
import "@shopify/ui-extensions/preact";
import { useEffect, useState } from "preact/hooks";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 30000;

export function DonationSummary({ modeLabel, getOrderId }) {
  const [state, setState] = useState({ status: "loading", payload: null });
  const orderId = getOrderId();

  useEffect(() => {
    let alive = true;
    let timeoutId = null;

    async function pollDonationSummary() {
      if (!orderId) {
        if (alive) setState({ status: "hidden", payload: null });
        return;
      }

      const startedAt = Date.now();
      while (alive && Date.now() - startedAt < POLL_TIMEOUT_MS) {
        try {
          const token = await shopify.sessionToken.get();
          const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/donation`, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          });

          if (response.status === 404) {
            if (alive) setState({ status: "hidden", payload: null });
            return;
          }

          if (response.ok) {
            const json = await response.json();
            if (json?.data?.status === "confirmed") {
              if (alive) setState({ status: "confirmed", payload: json.data });
              return;
            }
            if (json?.data?.status === "pending" && alive) {
              setState({ status: "pending", payload: json.data });
            }
          }
        } catch (_error) {
          if (alive) setState({ status: "hidden", payload: null });
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
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [orderId, state.payload]);

  if (state.status === "hidden") return null;

  const payload = state.payload;
  const causes = payload?.status === "confirmed" ? payload.causes : payload?.estimated?.causes ?? [];
  const total = payload?.status === "confirmed" ? payload.totalDonated : payload?.estimated?.totalDonated ?? "0.00";

  return (
    <s-block-stack gap="base" accessibilityLabel={modeLabel}>
      <s-text emphasis="bold">Donation impact</s-text>
      {state.status === "pending" || state.status === "timeout" ? (
        <s-banner tone="info">
          <s-text>
            {state.status === "timeout"
              ? "Estimated for now; we will confirm this shortly."
              : "Estimated donation amounts while we confirm the final snapshot."}
          </s-text>
        </s-banner>
      ) : null}
      {state.status === "confirmed" ? (
        <s-banner tone="success">
          <s-text>Confirmed donation amounts for this order.</s-text>
        </s-banner>
      ) : null}
      <s-text>Total donated: {total}</s-text>
      <s-block-stack gap="tight">
        {causes.map((cause) => (
          <s-inline-stack key={cause.causeId} inlineAlignment="space-between" gap="tight">
            <s-text>{cause.name}</s-text>
            <s-inline-stack gap="tight">
              <s-text>{cause.amount}</s-text>
              {cause.donationLink ? <s-link href={cause.donationLink}>Donate direct</s-link> : null}
            </s-inline-stack>
          </s-inline-stack>
        ))}
      </s-block-stack>
    </s-block-stack>
  );
}
