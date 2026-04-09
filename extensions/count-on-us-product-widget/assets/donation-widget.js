(function () {
  const SELECTOR = "[data-count-on-us-widget]";

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
        <h4 class="count-on-us-widget__section-title">${title}</h4>
        <table class="count-on-us-widget__table">
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr>
                    <td>${row.label}</td>
                    <td>${row.value}</td>
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
            .map(
              (cause) => `
                <article class="count-on-us-widget__cause">
                  <div class="count-on-us-widget__cause-line">
                    <strong>${cause.name}</strong>
                    <strong>${formatMoney(parseMoney(cause.estimatedDonationAmount), cause.donationCurrencyCode)}</strong>
                  </div>
                  <div class="count-on-us-widget__cause-line">
                    <span class="count-on-us-widget__subdued">${cause.donationPercentage}% of the estimated donation pool</span>
                    ${
                      cause.donationLink
                        ? `<a href="${cause.donationLink}" target="_blank" rel="noreferrer" class="count-on-us-widget__subdued">Donate direct</a>`
                        : ""
                    }
                  </div>
                </article>
              `,
            )
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
            <strong>${variant.shopifyFees.processingRate}% + ${formatMoney(parseMoney(variant.shopifyFees.processingFlatFee), variant.currencyCode)}</strong>
          </div>
          ${
            variant.shopifyFees.managedMarketsApplicable
              ? `
                <div class="count-on-us-widget__row">
                  <span>Managed Markets</span>
                  <strong>${variant.shopifyFees.managedMarketsRate}%</strong>
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
            <strong>${variant.taxReserve.estimatedRate}%</strong>
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

    let metadata = null;
    let payload = null;
    let isOpen = false;

    const setStatus = (message, tone) => {
      panel.innerHTML = `<p class="count-on-us-widget__status${tone === "error" ? " count-on-us-widget__status--error" : ""}">${message}</p>`;
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
      metadata = await loadMetadata(container);
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
      toggle.querySelector("[aria-hidden='true']").textContent = isOpen ? "−" : "+";

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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initWidgets(document));
  } else {
    initWidgets(document);
  }

  document.addEventListener("shopify:section:load", (event) => {
    if (event.target instanceof HTMLElement) {
      initWidgets(event.target);
    }
  });
})();
