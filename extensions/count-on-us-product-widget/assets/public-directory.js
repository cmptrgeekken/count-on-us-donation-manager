(function () {
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
    if (!response.ok) throw new Error(`Directory request failed with ${response.status}`);
    return response.json();
  };

  const linkList = (links) => {
    const visibleLinks = links.filter((link) => link.href);
    if (!visibleLinks.length) return "";
    return `<div class="count-on-us-widget__directory-links">${visibleLinks
      .map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`)
      .join("")}</div>`;
  };

  const productLink = (href, count) => {
    if (!href || count < 1) return "";
    return `<a class="count-on-us-widget__directory-products-link" href="${escapeHtml(href)}">Shop ${escapeHtml(count)} product${count === 1 ? "" : "s"}</a>`;
  };

  const directoryIcon = (iconUrl, altText) => {
    const safeUrl = safeExternalUrl(iconUrl);
    if (!safeUrl) return "";
    return `<img class="count-on-us-widget__directory-icon" src="${escapeHtml(safeUrl)}" alt="${escapeHtml(altText)}">`;
  };

  const renderArtists = (container, payload) => {
    const artists = Array.isArray(payload.artists) ? payload.artists : [];
    if (!artists.length) return '<p class="count-on-us-widget__status">Artists will appear here when they are published.</p>';
    const showLinks = container.dataset.showLinks !== "false";
    const showCauses = container.dataset.showCauses !== "false";

    return `<div class="count-on-us-widget__directory count-on-us-widget__directory--${escapeHtml(container.dataset.layout || "cards")}">${artists
      .map((artist) => {
        const links = showLinks
          ? linkList([
              { label: "Website", href: safeExternalUrl(artist.websiteUrl) },
              { label: "Instagram", href: safeExternalUrl(artist.instagramUrl) },
            ])
          : "";
        const causes = showCauses && Array.isArray(artist.causes) && artist.causes.length
          ? `<div class="count-on-us-widget__directory-causes"><span>Supports</span>${artist.causes
              .map((cause) => `<span class="count-on-us-widget__directory-chip">${escapeHtml(cause.name)}</span>`)
              .join("")}</div>`
          : "";
        const name = artist.creditName || artist.displayName;
        return `<article class="count-on-us-widget__directory-card">${directoryIcon(artist.iconUrl, `${name} icon`)}<div><h3>${escapeHtml(name)}</h3>${artist.publicBio ? `<p>${escapeHtml(artist.publicBio)}</p>` : ""}</div>${causes}${links}${productLink(artist.productsUrl, Number(artist.productCount || 0))}</article>`;
      })
      .join("")}</div>`;
  };

  const renderCauses = (container, payload) => {
    const causes = Array.isArray(payload.causes) ? payload.causes : [];
    if (!causes.length) return '<p class="count-on-us-widget__status">Causes will appear here when they are published.</p>';
    const showLinks = container.dataset.showLinks !== "false";
    const showBadges = container.dataset.showBadges !== "false";

    return `<div class="count-on-us-widget__directory count-on-us-widget__directory--${escapeHtml(container.dataset.layout || "cards")}">${causes
      .map((cause) => {
        const links = showLinks
          ? linkList([
              { label: "Donate", href: safeExternalUrl(cause.donationLink) },
              { label: "Website", href: safeExternalUrl(cause.websiteUrl) },
              { label: "Instagram", href: safeExternalUrl(cause.instagramUrl) },
            ])
          : "";
        const badge = showBadges && cause.is501c3 ? '<span class="count-on-us-widget__directory-chip">501(c)(3)</span>' : "";
        const icon = directoryIcon(cause.iconUrl, `${cause.name} icon`);
        return `<article class="count-on-us-widget__directory-card">${icon}<div><div class="count-on-us-widget__directory-title-row"><h3>${escapeHtml(cause.name)}</h3>${badge}</div>${cause.description ? `<p>${escapeHtml(cause.description)}</p>` : ""}</div>${links}${productLink(cause.productsUrl, Number(cause.productCount || 0))}</article>`;
      })
      .join("")}</div>`;
  };

  const hydrateContainer = async (container, kind) => {
    const panel = container.querySelector("[data-count-on-us-directory-panel]");
    if (!(panel instanceof HTMLElement)) return;
    const proxyBase = container.dataset.proxyBase || "/apps/count-on-us";
    try {
      const payload = await fetchJson(`${proxyBase}/${kind}`);
      panel.innerHTML = kind === "artists" ? renderArtists(container, payload) : renderCauses(container, payload);
    } catch {
      panel.innerHTML = '<p class="count-on-us-widget__status count-on-us-widget__status--error">Directory details are unavailable right now.</p>';
    }
  };

  const hydrateAll = () => {
    document.querySelectorAll("[data-count-on-us-artists-directory]").forEach((container) => {
      if (container instanceof HTMLElement) void hydrateContainer(container, "artists");
    });
    document.querySelectorAll("[data-count-on-us-causes-directory]").forEach((container) => {
      if (container instanceof HTMLElement) void hydrateContainer(container, "causes");
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrateAll, { once: true });
  } else {
    hydrateAll();
  }
})();
