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
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    url.searchParams.set("tier", container.dataset.disclosureTier || "minimal");
    url.searchParams.set("showOverviewTotals", container.dataset.showOverviewTotals || "true");
    url.searchParams.set("showCauseSummaries", container.dataset.showCauseSummaries || "true");
    url.searchParams.set("showReceiptHistory", container.dataset.showReceiptHistory || "true");
    url.searchParams.set("showReconciliation", container.dataset.showReconciliation || "true");
    url.searchParams.set("rollup", container.dataset.rollup || "all");
    url.searchParams.set("month", currentMonth);
    url.searchParams.set("year", String(now.getFullYear()));
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
        ${
          payload.metadata?.coverageLabel
            ? `<p class="count-on-us-widget__subdued">Coverage: ${escapeHtml(payload.metadata.coverageLabel)}</p>`
            : ""
        }
      </section>
    `;
  };

  const renderReconciliation = (payload) => {
    const reconciliation = payload.reconciliation;
    if (!reconciliation || !Array.isArray(reconciliation.sections)) return "";

    const sections = reconciliation.sections
      .map((section) => {
        const rows = Array.isArray(section.rows)
          ? section.rows
              .map(
                (row) => `
                  <div class="count-on-us-widget__row count-on-us-widget__row--${escapeHtml(row.tone || "neutral")}">
                    <span>${escapeHtml(row.label)}</span>
                    <strong>${row.tone === "negative" ? "- " : ""}${formatMoney(row.amount)}</strong>
                  </div>
                `,
              )
              .join("")
          : "";

        return `
          <div class="count-on-us-widget__reconciliation-group">
            <h4 class="count-on-us-widget__section-title">${escapeHtml(section.title)}</h4>
            <div class="count-on-us-widget__list">${rows}</div>
          </div>
        `;
      })
      .join("");

    const notes = Array.isArray(reconciliation.notes)
      ? reconciliation.notes
          .map((note) => `<p class="count-on-us-widget__subdued">${escapeHtml(note)}</p>`)
          .join("")
      : "";

    return `
      <section class="count-on-us-widget__section" aria-labelledby="count-on-us-transparency-reconciliation">
        <h3 class="count-on-us-widget__section-title" id="count-on-us-transparency-reconciliation">Financial summary</h3>
        ${sections}
        ${notes}
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

  const renderReceiptCauseSummaries = (payload) => {
    const causes = Array.isArray(payload.receiptCauseSummaries) ? payload.receiptCauseSummaries : [];
    if (!causes.length) return "";

    const rows = causes
      .map((cause) => {
        const receipts = Array.isArray(cause.receipts) ? cause.receipts : [];
        const receiptRows = receipts
          .map((receipt) => {
            const receiptUrl = safeExternalUrl(receipt.receiptUrl);
            return `
              <tr>
                <td>${formatMoney(receipt.amount)}</td>
                <td>${formatMoney(receipt.feesCovered)}</td>
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
          <tr>
            <td>${escapeHtml(cause.causeName)}</td>
            <td>${formatMoney(cause.donationsMade)}</td>
            <td>${formatMoney(cause.feesCovered)}</td>
            <td>${escapeHtml(cause.receiptCount)}</td>
          </tr>
          <tr>
            <td colspan="4">
              <details class="count-on-us-widget__details">
                <summary class="count-on-us-widget__details-summary">View receipts for ${escapeHtml(cause.causeName)}</summary>
                <div class="count-on-us-widget__details-body">
                  <table class="count-on-us-widget__table">
                    <caption class="count-on-us-widget__visually-hidden">Receipts for ${escapeHtml(cause.causeName)}.</caption>
                    <thead>
                      <tr>
                        <th scope="col">Amount</th>
                        <th scope="col">Fees covered</th>
                        <th scope="col">Paid</th>
                        <th scope="col">Receipt</th>
                      </tr>
                    </thead>
                    <tbody>${receiptRows}</tbody>
                  </table>
                </div>
              </details>
            </td>
          </tr>
        `;
      })
      .join("");

    return `
      <section class="count-on-us-widget__section" aria-labelledby="count-on-us-transparency-receipts">
        <h3 class="count-on-us-widget__section-title" id="count-on-us-transparency-receipts">Receipt summary by cause</h3>
        <table class="count-on-us-widget__table">
          <caption class="count-on-us-widget__visually-hidden">Public donation receipt totals grouped by cause.</caption>
          <thead>
            <tr>
              <th scope="col">Cause</th>
              <th scope="col">Donated</th>
              <th scope="col">Fees covered</th>
              <th scope="col">Receipts</th>
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

    return [renderOverview(payload), renderReconciliation(payload), renderCauseSummaries(payload), renderReceiptCauseSummaries(payload)]
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
