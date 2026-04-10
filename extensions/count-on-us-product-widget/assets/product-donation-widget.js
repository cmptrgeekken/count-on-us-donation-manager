(function () {
  const SELECTOR = "[data-count-on-us-widget]";
  const money = (value) => {
    const parsed = Number.parseFloat(String(value ?? "0"));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const formatMoney = (value, currencyCode) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
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
  const toVariantGid = (value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) return "";
    return normalized.startsWith("gid://shopify/ProductVariant/")
      ? normalized
      : `gid://shopify/ProductVariant/${normalized}`;
  };
  const findVariant = (payload, variantId) => payload.variants.find((variant) => variant.variantId === variantId) || payload.variants[0] || null;
  const closestAddToCartForm = (container) => container.closest("form[action*='/cart/add']") || document.querySelector("form[action*='/cart/add']");
  const getVariantId = (container) => {
    const variantInput = closestAddToCartForm(container)?.querySelector("[name='id']");
    if (variantInput) return toVariantGid(variantInput.value);
    if (container.dataset.selectedVariantId) return toVariantGid(container.dataset.selectedVariantId);
    return "";
  };
  const getQuantity = (container) => {
    const quantityInput = closestAddToCartForm(container)?.querySelector("[name='quantity']");
    if (!quantityInput) return 1;
    const parsed = Number.parseInt(quantityInput.value || "1", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  };
  const scaleVariant = (variant, quantity) => {
    const nextQuantity = Math.max(1, quantity);
    const scaleLine = (line) => ({ ...line, lineCost: (money(line.lineCost) * nextQuantity).toFixed(2) });
    return {
      ...variant,
      quantity: nextQuantity,
      laborCost: (money(variant.laborCost) * nextQuantity).toFixed(2),
      materialLines: variant.materialLines.map(scaleLine),
      equipmentLines: variant.equipmentLines.map(scaleLine),
      shippingMaterialLines: variant.shippingMaterialLines.map((line) => ({ ...line, lineCost: money(line.lineCost).toFixed(2) })),
      podCostTotal: (money(variant.podCostTotal) * nextQuantity).toFixed(2),
      mistakeBufferAmount: (money(variant.mistakeBufferAmount) * nextQuantity).toFixed(2),
      causes: variant.causes.map((cause) => ({ ...cause, estimatedDonationAmount: (money(cause.estimatedDonationAmount) * nextQuantity).toFixed(2) })),
      taxReserve: { ...variant.taxReserve, estimatedAmount: (money(variant.taxReserve.estimatedAmount) * nextQuantity).toFixed(2) },
    };
  };
  const fetchJson = async (url) => {
    const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Widget request failed with ${response.status}`);
    return response.json();
  };
  const loadMetadata = async (container) => {
    const proxyBase = container.dataset.proxyBase || "/apps/count-on-us";
    const json = await fetchJson(`${proxyBase}/products/${encodeURIComponent(container.dataset.productId)}?metadataOnly=1`);
    return json.data;
  };
  const loadPayload = async (container) => {
    const proxyBase = container.dataset.proxyBase || "/apps/count-on-us";
    const json = await fetchJson(`${proxyBase}/products/${encodeURIComponent(container.dataset.productId)}`);
    return json.data;
  };
  const row = (label, value) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`;
  const section = (title, body) => `<section class="count-on-us-widget__section"><h4 class="count-on-us-widget__section-title">${escapeHtml(title)}</h4>${body}</section>`;
  const renderVariant = (panel, payload, variantId, quantity) => {
    const variant = findVariant(payload, variantId);
    if (!variant) {
      panel.innerHTML = '<p class="count-on-us-widget__status count-on-us-widget__status--error">Donation estimate unavailable right now.</p>';
      return;
    }
    const scaled = scaleVariant(variant, quantity);
    const causes = scaled.causes.length
      ? section(
          "Causes",
          `<div class="count-on-us-widget__list">${scaled.causes
            .map((cause) => {
              const donationLink = safeExternalUrl(cause.donationLink);
              return `<article class="count-on-us-widget__cause"><div class="count-on-us-widget__cause-line"><strong>${escapeHtml(cause.name)}</strong><strong>${formatMoney(money(cause.estimatedDonationAmount), cause.donationCurrencyCode)}</strong></div><div class="count-on-us-widget__cause-line"><span class="count-on-us-widget__subdued">${escapeHtml(cause.donationPercentage)}% of the estimated donation pool</span>${donationLink ? `<a href="${donationLink}" target="_blank" rel="noreferrer" class="count-on-us-widget__subdued">Donate direct</a>` : ""}</div></article>`;
            })
            .join("")}</div>`,
        )
      : "";
    const costRows = [
      row("Labor", formatMoney(money(scaled.laborCost), scaled.currencyCode)),
      ...scaled.materialLines.map((line) => row(line.name, formatMoney(money(line.lineCost), scaled.currencyCode))),
      ...scaled.equipmentLines.map((line) => row(line.name, formatMoney(money(line.lineCost), scaled.currencyCode))),
      ...scaled.shippingMaterialLines.map((line) => row(`${line.name} (per shipment)`, formatMoney(money(line.lineCost), scaled.currencyCode))),
      row("POD", formatMoney(money(scaled.podCostTotal), scaled.currencyCode)),
      row("Mistake buffer", formatMoney(money(scaled.mistakeBufferAmount), scaled.currencyCode)),
    ].join("");
    const fees = section(
      "Shopify fees",
      `<div class="count-on-us-widget__list"><div class="count-on-us-widget__row"><span>Payment processing</span><strong>${escapeHtml(scaled.shopifyFees.processingRate)}% + ${formatMoney(money(scaled.shopifyFees.processingFlatFee), scaled.currencyCode)}</strong></div>${scaled.shopifyFees.managedMarketsApplicable ? `<div class="count-on-us-widget__row"><span>Managed Markets</span><strong>${escapeHtml(scaled.shopifyFees.managedMarketsRate)}%</strong></div>` : ""}</div>`,
    );
    const taxReserve = scaled.taxReserve.suppressed
      ? section("Estimated tax reserve", '<p class="count-on-us-widget__status">Estimated tax reserve is currently suppressed.</p>')
      : section(
          "Estimated tax reserve",
          `<div class="count-on-us-widget__list"><div class="count-on-us-widget__row"><span>Rate</span><strong>${escapeHtml(scaled.taxReserve.estimatedRate)}%</strong></div><div class="count-on-us-widget__row"><span>Estimated amount</span><strong>${formatMoney(money(scaled.taxReserve.estimatedAmount), scaled.currencyCode)}</strong></div></div>`,
        );
    panel.innerHTML = `${causes}${section("Cost breakdown", `<table class="count-on-us-widget__table"><tbody>${costRows}</tbody></table>`)}${fees}${taxReserve}`;
  };
  async function setupWidget(container) {
    if (!container || container.dataset.widgetReady === "true") return;
    container.dataset.widgetReady = "true";
    container.dataset.widgetInteractive = "false";
    const toggle = container.querySelector("[data-count-on-us-toggle]");
    const panel = container.querySelector("[data-count-on-us-panel]");
    const liveRegion = container.querySelector("[data-count-on-us-live]");
    if (!toggle || !panel) return;
    let payload = null;
    let isOpen = false;
    let lastRenderedVariantId = "";
    let lastRenderedQuantity = 0;
    let syncTimer = null;
    const setStatus = (message, tone) => {
      panel.innerHTML = `<p class="count-on-us-widget__status${tone === "error" ? " count-on-us-widget__status--error" : ""}">${escapeHtml(message)}</p>`;
      if (liveRegion) liveRegion.textContent = message;
    };
    const renderCurrent = () => {
      if (!payload) return;
      const variantId = getVariantId(container);
      const quantity = getQuantity(container);
      lastRenderedVariantId = variantId;
      lastRenderedQuantity = quantity;
      renderVariant(panel, payload, variantId, quantity);
      if (liveRegion) liveRegion.textContent = "Donation estimate updated.";
    };
    const syncCurrent = () => {
      if (!isOpen || !payload) return;
      const variantId = getVariantId(container);
      const quantity = getQuantity(container);
      if (variantId !== lastRenderedVariantId || quantity !== lastRenderedQuantity) {
        renderCurrent();
      }
    };
    const startSync = () => {
      if (syncTimer) return;
      syncTimer = window.setInterval(syncCurrent, 200);
    };
    const stopSync = () => {
      if (!syncTimer) return;
      window.clearInterval(syncTimer);
      syncTimer = null;
    };
    try {
      const metadata = await loadMetadata(container);
      if (!metadata.visible) {
        container.hidden = true;
        container.dataset.widgetInteractive = "true";
        return;
      }
      if (metadata.deliveryMode === "preload") payload = await loadPayload(container);
    } catch (error) {
      console.error("[Count On Us Widget] Failed to load metadata:", error);
      container.hidden = true;
      container.dataset.widgetInteractive = "true";
      return;
    }
    toggle.addEventListener("click", async () => {
      isOpen = !isOpen;
      toggle.setAttribute("aria-expanded", String(isOpen));
      panel.hidden = !isOpen;
      toggle.querySelector("[aria-hidden='true']").textContent = isOpen ? "-" : "+";
      if (!isOpen) {
        stopSync();
        return;
      }
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
      startSync();
    });
    container.dataset.widgetBound = "true";
    const form = closestAddToCartForm(container);
    const eventTarget = form || document;
    const scheduleSync = () => window.setTimeout(syncCurrent, 0);
    eventTarget.addEventListener("change", scheduleSync);
    eventTarget.addEventListener("input", scheduleSync);
    eventTarget.addEventListener("click", scheduleSync);
    document.addEventListener("variant:change", scheduleSync);
    container.dataset.widgetInteractive = "true";
  }
  const boot = (root) => root.querySelectorAll(SELECTOR).forEach((container) => void setupWidget(container));
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => boot(document), { once: true });
    window.addEventListener("load", () => boot(document), { once: true });
    window.setTimeout(() => boot(document), 0);
  } else {
    boot(document);
  }
  document.addEventListener("shopify:section:load", (event) => {
    if (event.target instanceof HTMLElement) boot(event.target);
  });
})();
