import { useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";

type PreviewMode = "confirmed" | "timeout" | "error" | "hidden";
type PreviewSurface = "thank-you" | "order-status";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const mode = (url.searchParams.get("mode") as PreviewMode) || "confirmed";
  const surface = (url.searchParams.get("surface") as PreviewSurface) || "thank-you";

  return Response.json({
    mode,
    surface,
  });
};

export default function PostPurchaseDonationPreviewRoute() {
  const { mode, surface } = useLoaderData<typeof loader>();
  const [status, setStatus] = useState<"loading" | "pending" | "confirmed" | "timeout" | "hidden">("loading");

  useEffect(() => {
    if (mode === "hidden" || mode === "error") {
      setStatus("hidden");
      return;
    }

    setStatus("pending");
    const timer = setTimeout(() => {
      setStatus(mode === "confirmed" ? "confirmed" : "timeout");
    }, 200);

    return () => clearTimeout(timer);
  }, [mode]);

  const title = surface === "thank-you" ? "Thank you preview" : "Order status preview";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Post-purchase donation preview</title>
        <style>{`
          body { margin: 0; font-family: system-ui, sans-serif; background: #f6f3eb; color: #1f2937; }
          main { max-width: 42rem; margin: 0 auto; padding: 2rem; display: grid; gap: 1rem; }
          section { background: white; border-radius: 1rem; padding: 1rem 1.25rem; border: 1px solid rgba(17,24,39,0.08); }
          .banner { border-radius: 0.85rem; padding: 0.85rem 1rem; background: #eef6ff; }
          .banner.success { background: #edfdf3; }
          .row { display: flex; justify-content: space-between; gap: 1rem; padding: 0.35rem 0; }
          .subdued { color: #6b7280; }
        `}</style>
      </head>
      <body>
        <main>
          <h1>{title}</h1>
          <p className="subdued">Mode: {mode}</p>

          {status !== "hidden" ? (
            <section aria-label="Donation impact">
              <h2>Donation impact</h2>
              {status === "pending" ? (
                <div className="banner">Estimated donation amounts while we confirm the final snapshot.</div>
              ) : null}
              {status === "timeout" ? (
                <div className="banner">Estimated — we&apos;ll confirm this shortly.</div>
              ) : null}
              {status === "confirmed" ? (
                <div className="banner success">Confirmed donation amounts for this order.</div>
              ) : null}
              <div className="row">
                <strong>Neighborhood Arts</strong>
                <span>$12.00</span>
              </div>
              <div className="row">
                <strong>Community Library</strong>
                <span>$8.00</span>
              </div>
              <div className="row">
                <strong>Total donated</strong>
                <strong>$20.00</strong>
              </div>
            </section>
          ) : null}
        </main>
      </body>
    </html>
  );
}
