import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  buildDonationReceiptsPage,
  type DonationReceiptsPageData,
} from "../services/donationReceiptsPage.server";
import { authenticatePublicAppProxyRequest } from "../utils/public-auth.server";
import { checkRateLimit } from "../utils/rate-limit.server";

function getClientIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "anonymous"
  );
}

function formatCurrency(value: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatDateRange(startDate: string, endDate: string) {
  return `${new Date(startDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })} - ${new Date(endDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shopifyDomain } = await authenticatePublicAppProxyRequest(request);
  const rateLimit = checkRateLimit({
    key: `donation-receipts:${shopifyDomain}:${getClientIpAddress(request)}`,
    limit: 30,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    throw new Response("Too many donation receipt requests. Please try again shortly.", {
      status: 429,
      headers: rateLimit.headers,
    });
  }

  const page = await buildDonationReceiptsPage(shopifyDomain);
  return Response.json(page, {
    headers: rateLimit.headers,
  });
};

export default function DonationReceiptsPageRoute() {
  const page = useLoaderData<typeof loader>() as DonationReceiptsPageData;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Donation receipts</title>
        <style>{`
          :root {
            color-scheme: light;
            font-family: system-ui, sans-serif;
            background: #faf7ef;
            color: #1f2937;
          }
          body {
            margin: 0;
            background:
              radial-gradient(circle at top left, rgba(254, 240, 138, 0.18), transparent 28%),
              #faf7ef;
          }
          .page {
            max-width: 72rem;
            margin: 0 auto;
            padding: 1.5rem;
            display: grid;
            gap: 1.5rem;
          }
          .skip-link {
            position: absolute;
            left: 1rem;
            top: -3rem;
            background: #111827;
            color: white;
            padding: 0.75rem 1rem;
            border-radius: 0.75rem;
          }
          .skip-link:focus {
            top: 1rem;
          }
          .hero, .period, .empty-state {
            background: rgba(255,255,255,0.92);
            border: 1px solid rgba(146, 64, 14, 0.12);
            border-radius: 1.25rem;
            padding: 1.25rem;
          }
          .hero p, .empty-state p {
            color: #4b5563;
            margin-bottom: 0;
          }
          .period {
            display: grid;
            gap: 1rem;
          }
          .period-grid {
            display: grid;
            gap: 1rem;
            grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
          }
          .metric {
            border-radius: 1rem;
            background: #fffaf0;
            padding: 0.9rem 1rem;
          }
          .metric strong, .metric span {
            display: block;
          }
          .metric span {
            color: #6b7280;
            font-size: 0.92rem;
          }
          h1, h2, h3 {
            margin: 0;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            padding: 0.75rem 0.5rem;
            text-align: left;
            border-top: 1px solid rgba(17, 24, 39, 0.08);
            vertical-align: top;
          }
          th {
            font-size: 0.9rem;
            color: #6b7280;
          }
          .pill-list {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
          }
          .pill {
            border-radius: 999px;
            background: rgba(146, 64, 14, 0.08);
            padding: 0.35rem 0.7rem;
            font-size: 0.92rem;
          }
          a {
            color: #92400e;
          }
        `}</style>
      </head>
      <body>
        <a className="skip-link" href="#donation-receipts-main">
          Skip to donation receipts
        </a>

        <main id="donation-receipts-main" className="page">
          <section className="hero" aria-labelledby="donation-receipts-title">
            <h1 id="donation-receipts-title">Donation receipts</h1>
            <p>
              Closed donation periods appear here after funds have been disbursed. Receipt links refresh each time this page
              loads.
            </p>
          </section>

          {page.hasReceipts ? (
            page.periods.map((period) => (
              <section key={period.id} className="period" aria-labelledby={`period-${period.id}`}>
                <div style={{ display: "grid", gap: "0.4rem" }}>
                  <h2 id={`period-${period.id}`}>{formatDateRange(period.startDate, period.endDate)}</h2>
                  <div className="period-grid">
                    <div className="metric">
                      <span>Total donated</span>
                      <strong>{formatCurrency(period.totalDonated)}</strong>
                    </div>
                    <div className="metric">
                      <span>Disbursements</span>
                      <strong>{period.disbursements.length}</strong>
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gap: "0.6rem" }}>
                  <h3>Cause breakdown</h3>
                  <div className="pill-list" aria-label="Cause breakdown">
                    {period.causeBreakdown.map((cause) => (
                      <span key={cause.causeId} className="pill">
                        {cause.causeName}: {formatCurrency(cause.allocated)}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ display: "grid", gap: "0.6rem" }}>
                  <h3>Disbursements</h3>
                  <table>
                    <caption style={{ textAlign: "left", marginBottom: "0.5rem", color: "#4b5563" }}>
                      Donation disbursements for this closed reporting period.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Cause</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Paid</th>
                        <th scope="col">Method</th>
                        <th scope="col">Reference</th>
                        <th scope="col">Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {period.disbursements.map((disbursement) => (
                        <tr key={disbursement.id}>
                          <td>{disbursement.causeName}</td>
                          <td>{formatCurrency(disbursement.amount)}</td>
                          <td>{formatDate(disbursement.paidAt)}</td>
                          <td>{disbursement.paymentMethod}</td>
                          <td>{disbursement.referenceId || "-"}</td>
                          <td>
                            {disbursement.receiptUrl ? (
                              <a href={disbursement.receiptUrl} rel="noreferrer" target="_blank">
                                View receipt
                              </a>
                            ) : (
                              "No receipt"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          ) : (
            <section className="empty-state" aria-labelledby="no-receipts-title">
              <h2 id="no-receipts-title">No donation receipts yet</h2>
              <p>
                Donation receipts appear here after a closed reporting period has recorded one or more disbursements.
              </p>
            </section>
          )}
        </main>
      </body>
    </html>
  );
}
