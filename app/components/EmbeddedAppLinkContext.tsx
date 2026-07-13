import { useEffect, useRef } from "react";
import { useLocation } from "@remix-run/react";

import {
  getShopifyAdminAppBaseUrl,
  getShopifyAdminAppBaseUrlFromContext,
  toShopifyAdminAppHref,
  withEmbeddedAppContext,
} from "../utils/embedded-app-links";

const ORIGINAL_HREF_ATTRIBUTE = "data-count-on-us-original-href";

function restoreAnchor(anchor: HTMLAnchorElement): void {
  const originalHref = anchor.getAttribute(ORIGINAL_HREF_ATTRIBUTE);
  if (!originalHref) return;

  anchor.setAttribute("href", originalHref);
  anchor.removeAttribute(ORIGINAL_HREF_ATTRIBUTE);
}

function patchAnchor(
  anchor: HTMLAnchorElement,
  currentSearch: string,
  origin: string,
  adminAppBaseUrl: string | null,
): void {
  const href = anchor.getAttribute("href");
  if (!href) return;

  const originalHref = anchor.getAttribute(ORIGINAL_HREF_ATTRIBUTE) ?? href;
  const contextHref = withEmbeddedAppContext(originalHref, currentSearch, origin);
  const nextHref = toShopifyAdminAppHref(contextHref, currentSearch, origin, adminAppBaseUrl);
  if (nextHref !== href) {
    anchor.setAttribute(ORIGINAL_HREF_ATTRIBUTE, originalHref);
    anchor.setAttribute("href", nextHref);
  }
}

function patchAnchorContext(anchor: HTMLAnchorElement, currentSearch: string, origin: string): void {
  const href = anchor.getAttribute("href");
  if (!href) return;

  const nextHref = withEmbeddedAppContext(href, currentSearch, origin);
  if (nextHref !== href) {
    anchor.setAttribute("href", nextHref);
  }
}

function patchAnchorContexts(root: ParentNode, currentSearch: string, origin: string): void {
  root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    patchAnchorContext(anchor, currentSearch, origin);
  });
}

function hasEmbeddedAppContext(search: string): boolean {
  const searchParams = new URLSearchParams(search);
  return searchParams.has("shop") && searchParams.has("host");
}

export function EmbeddedAppLinkContext({ apiKey }: { apiKey: string }): null {
  const { search } = useLocation();
  const lastContextSearch = useRef(search);

  useEffect(() => {
    const origin = window.location.origin;
    const contextSearch = hasEmbeddedAppContext(search) ? search : lastContextSearch.current;
    lastContextSearch.current = contextSearch;
    const adminAppBaseUrl =
      getShopifyAdminAppBaseUrlFromContext(contextSearch, apiKey) ?? getShopifyAdminAppBaseUrl(document.referrer);

    const patchNewTabTarget = (event: Event) => {
      if (event.target instanceof Element) {
        const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
        if (anchor) patchAnchor(anchor, contextSearch, origin, adminAppBaseUrl);
      }
    };

    const patchPointerTarget = (event: PointerEvent) => {
      if (event.target instanceof Element) {
        const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
        if (!anchor) return;

        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          restoreAnchor(anchor);
          return;
        }

        patchAnchor(anchor, contextSearch, origin, adminAppBaseUrl);
      }
    };

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLAnchorElement) {
            patchAnchorContext(node, contextSearch, origin);
          } else if (node instanceof Element) {
            patchAnchorContexts(node, contextSearch, origin);
          }
        });
      });
    });

    patchAnchorContexts(document, contextSearch, origin);
    document.addEventListener("contextmenu", patchNewTabTarget, true);
    document.addEventListener("pointerdown", patchPointerTarget, true);
    document.addEventListener("auxclick", patchNewTabTarget, true);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("contextmenu", patchNewTabTarget, true);
      document.removeEventListener("pointerdown", patchPointerTarget, true);
      document.removeEventListener("auxclick", patchNewTabTarget, true);
      observer.disconnect();
    };
  }, [apiKey, search]);

  return null;
}
