(function () {
  window.__COUNT_ON_US_CART_SUMMARY_READY__ = false;

  const money = (value) => {
    const parsed = Number.parseFloat(String(value ?? "0"));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const roundCurrency = (value) => Math.round((money(value) + Number.EPSILON) * 100) / 100;

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
      "This is the current estimated total for the items in your cart before Count On Us subtracts the costs and reserves that need to be covered first.",
    labor:
      "This portion helps cover the time required to make, prepare, or fulfill these items before any donation amount is estimated.",
    materials:
      "This portion helps cover the raw materials used to make the items in your cart before any donation amount is estimated.",
    equipment:
      "This portion helps cover equipment usage and wear involved in producing the items in your cart before any donation amount is estimated.",
    packaging:
      "This estimate helps cover packaging and shipping materials, which need to be paid before the remaining amount can be donated.",
    pod: "This portion helps cover any print-on-demand production cost tied to the items in your cart before any donation amount is estimated.",
    mistakeBuffer:
      "This portion sets aside a small buffer for remakes, spoilage, or similar production issues so those costs do not come out of the donation estimate later.",
    fees:
      "This estimate helps cover payment processing fees charged on the order. The exact amount can vary depending on how the purchase is completed.",
    taxReserve:
      "This estimate sets aside money for taxes that may be owed on the sale, so that amount is not counted as part of the donation estimate.",
    estimatedDonationPool:
      "This is the amount left after estimated costs, fees, and reserves are subtracted from the total. That remainder is then split between the causes and any portion the shop keeps.",
    allocatedDonations:
      "This is the portion of the remaining amount that is currently assigned to the causes connected to these items.",
    retainedByShop:
      "This is any remaining portion that stays with the shop instead of being assigned to a cause. When the items are set to donate 100%, this should be zero.",
    remainder:
      "This shows any small leftover difference between the total and the displayed estimate buckets. It should usually be zero.",
  };

  const renderInfoLabel = (label, explanationKey) => {
    const explanation = RECONCILIATION_EXPLANATIONS[explanationKey];
    if (!explanation) return escapeHtml(label);

    const tooltipId = `count-on-us-tooltip-${slugify(explanationKey)}-${slugify(label)}`;
    return `<span class="count-on-us-widget__label-with-info"><span>${escapeHtml(label)}</span><span class="count-on-us-widget__tooltip"><button type="button" class="count-on-us-widget__tooltip-trigger" aria-describedby="${tooltipId}" aria-label="Learn more about ${escapeHtml(label)}">?</button><span class="count-on-us-widget__tooltip-bubble" id="${tooltipId}" role="tooltip">${escapeHtml(explanation)}</span></span></span>`;
  };

  const fetchJson = async (url) => {
    const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Widget request failed with ${response.status}`);
    return response.json();
  };

  const toProductGid = (value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) return "";
    return normalized.startsWith("gid://shopify/Product/") ? normalized : `gid://shopify/Product/${normalized}`;
  };

  const toVariantGid = (value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) return "";
    return normalized.startsWith("gid://shopify/ProductVariant/")
      ? normalized
      : `gid://shopify/ProductVariant/${normalized}`;
  };

  const CART_LINE_CONTAINER_SELECTORS = [
    ".cart-item",
    '[class*="cart-item"]',
    ".cart__item",
    '[class*="cart__item"]',
    ".cart-drawer__item",
    ".drawer__item",
    '[class*="line-item"]',
    "[data-cart-item]",
    "[data-cart-line]",
    "tr",
    "li",
  ];
  const CART_LINE_DETAILS_SELECTORS = [
    ".cart-item__details",
    ".cart-item__content",
    ".cart-item__info",
    ".cart__item-details",
    ".cart__item-info",
    ".line-item__details",
    ".line-item__content",
    ".line-item__info",
    '[class*="details"]',
    '[class*="content"]',
    '[class*="info"]',
    '[class*="description"]',
    "td:nth-child(2)",
  ];
  const CART_LINE_TITLE_SELECTORS = [
    ".cart-item__name",
    ".cart-item__title",
    ".cart__item-title",
    ".line-item__title",
    '[class*="product-title"]',
    '[class*="item-title"]',
    '[class*="cart-item__name"]',
    '[class*="cart-item__title"]',
    '[class*="cart__item-title"]',
    '[class*="line-item__title"]',
    "a[href*=\"/products/\"]",
    "h1, h2, h3, h4, h5, h6",
  ];

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

  const buildCauseSupportLabel = (variant) => {
    if (!variant || !Array.isArray(variant.causes) || !variant.causes.length) return "";
    return variant.causes
      .map((cause) => `${money(cause.donationPercentage).toFixed(0)}% to ${cause.name}`)
      .join("\n");
  };

  const buildCompactCauseSupportLabel = (variant) => {
    if (!variant || !Array.isArray(variant.causes) || !variant.causes.length) return "";
    return "Donations apply";
  };

  const getCartSearchRoot = (container) => {
    if (container instanceof HTMLElement) {
      const formRoot = container.closest('form[action*="/cart"]');
      if (formRoot instanceof HTMLElement) return formRoot;
    }

    const documentRoot = document.querySelector('form[action*="/cart"]');
    if (documentRoot instanceof HTMLElement) return documentRoot;
    return document;
  };

  const hasCartLineSignals = (container) => {
    if (!(container instanceof HTMLElement)) return false;

    const hasProductIdentity = Boolean(
      container.querySelector(
        [
          'a[href*="/products/"]',
          ".cart-item__name",
          ".cart-item__title",
          ".cart__item-title",
          ".line-item__title",
          '[class*="product-title"]',
          '[class*="item-title"]',
        ].join(", "),
      ),
    );
    const hasCartControls = Boolean(
      container.querySelector(
        [
          'input[name="updates[]"]',
          'input[name^="updates"]',
          'select[name="updates[]"]',
          'select[name^="updates"]',
          'button[name="plus"]',
          'button[name="minus"]',
          '[data-quantity-button]',
          '[data-qty-button]',
          'button[aria-label*="remove" i]',
          '[data-cart-remove]',
          'a[href*="/cart/change"]',
          "cart-remove-button",
          "quantity-popover",
        ].join(", "),
      ),
    );

    return hasProductIdentity && hasCartControls;
  };

  const findCartLineContainers = (container) => {
    const searchRoot = getCartSearchRoot(container);
    const quantityControls = Array.from(
      searchRoot.querySelectorAll(
        [
          'input[name="updates[]"]',
          'input[name^="updates"]',
          'select[name="updates[]"]',
          'select[name^="updates"]',
          'button[name="plus"]',
          'button[name="minus"]',
          '[data-quantity-button]',
          '[data-qty-button]',
          'button[aria-label*="remove" i]',
          '[data-cart-remove]',
          'a[href*="/cart/change"]',
          "cart-remove-button",
          "quantity-popover",
        ].join(", "),
      ),
    );
    const matched = quantityControls
      .map((control) => {
        if (!(control instanceof HTMLElement)) return null;
        return control.closest(CART_LINE_CONTAINER_SELECTORS.join(", "));
      })
      .filter(
        (lineContainer, index, array) =>
          lineContainer instanceof HTMLElement &&
          hasCartLineSignals(lineContainer) &&
          array.indexOf(lineContainer) === index,
      );

    if (matched.length) return matched;

    return Array.from(searchRoot.querySelectorAll(CART_LINE_CONTAINER_SELECTORS.join(", ")))
      .filter((lineContainer) => lineContainer instanceof HTMLElement)
      .filter((lineContainer) => hasCartLineSignals(lineContainer))
      .filter((lineContainer, index, array) => array.indexOf(lineContainer) === index);
  };

  const findAnnotationTarget = (container) => {
    if (!(container instanceof HTMLElement)) return null;
    const title = container.querySelector(CART_LINE_TITLE_SELECTORS.join(", "));
    if (title instanceof HTMLElement) {
      return title;
    }

    const preferred = container.querySelector(CART_LINE_DETAILS_SELECTORS.join(", "));
    if (preferred instanceof HTMLElement) return preferred;

    const textBlocks = Array.from(container.querySelectorAll("p, div, dd, td, span"))
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => node.textContent && node.textContent.trim().length > 0);
    return textBlocks[0] || container;
  };

  let ignoreAnnotationMutationsUntil = 0;

  const annotateCartLines = (entries, container) => {
    const containers = findCartLineContainers(container);
    if (!containers.length) return;

    ignoreAnnotationMutationsUntil = Date.now() + 250;
    containers.forEach((cartLineContainer) => {
      if (!(cartLineContainer instanceof HTMLElement)) return;
      cartLineContainer.querySelectorAll("[data-count-on-us-cart-annotation]").forEach((annotation) => annotation.remove());
    });

    entries.forEach(({ payload }, index) => {
      const cartLineContainer = containers[index];
      if (!(cartLineContainer instanceof HTMLElement) || !payload) return;
      const variant = payload.variants[0] || null;
      if (!variant || !variant.causes.length) return;

      const supportLabel = buildCauseSupportLabel(variant);
      if (!supportLabel) return;
      const target = findAnnotationTarget(cartLineContainer);
      if (!(target instanceof HTMLElement)) return;

      const annotation = document.createElement("p");
      annotation.className = "count-on-us-widget__cart-annotation";
      annotation.dataset.countOnUsCartAnnotation = "true";
      const compactLabel = buildCompactCauseSupportLabel(variant);
      const tooltipId = `count-on-us-cart-annotation-${index}`;
      annotation.innerHTML = `<span class="count-on-us-widget__tooltip count-on-us-widget__cart-annotation-tooltip"><button type="button" class="count-on-us-widget__cart-annotation-trigger" aria-describedby="${tooltipId}" aria-label="Show supported causes">${escapeHtml(compactLabel)}</button><span class="count-on-us-widget__tooltip-bubble" id="${tooltipId}" role="tooltip">${escapeHtml(supportLabel)}</span></span>`;

      if (target.matches(CART_LINE_TITLE_SELECTORS.join(", "))) {
        target.insertAdjacentElement("afterend", annotation);
      } else {
        target.appendChild(annotation);
      }
    });
    ignoreAnnotationMutationsUntil = Date.now() + 250;
  };

  const mutationIsCartRelevant = (mutations) =>
    mutations.some((mutation) => {
      if (Date.now() < ignoreAnnotationMutationsUntil) return false;
      if (!(mutation.target instanceof Element)) return false;
      if (
        mutation.target.closest("[data-count-on-us-cart-summary]") ||
        mutation.target.closest("[data-count-on-us-cart-annotation]") ||
        mutation.target.closest(".count-on-us-widget__tooltip-bubble")
      ) {
        return false;
      }

      return isCartRelevantTarget(mutation.target) ||
        Array.from(mutation.addedNodes).some((node) => node instanceof Element && isCartRelevantTarget(node)) ||
        Array.from(mutation.removedNodes).some((node) => node instanceof Element && isCartRelevantTarget(node));
    });

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

  const loadCurrentCartLines = async (container) => {
    try {
      const cart = await fetchJson("/cart.js");
      if (!cart || !Array.isArray(cart.items)) {
        return parseCartSummaryLines(container);
      }

      return cart.items
        .map((item) => ({
          productId: toProductGid(item.product_id),
          variantId: toVariantGid(item.variant_id),
          quantity: Math.max(1, Number.parseInt(String(item.quantity || "1"), 10) || 1),
          lineSubtotal:
            typeof item.final_line_price === "number"
              ? roundCurrency(item.final_line_price / 100)
              : typeof item.line_price === "number"
                ? roundCurrency(item.line_price / 100)
                : undefined,
        }))
        .filter((line) => line.productId && line.variantId);
    } catch (error) {
      console.error("[Count On Us Cart Summary] Failed to read /cart.js, falling back to embedded lines:", error);
      return parseCartSummaryLines(container);
    }
  };

  const loadEntriesForLines = async (container, lines) => {
    const proxyBase = container.dataset.proxyBase || "/apps/count-on-us";
    return Promise.all(
      lines.map(async (line) => {
        const productId = String(line.productId || "");
        if (!productId) {
          return { line, payload: null };
        }

        const params = new URLSearchParams({
          variantId: String(line.variantId || ""),
          quantity: String(Math.max(1, Number.parseInt(String(line.quantity || "1"), 10) || 1)),
        });
        if (line.lineSubtotal != null && line.lineSubtotal !== "") {
          params.set("lineSubtotal", String(line.lineSubtotal));
        }
        const payload = (await fetchJson(`${proxyBase}/products/${encodeURIComponent(productId)}?${params.toString()}`)).data;
        return { line, payload };
      }),
    );
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
      modal.innerHTML = `<div class="count-on-us-widget__modal" role="dialog" aria-modal="true" aria-labelledby="count-on-us-cart-title"><div class="count-on-us-widget__modal-header"><div><h3 id="count-on-us-cart-title" class="count-on-us-widget__heading">Cart donation impact</h3><p class="count-on-us-widget__description">Estimated donation totals across the causes in this cart.</p></div><button type="button" class="count-on-us-widget__modal-close" data-count-on-us-cart-close aria-label="Close donation summary">&times;</button></div><div class="count-on-us-widget__modal-body">${content}</div></div>`;
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
  const refreshState = new WeakMap();
  const buildCartSignature = (lines) =>
    lines
      .map((line) =>
        [line.productId || "", line.variantId || "", Math.max(1, Number.parseInt(String(line.quantity || "1"), 10) || 1), roundCurrency(line.lineSubtotal || 0)].join(":"),
      )
      .join("|");

  const getCachedEntriesForLines = (container, lines) => {
    const state = refreshState.get(container) || {};
    const signature = buildCartSignature(lines);
    if (state.lastSignature === signature && Array.isArray(state.lastEntries)) {
      return { signature, entries: state.lastEntries, hasCachedEntries: true };
    }

    return { signature, entries: null, hasCachedEntries: false };
  };

  const isCartRelevantTarget = (target) => {
    if (!(target instanceof Element)) return false;

    return Boolean(
      target.closest(
        [
          '[name="updates[]"]',
          '[name^="updates"]',
          "[data-cart-item]",
          "[data-cart-line]",
          ".cart-item",
          '[class*="cart-item"]',
          ".cart__item",
          '[class*="cart__item"]',
          ".cart-drawer__item",
          ".drawer__item",
          'form[action*="/cart"]',
          'button[name="add"]',
          '[name="plus"]',
          '[name="minus"]',
          '[data-quantity-button]',
          '[data-qty-button]',
          '[href*="/cart"]',
        ].join(", "),
      ),
    );
  };

  const getController = (trigger) => {
    let controller = controllers.get(trigger);
    if (!controller) {
      controller = createController(trigger);
      controllers.set(trigger, controller);
    }
    return controller;
  };

  const refreshContainer = async (container) => {
    const currentState = refreshState.get(container) || {};
    if (currentState.inFlight) {
      refreshState.set(container, { ...currentState, pending: true });
      return;
    }

    refreshState.set(container, { ...currentState, inFlight: true, pending: false });
    try {
      const lines = await loadCurrentCartLines(container);
      if (!lines.length) {
        annotateCartLines([], container);
        setContainerVisibility(container, false);
        refreshState.set(container, {
          ...refreshState.get(container),
          lastSignature: "",
          lastEntries: [],
          lastHasDonationProducts: false,
        });
        return;
      }

      const { signature, entries: cachedEntries, hasCachedEntries } = getCachedEntriesForLines(container, lines);
      const entries = hasCachedEntries ? cachedEntries : await loadEntriesForLines(container, lines);
      const hasDonationProducts = entries.some(({ payload }) => {
        const variant = payload?.variants?.[0];
        return Boolean(payload?.visible || (variant && variant.causes && variant.causes.length > 0));
      });

      refreshState.set(container, {
        ...refreshState.get(container),
        lastSignature: signature,
        lastEntries: entries,
        lastHasDonationProducts: hasDonationProducts,
      });
      annotateCartLines(entries, container);
      setContainerVisibility(container, hasDonationProducts);
    } catch (error) {
      console.error("[Count On Us Cart Summary] Failed to refresh widget state:", error);
      setContainerVisibility(container, true);
    } finally {
      const nextState = refreshState.get(container) || {};
      if (nextState.pending) {
        refreshState.set(container, { ...nextState, inFlight: false, pending: false });
        window.setTimeout(() => {
          void refreshContainer(container);
        }, 120);
      } else {
        refreshState.set(container, { ...nextState, inFlight: false, pending: false });
      }
    }
  };

  const scheduleRefresh = (container, delay = 180) => {
    const state = refreshState.get(container) || {};
    if (state.timer) {
      window.clearTimeout(state.timer);
    }
    const timer = window.setTimeout(() => {
      const latest = refreshState.get(container) || {};
      refreshState.set(container, { ...latest, timer: null });
      void refreshContainer(container);
    }, delay);
    refreshState.set(container, { ...state, timer });
  };

  const aggregateCartCauseTotals = (entries) => {
    const totals = new Map();
    const costBreakdown = {
      estimatedTotal: 0,
      allocatedDonations: 0,
      retainedByShop: 0,
      labor: 0,
      materials: 0,
      equipment: 0,
      packaging: 0,
      pod: 0,
      mistakeBuffer: 0,
      fees: 0,
      taxReserve: 0,
    };
    let hasDonationProducts = false;

    entries.forEach(({ payload }) => {
      if (!payload) return;
      const variant = payload.variants[0] || null;
      if (!variant) return;
      if (variant.causes.length > 0) {
        hasDonationProducts = true;
      }

      costBreakdown.estimatedTotal = roundCurrency(costBreakdown.estimatedTotal + money(variant.reconciliation?.estimatedTotal));
      costBreakdown.allocatedDonations = roundCurrency(
        costBreakdown.allocatedDonations + money(variant.reconciliation?.allocatedDonations),
      );
      costBreakdown.retainedByShop = roundCurrency(
        costBreakdown.retainedByShop + money(variant.reconciliation?.retainedByShop),
      );
      costBreakdown.labor = roundCurrency(costBreakdown.labor + money(variant.reconciliation?.labor));
      costBreakdown.materials = roundCurrency(costBreakdown.materials + money(variant.reconciliation?.materials));
      costBreakdown.equipment = roundCurrency(costBreakdown.equipment + money(variant.reconciliation?.equipment));
      costBreakdown.packaging = roundCurrency(costBreakdown.packaging + money(variant.reconciliation?.packaging));
      costBreakdown.pod = roundCurrency(costBreakdown.pod + money(variant.reconciliation?.pod));
      costBreakdown.mistakeBuffer = roundCurrency(
        costBreakdown.mistakeBuffer + money(variant.reconciliation?.mistakeBuffer),
      );
      costBreakdown.fees = roundCurrency(costBreakdown.fees + money(variant.reconciliation?.shopifyFees));
      costBreakdown.taxReserve = roundCurrency(costBreakdown.taxReserve + money(variant.reconciliation?.taxReserve));

      variant.causes.forEach((cause) => {
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

    const attributedTotal = roundCurrency(
      costBreakdown.allocatedDonations +
        costBreakdown.retainedByShop +
        costBreakdown.labor +
        costBreakdown.materials +
        costBreakdown.equipment +
        costBreakdown.packaging +
        costBreakdown.pod +
        costBreakdown.mistakeBuffer +
        costBreakdown.fees +
        costBreakdown.taxReserve,
    );

    const remainder = roundCurrency(costBreakdown.estimatedTotal - attributedTotal);

    return {
      hasDonationProducts,
      totals: Array.from(totals.values())
        .map((cause) => ({ ...cause, amount: cause.amount.toFixed(2) }))
        .sort((left, right) => money(right.amount) - money(left.amount) || left.name.localeCompare(right.name)),
      costBreakdown: {
        ...Object.fromEntries(Object.entries(costBreakdown).map(([key, value]) => [key, value.toFixed(2)])),
        attributedTotal: attributedTotal.toFixed(2),
        remainder: remainder.toFixed(2),
      },
    };
  };

  const buildReconciliationRows = (costBreakdown) =>
    [
      { label: "Labor", key: "labor", value: money(costBreakdown.labor), estimated: false },
      { label: "Materials", key: "materials", value: money(costBreakdown.materials), estimated: false },
      { label: "Equipment", key: "equipment", value: money(costBreakdown.equipment), estimated: false },
      { label: "Packaging", key: "packaging", value: money(costBreakdown.packaging), estimated: true },
      { label: "POD", key: "pod", value: money(costBreakdown.pod), estimated: false },
      { label: "Mistake buffer", key: "mistakeBuffer", value: money(costBreakdown.mistakeBuffer), estimated: false },
      { label: "Shopify fees", key: "fees", value: money(costBreakdown.fees), estimated: true },
      { label: "Tax reserve", key: "taxReserve", value: money(costBreakdown.taxReserve), estimated: true },
    ]
      .filter((row) => Math.abs(row.value) >= 0.01)
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));

  async function handleTrigger(container, trigger) {
    const { openModal } = getController(trigger);
    const lines = await loadCurrentCartLines(container);
    if (!lines.length) {
      openModal('<p class="count-on-us-widget__status">No donation products in this cart yet.</p>');
      return;
    }

    openModal('<p class="count-on-us-widget__status">Loading donation summary...</p>');

    try {
      const { signature, entries: cachedEntries, hasCachedEntries } = getCachedEntriesForLines(container, lines);
      const entries = hasCachedEntries ? cachedEntries : await loadEntriesForLines(container, lines);
      if (!hasCachedEntries) {
        const state = refreshState.get(container) || {};
        refreshState.set(container, { ...state, lastSignature: signature, lastEntries: entries });
      }

      const summary = aggregateCartCauseTotals(entries);
      annotateCartLines(entries, container);
      if (!summary.hasDonationProducts || !summary.totals.length) {
        openModal('<p class="count-on-us-widget__status">No donation products in this cart yet.</p>');
        return;
      }

      const currencyCode = entries[0]?.payload?.variants?.[0]?.currencyCode || "USD";
      const reconciliationRows = buildReconciliationRows(summary.costBreakdown);
      const remainderRow =
        Math.abs(money(summary.costBreakdown.remainder)) >= 0.01
          ? `<div class="count-on-us-widget__row"><span>${renderInfoLabel("Unattributed remainder", "remainder")}</span><strong>${formatMoney(money(summary.costBreakdown.remainder), currencyCode)}</strong></div>`
          : "";
      const waterfallRows = reconciliationRows
        .map(
          (row) =>
            `<div class="count-on-us-widget__row"><span>Less: ${renderInfoLabel(row.label, row.key)}${row.estimated ? ' <em class="count-on-us-widget__estimate-tag">(estimate)</em>' : ""}</span><strong>- ${formatMoney(row.value, currencyCode)}</strong></div>`,
        )
        .join("");

      openModal(
        `<section class="count-on-us-widget__section"><h4 class="count-on-us-widget__section-title">Causes</h4><div class="count-on-us-widget__list">${summary.totals
          .map((cause) => {
            const donationLink = safeExternalUrl(cause.donationLink);
            return `<article class="count-on-us-widget__cause"><div class="count-on-us-widget__cause-line">${donationLink ? `<a href="${donationLink}" target="_blank" rel="noreferrer" class="count-on-us-widget__cause-link"><strong>${escapeHtml(cause.name)}</strong><span class="count-on-us-widget__cause-link-text">Learn more</span></a>` : `<strong>${escapeHtml(cause.name)}</strong>`}<strong>${formatMoney(money(cause.amount), cause.donationCurrencyCode)}</strong></div><div class="count-on-us-widget__cause-line"><span class="count-on-us-widget__subdued">Estimated across your cart</span></div></article>`;
          })
          .join("")}</div></section><section class="count-on-us-widget__section"><details class="count-on-us-widget__details" data-count-on-us-cart-breakdown><summary class="count-on-us-widget__details-summary">See how this estimate is calculated</summary><div class="count-on-us-widget__details-body"><h4 class="count-on-us-widget__section-title">Estimated reconciliation</h4><div class="count-on-us-widget__list"><div class="count-on-us-widget__row"><span>${renderInfoLabel("Estimated total", "estimatedTotal")}</span><strong>${formatMoney(money(summary.costBreakdown.estimatedTotal), currencyCode)}</strong></div>${waterfallRows}<div class="count-on-us-widget__row count-on-us-widget__row--total"><span>${renderInfoLabel("Equals: amount remaining after costs", "estimatedDonationPool")}</span><strong>${formatMoney(money(summary.costBreakdown.allocatedDonations) + money(summary.costBreakdown.retainedByShop), currencyCode)}</strong></div><div class="count-on-us-widget__row"><span>${renderInfoLabel("Allocated to causes", "allocatedDonations")}</span><strong>${formatMoney(money(summary.costBreakdown.allocatedDonations), currencyCode)}</strong></div><div class="count-on-us-widget__row"><span>${renderInfoLabel("Retained by shop", "retainedByShop")}</span><strong>${formatMoney(money(summary.costBreakdown.retainedByShop), currencyCode)}</strong></div>${remainderRow}</div></div></details></section>`,
      );
    } catch (error) {
      console.error("[Count On Us Cart Summary] Failed to load summary:", error);
      openModal('<p class="count-on-us-widget__status count-on-us-widget__status--error">Donation summary unavailable right now.</p>');
    }
  }

  async function initializeContainer(container) {
    if (container.dataset.countOnUsCartInitialized === "true") return;
    container.dataset.countOnUsCartInitialized = "true";

    await refreshContainer(container);

    const handleDocumentEvent = (event) => {
      if (!isCartRelevantTarget(event.target)) return;
      scheduleRefresh(container);
    };
    document.addEventListener("change", handleDocumentEvent);
    document.addEventListener("input", handleDocumentEvent);
    document.addEventListener("click", handleDocumentEvent);

    const observer = new MutationObserver((mutations) => {
      if (!mutationIsCartRelevant(mutations)) return;
      scheduleRefresh(container);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target instanceof Element ? event.target.closest("[data-count-on-us-cart-trigger]") : null;
    if (!(trigger instanceof HTMLElement)) return;
    const container = trigger.closest("[data-count-on-us-cart-summary]");
    if (!(container instanceof HTMLElement)) return;
    event.preventDefault();
    void handleTrigger(container, trigger);
  });

  const initializeAllContainers = () =>
    Promise.all(
      Array.from(document.querySelectorAll("[data-count-on-us-cart-summary]")).map((element) =>
        initializeContainer(element),
      ),
    ).finally(() => {
      window.__COUNT_ON_US_CART_SUMMARY_READY__ = true;
    });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void initializeAllContainers();
    });
  } else {
    void initializeAllContainers();
  }
})();
