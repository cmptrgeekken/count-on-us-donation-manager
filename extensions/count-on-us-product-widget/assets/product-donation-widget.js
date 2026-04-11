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
  const slugify = (value) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const RECONCILIATION_EXPLANATIONS = {
    estimatedTotal:
      "This is the current estimated total for this item before Count On Us subtracts the costs and reserves that need to be covered first.",
    labor:
      "This portion helps cover the time required to make, prepare, or fulfill this item before any donation amount is estimated.",
    materials:
      "This portion helps cover the raw materials used to make this item before any donation amount is estimated.",
    equipment:
      "This portion helps cover equipment usage and wear involved in producing this item before any donation amount is estimated.",
    packaging:
      "This estimate helps cover packaging and shipping materials, which need to be paid before the remaining amount can be donated.",
    pod: "This portion helps cover any print-on-demand production cost tied to this item before any donation amount is estimated.",
    mistakeBuffer:
      "This portion sets aside a small buffer for remakes, spoilage, or similar production issues so those costs do not come out of the donation estimate later.",
    fees:
      "This estimate helps cover payment processing fees charged on the order. The exact amount can vary depending on how the purchase is completed.",
    taxReserve:
      "This estimate sets aside money for taxes that may be owed on the sale, so that amount is not counted as part of the donation estimate.",
    estimatedDonationPool:
      "This is the amount left after estimated costs, fees, and reserves are subtracted from the total. That remainder is then split between the causes and any portion the shop keeps.",
    allocatedDonations:
      "This is the portion of the remaining amount that is currently assigned to the causes connected to this item.",
    retainedByShop:
      "This is any remaining portion that stays with the shop instead of being assigned to a cause. When this item is set to donate 100%, this should be zero.",
    remainder:
      "This shows any small leftover difference between the total and the displayed estimate buckets. It should usually be zero.",
  };
  const renderInfoLabel = (label, explanationKey) => {
    const explanation = RECONCILIATION_EXPLANATIONS[explanationKey];
    if (!explanation) return escapeHtml(label);

    const tooltipId = `count-on-us-tooltip-${slugify(explanationKey)}-${slugify(label)}`;
    return `<span class="count-on-us-widget__label-with-info"><span>${escapeHtml(label)}</span><span class="count-on-us-widget__tooltip"><button type="button" class="count-on-us-widget__tooltip-trigger" aria-describedby="${tooltipId}" aria-label="Learn more about ${escapeHtml(label)}">?</button><span class="count-on-us-widget__tooltip-bubble" id="${tooltipId}" role="tooltip">${escapeHtml(explanation)}</span></span></span>`;
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
  const setContainerVisibility = (container, visible) => {
    if (container.dataset.countOnUsDesignMode === "true") {
      container.hidden = false;
      container.removeAttribute("hidden");
      container.style.removeProperty("display");
      return;
    }

    if (visible) {
      container.hidden = false;
      container.removeAttribute("hidden");
      container.style.removeProperty("display");
      return;
    }

    container.hidden = true;
    container.setAttribute("hidden", "");
    container.style.display = "none";
  };
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
    const estimatedTotal = money(variant.reconciliation?.estimatedTotal || variant.price) * nextQuantity;
    const labor = money(variant.reconciliation?.labor || variant.laborCost) * nextQuantity;
    const materials = money(variant.reconciliation?.materials) * nextQuantity;
    const equipment = money(variant.reconciliation?.equipment) * nextQuantity;
    const packaging = money(variant.reconciliation?.packaging);
    const pod = money(variant.reconciliation?.pod || variant.podCostTotal) * nextQuantity;
    const mistakeBuffer = money(variant.reconciliation?.mistakeBuffer || variant.mistakeBufferAmount) * nextQuantity;
    const processingRate = money(variant.shopifyFees?.processingRate) / 100;
    const managedMarketsRate = variant.shopifyFees?.managedMarketsApplicable ? money(variant.shopifyFees?.managedMarketsRate) / 100 : 0;
    const processingFlatFee = money(variant.shopifyFees?.processingFlatFee);
    const shopifyFees = estimatedTotal * (processingRate + managedMarketsRate) + processingFlatFee;
    const taxReserve = money(variant.taxReserve?.estimatedAmount) * nextQuantity;
    const allocatedDonations = variant.causes.reduce(
      (sum, cause) => sum + money(cause.estimatedDonationAmount) * nextQuantity,
      0,
    );
    const retainedByShop = Math.max(
      0,
      estimatedTotal - (allocatedDonations + labor + materials + equipment + packaging + pod + mistakeBuffer + shopifyFees + taxReserve),
    );
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
      reconciliation: {
        estimatedTotal: estimatedTotal.toFixed(2),
        allocatedDonations: allocatedDonations.toFixed(2),
        retainedByShop: retainedByShop.toFixed(2),
        labor: labor.toFixed(2),
        materials: materials.toFixed(2),
        equipment: equipment.toFixed(2),
        packaging: packaging.toFixed(2),
        pod: pod.toFixed(2),
        mistakeBuffer: mistakeBuffer.toFixed(2),
        shopifyFees: shopifyFees.toFixed(2),
        taxReserve: taxReserve.toFixed(2),
        remainder: "0.00",
      },
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
  const section = (title, body) => `<section class="count-on-us-widget__section"><h4 class="count-on-us-widget__section-title">${escapeHtml(title)}</h4>${body}</section>`;
  const buildReconciliationRows = (reconciliation) =>
    [
      { label: "Labor", key: "labor", value: money(reconciliation.labor), estimated: false },
      { label: "Materials", key: "materials", value: money(reconciliation.materials), estimated: false },
      { label: "Equipment", key: "equipment", value: money(reconciliation.equipment), estimated: false },
      { label: "Packaging", key: "packaging", value: money(reconciliation.packaging), estimated: true },
      { label: "POD", key: "pod", value: money(reconciliation.pod), estimated: false },
      { label: "Mistake buffer", key: "mistakeBuffer", value: money(reconciliation.mistakeBuffer), estimated: false },
      { label: "Shopify fees", key: "fees", value: money(reconciliation.shopifyFees), estimated: true },
      { label: "Tax reserve", key: "taxReserve", value: money(reconciliation.taxReserve), estimated: true },
    ]
      .filter((row) => Math.abs(row.value) >= 0.01)
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
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
              return `<article class="count-on-us-widget__cause"><div class="count-on-us-widget__cause-line">${donationLink ? `<a href="${donationLink}" target="_blank" rel="noreferrer" class="count-on-us-widget__cause-link"><strong>${escapeHtml(cause.name)}</strong><span class="count-on-us-widget__cause-link-text">Learn more</span></a>` : `<strong>${escapeHtml(cause.name)}</strong>`}<strong>${formatMoney(money(cause.estimatedDonationAmount), cause.donationCurrencyCode)}</strong></div><div class="count-on-us-widget__cause-line"><span class="count-on-us-widget__subdued">Estimated for this product</span></div></article>`;
            })
            .join("")}</div>`,
        )
      : "";
    const reconciliationRows = buildReconciliationRows(scaled.reconciliation);
    const remainderRow =
      Math.abs(money(scaled.reconciliation.remainder)) >= 0.01
        ? `<div class="count-on-us-widget__row"><span>${renderInfoLabel("Unattributed remainder", "remainder")}</span><strong>${formatMoney(money(scaled.reconciliation.remainder), scaled.currencyCode)}</strong></div>`
        : "";
    const waterfallRows = reconciliationRows
      .map(
        (row) =>
          `<div class="count-on-us-widget__row"><span>Less: ${renderInfoLabel(row.label, row.key)}${row.estimated ? ' <em class="count-on-us-widget__estimate-tag">(estimate)</em>' : ""}</span><strong>- ${formatMoney(row.value, scaled.currencyCode)}</strong></div>`,
      )
      .join("");
    const breakdown = section(
      "Estimated reconciliation",
      `<details class="count-on-us-widget__details" data-count-on-us-product-breakdown><summary class="count-on-us-widget__details-summary">See how this estimate is calculated</summary><div class="count-on-us-widget__details-body"><div class="count-on-us-widget__list"><div class="count-on-us-widget__row"><span>${renderInfoLabel("Estimated total", "estimatedTotal")}</span><strong>${formatMoney(money(scaled.reconciliation.estimatedTotal), scaled.currencyCode)}</strong></div>${waterfallRows}<div class="count-on-us-widget__row count-on-us-widget__row--total"><span>${renderInfoLabel("Equals: amount remaining after costs", "estimatedDonationPool")}</span><strong>${formatMoney(money(scaled.reconciliation.allocatedDonations) + money(scaled.reconciliation.retainedByShop), scaled.currencyCode)}</strong></div><div class="count-on-us-widget__row"><span>${renderInfoLabel("Allocated to causes", "allocatedDonations")}</span><strong>${formatMoney(money(scaled.reconciliation.allocatedDonations), scaled.currencyCode)}</strong></div><div class="count-on-us-widget__row"><span>${renderInfoLabel("Retained by shop", "retainedByShop")}</span><strong>${formatMoney(money(scaled.reconciliation.retainedByShop), scaled.currencyCode)}</strong></div>${remainderRow}</div></div></details>`,
    );
    panel.innerHTML = `${causes}${breakdown}`;
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
        setContainerVisibility(container, false);
        container.dataset.widgetInteractive = "true";
        return;
      }
      setContainerVisibility(container, true);
      if (metadata.deliveryMode === "preload") payload = await loadPayload(container);
    } catch (error) {
      console.error("[Count On Us Widget] Failed to load metadata:", error);
      setContainerVisibility(container, false);
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
