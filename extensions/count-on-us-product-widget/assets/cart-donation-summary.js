(function () {
  window.__COUNT_ON_US_CART_SUMMARY_READY__ = false;
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
  const findVariant = (payload, variantId) => payload.variants.find((variant) => variant.variantId === variantId) || payload.variants[0] || null;
  const scaleVariant = (variant, quantity) => ({
    ...variant,
    causes: variant.causes.map((cause) => ({
      ...cause,
      estimatedDonationAmount: (money(cause.estimatedDonationAmount) * Math.max(1, quantity)).toFixed(2),
    })),
  });
  const fetchJson = async (url) => {
    const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Widget request failed with ${response.status}`);
    return response.json();
  };
  const aggregateCartCauseTotals = (lines, payloads) => {
    const payloadMap = new Map(payloads.map((payload) => [payload.productId, payload]));
    const totals = new Map();
    let hasDonationProducts = false;
    lines.forEach((line) => {
      const payload = payloadMap.get(line.productId);
      if (!payload || !payload.visible) return;
      const variant = findVariant(payload, line.variantId);
      if (!variant) return;
      hasDonationProducts = true;
      scaleVariant(variant, line.quantity).causes.forEach((cause) => {
        const current = totals.get(cause.causeId) || {
          causeId: cause.causeId,
          name: cause.name,
          amount: 0,
          donationCurrencyCode: cause.donationCurrencyCode,
          donationLink: cause.donationLink,
        };
        current.amount += money(cause.estimatedDonationAmount);
        totals.set(cause.causeId, current);
      });
    });
    return {
      hasDonationProducts,
      totals: Array.from(totals.values())
        .map((cause) => ({ ...cause, amount: cause.amount.toFixed(2) }))
        .sort((left, right) => money(right.amount) - money(left.amount) || left.name.localeCompare(right.name)),
    };
  };
  const trapFocus = (dialog, event) => {
    if (event.key !== "Tab") return;
    const focusables = dialog.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const parseCartSummaryLines = (container) => {
    const linesScript = container.querySelector("[data-count-on-us-cart-lines]");
    const encodedLines = container.dataset.countOnUsCartLinesJson || "";
    try {
      const rawLines = linesScript?.textContent || (encodedLines ? decodeURIComponent(encodedLines) : "[]");
      return JSON.parse(rawLines || "[]");
    } catch (error) {
      console.error("[Count On Us Cart Summary] Invalid cart lines payload:", error);
      return [];
    }
  };
  function createController(trigger) {
    let modal = null;
    let lastFocusedElement = null;
    const closeModal = () => {
      if (!modal) return;
      modal.remove();
      modal = null;
      trigger.setAttribute("aria-expanded", "false");
      if (lastFocusedElement && typeof lastFocusedElement.focus === "function") lastFocusedElement.focus();
      else trigger.focus();
    };
    const openModal = (content) => {
      if (modal) closeModal();
      lastFocusedElement = document.activeElement;
      modal = document.createElement("div");
      modal.className = "count-on-us-widget__modal-overlay";
      modal.innerHTML = `<div class="count-on-us-widget__modal" role="dialog" aria-modal="true" aria-labelledby="count-on-us-cart-title"><div class="count-on-us-widget__modal-header"><div><h3 id="count-on-us-cart-title" class="count-on-us-widget__heading">Cart donation impact</h3><p class="count-on-us-widget__description">Estimated donation totals across the causes in this cart.</p></div><button type="button" class="count-on-us-widget__modal-close" data-count-on-us-cart-close aria-label="Close donation summary">&times;</button></div><div>${content}</div></div>`;
      modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal();
      });
      modal.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeModal();
          return;
        }
        const dialog = modal.querySelector("[role='dialog']");
        if (dialog) trapFocus(dialog, event);
      });
      document.body.appendChild(modal);
      trigger.setAttribute("aria-expanded", "true");
      const closeButton = modal.querySelector("[data-count-on-us-cart-close]");
      closeButton.addEventListener("click", closeModal);
      closeButton.focus();
    };
    return { openModal };
  }
  const controllers = new WeakMap();
  const getController = (trigger) => {
    let controller = controllers.get(trigger);
    if (!controller) {
      controller = createController(trigger);
      controllers.set(trigger, controller);
    }
    return controller;
  };
  async function handleTrigger(container, trigger) {
    const { openModal } = getController(trigger);
    const lines = parseCartSummaryLines(container);
    if (!lines.length) {
      openModal('<p class="count-on-us-widget__status">No donation products in this cart yet.</p>');
      return;
    }
    openModal('<p class="count-on-us-widget__status">Loading donation summary...</p>');
    try {
      const proxyBase = container.dataset.proxyBase || "/apps/count-on-us";
      const uniqueProducts = Array.from(new Set(lines.map((line) => line.productId)));
      const payloads = await Promise.all(
        uniqueProducts.map(async (productId) => (await fetchJson(`${proxyBase}/products/${encodeURIComponent(productId)}`)).data),
      );
      const summary = aggregateCartCauseTotals(lines, payloads);
      if (!summary.hasDonationProducts || !summary.totals.length) {
        openModal('<p class="count-on-us-widget__status">No donation products in this cart yet.</p>');
        return;
      }
      openModal(`<section class="count-on-us-widget__section"><h4 class="count-on-us-widget__section-title">Causes</h4><div class="count-on-us-widget__list">${summary.totals
        .map((cause) => {
          const donationLink = safeExternalUrl(cause.donationLink);
          return `<article class="count-on-us-widget__cause"><div class="count-on-us-widget__cause-line"><strong>${escapeHtml(cause.name)}</strong><strong>${formatMoney(money(cause.amount), cause.donationCurrencyCode)}</strong></div>${donationLink ? `<div class="count-on-us-widget__cause-line"><span class="count-on-us-widget__subdued">Estimated across your cart</span><a href="${donationLink}" target="_blank" rel="noreferrer" class="count-on-us-widget__subdued">Donate direct</a></div>` : '<div class="count-on-us-widget__cause-line"><span class="count-on-us-widget__subdued">Estimated across your cart</span></div>'}</article>`;
        })
        .join("")}</div></section>`);
    } catch (error) {
      console.error("[Count On Us Cart Summary] Failed to load summary:", error);
      openModal('<p class="count-on-us-widget__status count-on-us-widget__status--error">Donation summary unavailable right now.</p>');
    }
  }
  document.addEventListener("click", (event) => {
    const trigger = event.target instanceof Element ? event.target.closest("[data-count-on-us-cart-trigger]") : null;
    if (!(trigger instanceof HTMLElement)) return;
    const container = trigger.closest("[data-count-on-us-cart-summary]");
    if (!(container instanceof HTMLElement)) return;
    event.preventDefault();
    void handleTrigger(container, trigger);
  });
  window.__COUNT_ON_US_CART_SUMMARY_READY__ = true;
})();
