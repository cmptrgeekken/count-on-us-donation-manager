(function () {
  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const truncate = (value, maxLength) => {
    const text = String(value ?? "").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(1, maxLength - 1)).trim()}...`;
  };

  const readProducts = () => {
    const script = document.querySelector("[data-count-on-us-overlay-products]");
    if (!(script instanceof HTMLScriptElement)) return [];
    try {
      const parsed = JSON.parse(script.textContent || "{}");
      return Array.isArray(parsed.products) ? parsed.products : [];
    } catch {
      return [];
    }
  };

  const handleFromUrl = (href) => {
    try {
      const url = new URL(href, window.location.origin);
      const match = url.pathname.match(/\/products\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : "";
    } catch {
      return "";
    }
  };

  const readProductHandlesFromDom = () => {
    const handles = [];
    const seen = new Set();
    document.querySelectorAll('a[href*="/products/"]').forEach((link) => {
      if (!(link instanceof HTMLAnchorElement)) return;
      const handle = handleFromUrl(link.href);
      if (!handle || seen.has(handle)) return;
      seen.add(handle);
      handles.push(handle);
    });
    return handles.slice(0, 100);
  };

  const fetchJson = async (url) => {
    const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Overlay request failed with ${response.status}`);
    return response.json();
  };

  const cardForHandle = (handle) => {
    const links = Array.from(document.querySelectorAll('a[href*="/products/"]')).filter((link) => {
      if (!(link instanceof HTMLAnchorElement)) return false;
      const linkHandle = handleFromUrl(link.href);
      return linkHandle === handle || linkHandle.startsWith(`${handle}-`) || handle.startsWith(`${linkHandle}-`);
    });
    for (const link of links) {
      const card = link.closest(".card-wrapper, .card, .product-card, li, article, [data-product-card]");
      if (card instanceof HTMLElement) return card;
    }
    return null;
  };

  const imageAreaForCard = (card) => {
    const image = card.querySelector("img");
    const candidate = image?.closest("a, .card__media, .media, .product-card__image, .card__inner");
    return candidate instanceof HTMLElement ? candidate : card;
  };

  const productPageImageAreas = () => {
    const selectorGroups = [
      ".product__media",
      ".product-media-container",
      ".product__media-item",
      "media-gallery .media",
      "media-gallery",
      "[data-media-id]",
    ];
    for (const selector of selectorGroups) {
      const areas = [];
      const seen = new Set();
      document.querySelectorAll(selector).forEach((element) => {
        if (!(element instanceof HTMLElement) || seen.has(element)) return;
        if (!element.querySelector("img")) return;
        seen.add(element);
        areas.push(element);
      });
      if (areas.length) return areas;
    }

    const productImages = Array.from(document.querySelectorAll("main img, .shopify-section img")).filter((image) => {
      if (!(image instanceof HTMLImageElement)) return false;
      const rect = image.getBoundingClientRect();
      return rect.width >= 240 && rect.height >= 240;
    });
    const fallbackArea = productImages[0]?.closest(".media, div, figure");
    return fallbackArea instanceof HTMLElement ? [fallbackArea] : [];
  };

  const renderBadge = (artists, maxLength) => {
    const first = artists[0];
    if (!first) return "";
    const more = artists.length > 1 ? `<span class="count-on-us-artist-overlay__more">+ ${artists.length - 1} more</span>` : "";
    return `<span>${escapeHtml(truncate(first, maxLength))}</span>${more}`;
  };

  const findProductRecordForPayload = (products, payloadProduct) => {
    const matchedProduct = products.find((product) => {
      if (product.id && payloadProduct.productId && product.id === payloadProduct.productId) return true;
      if (!product.handle || !payloadProduct.handle) return false;
      return (
        product.handle === payloadProduct.handle ||
        product.handle.startsWith(`${payloadProduct.handle}-`) ||
        payloadProduct.handle.startsWith(`${product.handle}-`)
      );
    });
    const currentProduct = products.find((product) => product.current && product.id === payloadProduct.productId);
    return matchedProduct || currentProduct || { id: payloadProduct.productId || "", handle: payloadProduct.handle || "" };
  };

  const injectBadgeIntoArea = ({ imageArea, artists, position, maxLength }) => {
    if (!artists.length || imageArea.querySelector("[data-count-on-us-artist-overlay-badge]")) return false;
    imageArea.classList.add("count-on-us-artist-overlay__anchor");
    const badge = document.createElement("span");
    badge.className = `count-on-us-artist-overlay count-on-us-artist-overlay--${position}`;
    badge.dataset.countOnUsArtistOverlayBadge = "true";
    badge.innerHTML = renderBadge(artists, Number.isFinite(maxLength) ? maxLength : 28);
    imageArea.appendChild(badge);
    return true;
  };

  const injectBadge = ({ product, artists, position, maxLength }) => {
    if (!artists.length || !product.handle) return false;

    if (product.current) {
      let inserted = false;
      for (const imageArea of productPageImageAreas()) {
        inserted = injectBadgeIntoArea({ imageArea, artists, position, maxLength }) || inserted;
      }
      if (inserted) return true;
    }

    const card = cardForHandle(product.handle);
    if (!card) return false;
    return injectBadgeIntoArea({ imageArea: imageAreaForCard(card), artists, position, maxLength });
  };

  const hydrate = async () => {
    const config = document.querySelector("[data-count-on-us-artist-overlay-config]");
    if (!(config instanceof HTMLElement) || config.dataset.enabled !== "true") return;
    if (config.dataset.hideMobile === "true" && window.matchMedia("(max-width: 749px)").matches) return;

    const liquidProducts = readProducts();
    const domHandles = readProductHandlesFromDom();
    const productByHandle = new Map(liquidProducts.map((product) => [product.handle, product]));
    for (const handle of domHandles) {
      if (!productByHandle.has(handle)) {
        productByHandle.set(handle, { handle, id: "" });
      }
    }
    const products = Array.from(productByHandle.values());
    if (!products.length) return;
    const ids = products.map((product) => product.id).filter(Boolean);
    const handles = products.map((product) => product.handle).filter(Boolean);
    if (!ids.length && !handles.length) return;

    const proxyBase = config.dataset.proxyBase || "/apps/count-on-us";
    let payload;
    try {
      const params = new URLSearchParams();
      if (ids.length) params.set("products", ids.join(","));
      if (handles.length) params.set("handles", handles.join(","));
      payload = await fetchJson(`${proxyBase}/artist-overlays?${params.toString()}`);
    } catch {
      return;
    }

    const byId = new Map((payload.products || []).map((product) => [product.productId, product.artists || []]));
    const byHandle = new Map((payload.products || []).map((product) => [product.handle, product.artists || []]));
    const maxLength = Number.parseInt(config.dataset.maxLabelLength || "28", 10);
    const position = config.dataset.position || "top-left";
    const injectedHandles = new Set();

    for (const product of products) {
      const artists = byId.get(product.id) || byHandle.get(product.handle) || [];
      if (injectBadge({ product, artists, position, maxLength })) {
        injectedHandles.add(product.handle);
      }
    }

    for (const payloadProduct of payload.products || []) {
      const product = findProductRecordForPayload(products, payloadProduct);
      if (injectedHandles.has(product.handle)) continue;
      injectBadge({ product, artists: payloadProduct.artists || [], position, maxLength });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate, { once: true });
  } else {
    void hydrate();
  }
})();
