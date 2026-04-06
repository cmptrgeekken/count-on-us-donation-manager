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
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
        <style>{`
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
        `}</style>
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
