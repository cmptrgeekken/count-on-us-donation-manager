import { useEffect } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigate,
} from "@remix-run/react";

export default function App() {
  const navigate = useNavigate();

  useEffect(() => {
    function handleNavigate(event: Event) {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const href = target.getAttribute("href");
      if (href) {
        navigate(href);
      }
    }

    document.addEventListener("shopify:navigate", handleNavigate);
    return () => document.removeEventListener("shopify:navigate", handleNavigate);
  }, [navigate]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <style>{`
          :root {
            font-family: Inter, -apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: var(--p-color-text, #303030);
            background: var(--p-color-bg, #f6f6f7);
            font-synthesis-weight: none;
            text-rendering: optimizeLegibility;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }

          html,
          body {
            min-height: 100%;
            margin: 0;
            font-family: inherit;
            background: inherit;
            color: inherit;
          }

          body,
          button,
          input,
          textarea,
          select {
            font-family: inherit;
          }

          ui-nav-menu {
            display: none;
          }

          input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),
          textarea,
          select {
            box-sizing: border-box;
            border-radius: 0.75rem;
            border: 1px solid var(--p-color-border, #d2d5d8);
            background: var(--p-color-bg-surface, #fff);
            color: var(--p-color-text, #303030);
            font: inherit;
          }

          textarea {
            resize: vertical;
          }

          .count-on-us-admin-shell {
            min-height: 100%;
            background: var(--p-color-bg, #f6f6f7);
            font-family: var(--p-font-family-sans, Inter, -apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", sans-serif);
            font-size: var(--p-font-size-325, 0.875rem);
            line-height: var(--p-font-line-height-500, 1.25rem);
          }

          .count-on-us-admin-shell__nav {
            position: sticky;
            top: 0;
            z-index: 20;
            display: grid;
            gap: 0.6rem;
            padding: 0.85rem clamp(1rem, 2vw, 1.5rem);
            border-bottom: 1px solid var(--p-color-border, #d2d5d8);
            background: var(--p-color-bg-surface, #fff);
          }

          .count-on-us-admin-shell__groups,
          .count-on-us-admin-shell__subnav {
            display: flex;
            gap: 0.35rem;
            overflow-x: auto;
            scrollbar-width: thin;
            white-space: nowrap;
          }

          .count-on-us-admin-shell__group-link,
          .count-on-us-admin-shell__subnav-link {
            flex: 0 0 auto;
            border: 1px solid transparent;
            border-radius: 0.5rem;
            color: var(--p-color-text, #303030);
            font: inherit;
            text-decoration: none;
          }

          .count-on-us-admin-shell__group-link {
            padding: 0.55rem 0.8rem;
            font-weight: 650;
          }

          .count-on-us-admin-shell__subnav-link {
            padding: 0.4rem 0.65rem;
            font-size: 0.92rem;
          }

          .count-on-us-admin-shell__group-link:hover,
          .count-on-us-admin-shell__subnav-link:hover {
            background: var(--p-color-bg-surface-hover, #f1f2f4);
          }

          .count-on-us-admin-shell__group-link[aria-current="page"] {
            border-color: #111;
            background: #111;
            color: #fff;
          }

          .count-on-us-admin-shell__subnav-link[aria-current="page"] {
            border-color: var(--p-color-border, #d2d5d8);
            background: var(--p-color-bg-surface-selected, #f2f7fe);
            color: var(--p-color-text, #303030);
            font-weight: 650;
          }
        `}</style>
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
