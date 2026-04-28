(function () {
  window.__COUNT_ON_US_TRANSPARENCY_READY__ = false;

  const formatMoney = (value, currencyCode) => {
    const parsed = Number.parseFloat(String(value ?? "0"));
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(parsed) ? parsed : 0);
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const safeExternalUrl = (value) => {
    if (!value) return "";
    try {
      const parsed = new URL(value, window.location.origin);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
    } catch {
      return "";
    }
  };

  const fetchJson = async (url) => {
    const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Transparency request failed with ${response.status}`);
    return response.json();
  };

  const buildUrl = (container) => {
    const proxyBase = container.dataset.proxyBase || "/apps/count-on-us";
    const url = new URL(`${proxyBase}/transparency`, window.location.origin);
    url.searchParams.set("tier", container.dataset.disclosureTier || "minimal");
    url.searchParams.set("showOverviewTotals", container.dataset.showOverviewTotals || "true");
    url.searchParams.set("showCauseSummaries", container.dataset.showCauseSummaries || "true");
    url.searchParams.set("showReceiptHistory", container.dataset.showReceiptHistory || "true");
    return url.toString();
  };

  const renderOverview = (payload) => {
    if (payload.metadata?.hiddenSections?.includes("overview")) return "";

    return `
      <section class="count-on-us-widget__section" aria-labelledby="count-on-us-transparency-overview">
        <h3 class="count-on-us-widget__section-title" id="count-on-us-transparency-overview">Overview</h3>
        <div class="count-on-us-widget__summary-grid">
          <div class="count-on-us-widget__summary-card">
            <span>Donations made</span>
            <strong>${formatMoney(payload.totals?.donationsMade)}</strong>
          </div>
          <div class="count-on-us-widget__summary-card">
            <span>Pending disbursement</span>
            <strong>${formatMoney(payload.totals?.donationsPendingDisbursement)}</strong>
          </div>
        </div>
        <p class="count-on-us-widget__subdued">Pending amounts are committed donation allocations that have not yet been recorded as paid out.</p>
      </section>
    `;
  };

  const renderCauseSummaries = (payload) => {
    const causes = Array.isArray(payload.causeSummaries) ? payload.causeSummaries : [];
    if (!causes.length) return "";

    const rows = causes
      .map(
        (cause) => `
          <tr>
            <td>${escapeHtml(cause.causeName)}</td>
            <td>${formatMoney(cause.donationsMade)}</td>
            <td>${formatMoney(cause.donationsPendingDisbursement)}</td>
          </tr>
        `,
      )
      .join("");

    return `
      <section class="count-on-us-widget__section" aria-labelledby="count-on-us-transparency-causes">
        <h3 class="count-on-us-widget__section-title" id="count-on-us-transparency-causes">Cause summary</h3>
        <table class="count-on-us-widget__table">
          <caption class="count-on-us-widget__visually-hidden">Public donation totals by cause.</caption>
          <thead>
            <tr>
              <th scope="col">Cause</th>
              <th scope="col">Made</th>
              <th scope="col">Pending</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `;
  };

  const renderReceipts = (payload) => {
    const receipts = Array.isArray(payload.receipts) ? payload.receipts : [];
    if (!receipts.length) return "";

    const rows = receipts
      .map((receipt) => {
        const receiptUrl = safeExternalUrl(receipt.receiptUrl);
        return `
          <tr>
            <td>${escapeHtml(receipt.causeName)}</td>
            <td>${formatMoney(receipt.amount)}</td>
            <td>${new Date(receipt.paidAt).toLocaleDateString()}</td>
            <td>${
              receiptUrl
                ? `<a href="${escapeHtml(receiptUrl)}" rel="noreferrer" target="_blank">View receipt</a>`
                : "No receipt"
            }</td>
          </tr>
        `;
      })
      .join("");

    return `
      <section class="count-on-us-widget__section" aria-labelledby="count-on-us-transparency-receipts">
        <h3 class="count-on-us-widget__section-title" id="count-on-us-transparency-receipts">Receipt history</h3>
        <table class="count-on-us-widget__table">
          <caption class="count-on-us-widget__visually-hidden">Public donation receipt history.</caption>
          <thead>
            <tr>
              <th scope="col">Cause</th>
              <th scope="col">Amount</th>
              <th scope="col">Paid</th>
              <th scope="col">Receipt</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `;
  };

  const renderPayload = (payload) => {
    if (!payload.hasPublicActivity) {
      return '<p class="count-on-us-widget__status">Donation transparency details will appear here after a reporting period has public donation activity.</p>';
    }

    return [renderOverview(payload), renderCauseSummaries(payload), renderReceipts(payload)]
      .filter(Boolean)
      .join("");
  };

  const hydrateContainer = async (container) => {
    const panel = container.querySelector("[data-count-on-us-transparency-panel]");
    if (!(panel instanceof HTMLElement)) return;

    try {
      const payload = await fetchJson(buildUrl(container));
      panel.innerHTML = renderPayload(payload);
    } catch {
      panel.innerHTML =
        '<p class="count-on-us-widget__status count-on-us-widget__status--error">Donation transparency details are unavailable right now.</p>';
    }
  };

  const hydrateAll = () => {
    document.querySelectorAll("[data-count-on-us-transparency]").forEach((container) => {
      if (container instanceof HTMLElement) void hydrateContainer(container);
    });
    window.__COUNT_ON_US_TRANSPARENCY_READY__ = true;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrateAll, { once: true });
  } else {
    hydrateAll();
  }
})();
