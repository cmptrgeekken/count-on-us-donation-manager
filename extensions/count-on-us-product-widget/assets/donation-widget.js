(function () {
  const SELECTOR = "[data-count-on-us-widget]";

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function safeExternalUrl(value) {
    if (!value) return "";

    try {
      const parsed = new URL(value, window.location.origin);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
      return "";
    }

    return "";
  }

  function parseMoney(value) {
    const parsed = Number.parseFloat(String(value ?? "0"));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatMoney(value, currencyCode) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  function scaleVariant(variant, quantity) {
    const nextQuantity = Math.max(1, quantity);
    const scaleLine = (line) => ({
      ...line,
      lineCost: (parseMoney(line.lineCost) * nextQuantity).toFixed(2),
    });

    return {
      ...variant,
      quantity: nextQuantity,
      laborCost: (parseMoney(variant.laborCost) * nextQuantity).toFixed(2),
      materialLines: variant.materialLines.map(scaleLine),
      equipmentLines: variant.equipmentLines.map(scaleLine),
      shippingMaterialLines: variant.shippingMaterialLines.map((line) => ({
        ...line,
        lineCost: parseMoney(line.lineCost).toFixed(2),
      })),
      podCostTotal: (parseMoney(variant.podCostTotal) * nextQuantity).toFixed(2),
      mistakeBufferAmount: (parseMoney(variant.mistakeBufferAmount) * nextQuantity).toFixed(2),
      causes: variant.causes.map((cause) => ({
        ...cause,
        estimatedDonationAmount: (parseMoney(cause.estimatedDonationAmount) * nextQuantity).toFixed(2),
      })),
      taxReserve: {
        ...variant.taxReserve,
        estimatedAmount: (parseMoney(variant.taxReserve.estimatedAmount) * nextQuantity).toFixed(2),
      },
    };
  }

  function getVariantId(container) {
    const explicit = container.dataset.selectedVariantId;
    if (explicit) return explicit;

    const form = container.closest("form[action*='/cart/add']") || document.querySelector("form[action*='/cart/add']");
    const variantInput = form && form.querySelector("[name='id']");
    return variantInput ? variantInput.value : "";
  }

  function getQuantity(container) {
    const form = container.closest("form[action*='/cart/add']") || document.querySelector("form[action*='/cart/add']");
    const quantityInput = form && form.querySelector("[name='quantity']");
    if (!quantityInput) return 1;

    const parsed = Number.parseInt(quantityInput.value || "1", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  function findVariant(payload, variantId) {
    return payload.variants.find((variant) => variant.variantId === variantId) || payload.variants[0] || null;
  }

  function renderTable(title, rows) {
    if (!rows.length) return "";

    return `
      <section class="count-on-us-widget__section">
        <h4 class="count-on-us-widget__section-title">${escapeHtml(title)}</h4>
        <table class="count-on-us-widget__table">
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr>
                    <td>${escapeHtml(row.label)}</td>
                    <td>${escapeHtml(row.value)}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </section>
    `;
  }

  function renderCauses(variant) {
    if (!variant.causes.length) return "";

    return `
      <section class="count-on-us-widget__section">
        <h4 class="count-on-us-widget__section-title">Causes</h4>
        <div class="count-on-us-widget__list">
          ${variant.causes
            .map((cause) => {
              const donationLink = safeExternalUrl(cause.donationLink);

              return `
                <article class="count-on-us-widget__cause">
                  <div class="count-on-us-widget__cause-line">
                    <strong>${escapeHtml(cause.name)}</strong>
                    <strong>${formatMoney(parseMoney(cause.estimatedDonationAmount), cause.donationCurrencyCode)}</strong>
                  </div>
                  <div class="count-on-us-widget__cause-line">
                    <span class="count-on-us-widget__subdued">${escapeHtml(cause.donationPercentage)}% of the estimated donation pool</span>
                    ${
                      donationLink
                        ? `<a href="${donationLink}" target="_blank" rel="noreferrer" class="count-on-us-widget__subdued">Donate direct</a>`
                        : ""
                    }
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  function renderFees(variant) {
    return `
      <section class="count-on-us-widget__section">
        <h4 class="count-on-us-widget__section-title">Shopify fees</h4>
        <div class="count-on-us-widget__list">
          <div class="count-on-us-widget__row">
            <span>Payment processing</span>
            <strong>${escapeHtml(variant.shopifyFees.processingRate)}% + ${formatMoney(parseMoney(variant.shopifyFees.processingFlatFee), variant.currencyCode)}</strong>
          </div>
          ${
            variant.shopifyFees.managedMarketsApplicable
              ? `
                <div class="count-on-us-widget__row">
                  <span>Managed Markets</span>
                  <strong>${escapeHtml(variant.shopifyFees.managedMarketsRate)}%</strong>
                </div>
              `
              : ""
          }
        </div>
      </section>
    `;
  }

  function renderTaxReserve(variant) {
    if (variant.taxReserve.suppressed) {
      return `
        <section class="count-on-us-widget__section">
          <h4 class="count-on-us-widget__section-title">Estimated tax reserve</h4>
          <p class="count-on-us-widget__status">Estimated tax reserve is currently suppressed.</p>
        </section>
      `;
    }

    return `
      <section class="count-on-us-widget__section">
        <h4 class="count-on-us-widget__section-title">Estimated tax reserve</h4>
        <div class="count-on-us-widget__list">
          <div class="count-on-us-widget__row">
            <span>Rate</span>
            <strong>${escapeHtml(variant.taxReserve.estimatedRate)}%</strong>
          </div>
          <div class="count-on-us-widget__row">
            <span>Estimated amount</span>
            <strong>${formatMoney(parseMoney(variant.taxReserve.estimatedAmount), variant.currencyCode)}</strong>
          </div>
        </div>
      </section>
    `;
  }

  function renderVariant(panel, payload, variantId, quantity) {
    const variant = findVariant(payload, variantId);
    if (!variant) {
      panel.innerHTML = `<p class="count-on-us-widget__status count-on-us-widget__status--error">Donation estimate unavailable right now.</p>`;
      return;
    }

    const scaled = scaleVariant(variant, quantity);
    const costRows = [
      { label: "Labor", value: formatMoney(parseMoney(scaled.laborCost), scaled.currencyCode) },
      ...scaled.materialLines.map((line) => ({
        label: line.name,
        value: formatMoney(parseMoney(line.lineCost), scaled.currencyCode),
      })),
      ...scaled.equipmentLines.map((line) => ({
        label: line.name,
        value: formatMoney(parseMoney(line.lineCost), scaled.currencyCode),
      })),
      ...scaled.shippingMaterialLines.map((line) => ({
        label: `${line.name} (per shipment)`,
        value: formatMoney(parseMoney(line.lineCost), scaled.currencyCode),
      })),
      { label: "POD", value: formatMoney(parseMoney(scaled.podCostTotal), scaled.currencyCode) },
      {
        label: "Mistake buffer",
        value: formatMoney(parseMoney(scaled.mistakeBufferAmount), scaled.currencyCode),
      },
    ];

    panel.innerHTML = `
      ${renderCauses(scaled)}
      ${renderTable("Cost breakdown", costRows)}
      ${renderFees(scaled)}
      ${renderTaxReserve(scaled)}
    `;
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Widget request failed with ${response.status}`);
    }

    return response.json();
  }

  async function loadMetadata(container) {
    const productId = container.dataset.productId;
    const proxyBase = container.dataset.proxyBase || "/apps/count-on-us";
    const metadataUrl = `${proxyBase}/products/${encodeURIComponent(productId)}?metadataOnly=1`;
    const json = await fetchJson(metadataUrl);
    return json.data;
  }

  async function loadPayload(container) {
    const productId = container.dataset.productId;
    const proxyBase = container.dataset.proxyBase || "/apps/count-on-us";
    const payloadUrl = `${proxyBase}/products/${encodeURIComponent(productId)}`;
    const json = await fetchJson(payloadUrl);
    return json.data;
  }

  async function setupWidget(container) {
    if (!container || container.dataset.widgetReady === "true") return;
    container.dataset.widgetReady = "true";

    const toggle = container.querySelector("[data-count-on-us-toggle]");
    const panel = container.querySelector("[data-count-on-us-panel]");
    const liveRegion = container.querySelector("[data-count-on-us-live]");
    if (!toggle || !panel) return;

    let payload = null;
    let isOpen = false;

    const setStatus = (message, tone) => {
      panel.innerHTML = `<p class="count-on-us-widget__status${tone === "error" ? " count-on-us-widget__status--error" : ""}">${escapeHtml(message)}</p>`;
      if (liveRegion) {
        liveRegion.textContent = message;
      }
    };

    const renderCurrent = () => {
      if (!payload) return;
      renderVariant(panel, payload, getVariantId(container), getQuantity(container));
      if (liveRegion) {
        liveRegion.textContent = "Donation estimate updated.";
      }
    };

    try {
      const metadata = await loadMetadata(container);
      if (!metadata.visible) {
        container.hidden = true;
        return;
      }

      if (metadata.deliveryMode === "preload") {
        payload = await loadPayload(container);
      }
    } catch (error) {
      console.error("[Count On Us Widget] Failed to load metadata:", error);
      container.hidden = true;
      return;
    }

    toggle.addEventListener("click", async () => {
      isOpen = !isOpen;
      toggle.setAttribute("aria-expanded", String(isOpen));
      panel.hidden = !isOpen;
      toggle.querySelector("[aria-hidden='true']").textContent = isOpen ? "-" : "+";

      if (!isOpen) return;

      if (!payload) {
        setStatus("Loading donation estimate...", "info");
        try {
          payload = await loadPayload(container);
        } catch (error) {
          console.error("[Count On Us Widget] Failed to load payload:", error);
          setStatus("Donation estimate unavailable right now.", "error");
          return;
        }
      }

      renderCurrent();
    });

    const form = container.closest("form[action*='/cart/add']") || document.querySelector("form[action*='/cart/add']");
    if (!form) return;

    form.addEventListener("change", () => {
      if (!isOpen || !payload) return;
      renderCurrent();
    });

    form.addEventListener("input", () => {
      if (!isOpen || !payload) return;
      renderCurrent();
    });
  }

  function initWidgets(root) {
    root.querySelectorAll(SELECTOR).forEach((container) => {
      void setupWidget(container);
    });
  }

  function boot(root) {
    initWidgets(root);
  }

  function aggregateCartCauseTotals(lines, payloads) {
    const payloadMap = new Map(payloads.map((payload) => [payload.productId, payload]));
    const totals = new Map();
    let hasDonationProducts = false;

    lines.forEach((line) => {
      const payload = payloadMap.get(line.productId);
      if (!payload || !payload.visible) return;

      const variant = findVariant(payload, line.variantId);
      if (!variant) return;

      hasDonationProducts = true;
      const scaled = scaleVariant(variant, line.quantity);

      scaled.causes.forEach((cause) => {
        const current = totals.get(cause.causeId) || {
          causeId: cause.causeId,
          name: cause.name,
          amount: 0,
          donationCurrencyCode: cause.donationCurrencyCode,
          donationLink: cause.donationLink,
        };
        current.amount += parseMoney(cause.estimatedDonationAmount);
        totals.set(cause.causeId, current);
      });
    });

    return {
      hasDonationProducts,
      totals: Array.from(totals.values())
        .map((cause) => ({
          ...cause,
          amount: cause.amount.toFixed(2),
        }))
        .sort((left, right) => parseMoney(right.amount) - parseMoney(left.amount) || left.name.localeCompare(right.name)),
    };
  }

  function trapFocus(dialog, event) {
    if (event.key !== "Tab") return;

    const focusables = dialog.querySelectorAll(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function parseCartSummaryLines(container) {
    const linesScript = container.querySelector("[data-count-on-us-cart-lines]");
    const encodedLines = container.dataset.countOnUsCartLinesJson || "";

    try {
      const rawLines = linesScript?.textContent || (encodedLines ? decodeURIComponent(encodedLines) : "[]");
      return JSON.parse(rawLines || "[]");
    } catch (error) {
      console.error("[Count On Us Cart Summary] Invalid cart lines payload:", error);
      return [];
    }
  }

  function createCartSummaryController(trigger) {
    let modal = null;
    let lastFocusedElement = null;

    function closeModal() {
      if (!modal) return;
      modal.remove();
      modal = null;
      trigger.setAttribute("aria-expanded", "false");
      if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
        lastFocusedElement.focus();
      } else {
        trigger.focus();
      }
    }

    function openModal(content) {
      if (modal) closeModal();
      lastFocusedElement = document.activeElement;

      modal = document.createElement("div");
      modal.className = "count-on-us-widget__modal-overlay";
      modal.innerHTML = `
        <div class="count-on-us-widget__modal" role="dialog" aria-modal="true" aria-labelledby="count-on-us-cart-title">
          <div class="count-on-us-widget__modal-header">
            <div>
              <h3 id="count-on-us-cart-title" class="count-on-us-widget__heading">Cart donation impact</h3>
              <p class="count-on-us-widget__description">Estimated donation totals across the causes in this cart.</p>
            </div>
            <button type="button" class="count-on-us-widget__modal-close" data-count-on-us-cart-close aria-label="Close donation summary">&times;</button>
          </div>
          <div>${content}</div>
        </div>
      `;

      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          closeModal();
        }
      });
      modal.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeModal();
          return;
        }

        const dialog = modal.querySelector("[role='dialog']");
        if (dialog) {
          trapFocus(dialog, event);
        }
      });

      document.body.appendChild(modal);
      trigger.setAttribute("aria-expanded", "true");

      const closeButton = modal.querySelector("[data-count-on-us-cart-close]");
      closeButton.addEventListener("click", closeModal);
      closeButton.focus();
    }

    return { closeModal, openModal };
  }

  const cartSummaryControllers = new WeakMap();

  function getCartSummaryController(trigger) {
    let controller = cartSummaryControllers.get(trigger);
    if (!controller) {
      controller = createCartSummaryController(trigger);
      cartSummaryControllers.set(trigger, controller);
    }
    return controller;
  }

  async function handleCartSummaryTrigger(container, trigger) {
    const { openModal } = getCartSummaryController(trigger);
    const lines = parseCartSummaryLines(container);

    if (!lines.length) {
      openModal(`<p class="count-on-us-widget__status">No donation products in this cart yet.</p>`);
      return;
    }

    openModal(`<p class="count-on-us-widget__status">Loading donation summary...</p>`);

    try {
      const uniqueProducts = Array.from(new Set(lines.map((line) => line.productId)));
      const proxyBase = container.dataset.proxyBase || "/apps/count-on-us";
      const payloads = await Promise.all(
        uniqueProducts.map(async (productId) => {
          const json = await fetchJson(`${proxyBase}/products/${encodeURIComponent(productId)}`);
          return json.data;
        }),
      );

      const summary = aggregateCartCauseTotals(lines, payloads);

      if (!summary.hasDonationProducts || !summary.totals.length) {
        openModal(`<p class="count-on-us-widget__status">No donation products in this cart yet.</p>`);
        return;
      }

      openModal(`
        <section class="count-on-us-widget__section">
          <h4 class="count-on-us-widget__section-title">Causes</h4>
          <div class="count-on-us-widget__list">
            ${summary.totals
              .map((cause) => {
                const donationLink = safeExternalUrl(cause.donationLink);

                return `
                  <article class="count-on-us-widget__cause">
                    <div class="count-on-us-widget__cause-line">
                      <strong>${escapeHtml(cause.name)}</strong>
                      <strong>${formatMoney(parseMoney(cause.amount), cause.donationCurrencyCode)}</strong>
                    </div>
                    ${
                      donationLink
                        ? `<div class="count-on-us-widget__cause-line"><span class="count-on-us-widget__subdued">Estimated across your cart</span><a href="${donationLink}" target="_blank" rel="noreferrer" class="count-on-us-widget__subdued">Donate direct</a></div>`
                        : `<div class="count-on-us-widget__cause-line"><span class="count-on-us-widget__subdued">Estimated across your cart</span></div>`
                    }
                  </article>
                `;
              })
              .join("")}
          </div>
        </section>
      `);
    } catch (error) {
      console.error("[Count On Us Cart Summary] Failed to load summary:", error);
      openModal(`<p class="count-on-us-widget__status count-on-us-widget__status--error">Donation summary unavailable right now.</p>`);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => boot(document), { once: true });
    window.addEventListener("load", () => boot(document), { once: true });
    window.setTimeout(() => boot(document), 0);
  } else {
    boot(document);
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target instanceof Element ? event.target.closest("[data-count-on-us-cart-trigger]") : null;
    if (!(trigger instanceof HTMLElement)) return;

    const container = trigger.closest("[data-count-on-us-cart-summary]");
    if (!(container instanceof HTMLElement)) return;

    event.preventDefault();
    void handleCartSummaryTrigger(container, trigger);
  });

  document.addEventListener("shopify:section:load", (event) => {
    if (event.target instanceof HTMLElement) {
      boot(event.target);
    }
  });
})();
