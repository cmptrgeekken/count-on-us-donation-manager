import type { CSSProperties, ReactNode } from "react";
import { Link, useLocation } from "@remix-run/react";

type AdminNavItem = {
  label: string;
  path: string;
  query?: Record<string, string>;
};

type AdminNavGroup = AdminNavItem & {
  id: string;
  matches: string[];
  items: AdminNavItem[];
};

const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: "home",
    label: "Home",
    path: "/app/dashboard",
    matches: ["/app", "/app/dashboard"],
    items: [{ label: "Dashboard", path: "/app/dashboard" }],
  },
  {
    id: "products",
    label: "Products",
    path: "/app/products",
    matches: [
      "/app/products",
      "/app/variants",
      "/app/templates",
      "/app/materials",
      "/app/equipment",
      "/app/packages",
      "/app/provider-connections",
    ],
    items: [
      { label: "Products", path: "/app/products" },
      { label: "Variants", path: "/app/variants" },
      { label: "Cost Templates", path: "/app/templates" },
      { label: "Materials", path: "/app/materials" },
      { label: "Equipment", path: "/app/equipment" },
      { label: "Shipping Packages", path: "/app/packages" },
      { label: "Provider Connections", path: "/app/provider-connections" },
    ],
  },
  {
    id: "giving",
    label: "Giving",
    path: "/app/causes",
    matches: ["/app/causes"],
    items: [
      { label: "Causes", path: "/app/causes" },
      { label: "Cause Assignments", path: "/app/products" },
    ],
  },
  {
    id: "artists",
    label: "Artists",
    path: "/app/artists",
    matches: ["/app/artists", "/app/artist-submissions"],
    items: [
      { label: "Artists", path: "/app/artists" },
      { label: "Artist Submissions", path: "/app/artist-submissions" },
      { label: "Artist Payments", path: "/app/reporting" },
    ],
  },
  {
    id: "reporting",
    label: "Reporting",
    path: "/app/reporting",
    matches: ["/app/reporting", "/app/reporting-imports", "/app/production-usage", "/app/expenses", "/app/order-history", "/app/audit-log"],
    items: [
      { label: "Reporting", path: "/app/reporting" },
      { label: "Production Usage", path: "/app/production-usage" },
      { label: "Imports & rebuild", path: "/app/reporting-imports" },
      { label: "Expenses", path: "/app/expenses" },
      { label: "Order History", path: "/app/order-history" },
      { label: "Audit Log", path: "/app/audit-log" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    path: "/app/settings",
    matches: ["/app/settings"],
    items: [
      { label: "Financial", path: "/app/settings", query: { section: "financial" } },
      { label: "Cost Defaults", path: "/app/settings", query: { section: "costs" } },
      { label: "Tax", path: "/app/settings", query: { section: "tax" } },
      { label: "Notifications", path: "/app/settings", query: { section: "notifications" } },
      { label: "Localization", path: "/app/settings", query: { section: "localization" } },
      { label: "Advanced", path: "/app/settings", query: { section: "advanced" } },
    ],
  },
];

function pathMatches(pathname: string, matchPath: string) {
  return pathname === matchPath || pathname.startsWith(`${matchPath}/`);
}

function getActiveGroup(pathname: string) {
  return (
    ADMIN_NAV_GROUPS.find((group) =>
      group.matches.some((matchPath) =>
        matchPath === "/app" ? pathname === "/app" : pathMatches(pathname, matchPath),
      ),
    ) ?? ADMIN_NAV_GROUPS[0]
  );
}

function itemQueryMatches(item: AdminNavItem, searchParams: URLSearchParams) {
  if (!item.query) return true;
  return Object.entries(item.query).every(([key, value]) => searchParams.get(key) === value);
}

function getActiveItem(items: AdminNavItem[], pathname: string, searchParams: URLSearchParams) {
  const pathMatchesOnly = items.filter((item) => pathMatches(pathname, item.path));
  return pathMatchesOnly.find((item) => itemQueryMatches(item, searchParams)) ?? pathMatchesOnly[0];
}

const shellStyle: CSSProperties = {
  minHeight: "100%",
  background: "var(--p-color-bg, #f6f6f7)",
  fontFamily: 'var(--p-font-family-sans, Inter, -apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", sans-serif)',
  fontSize: "var(--p-font-size-325, 0.875rem)",
  lineHeight: "var(--p-font-line-height-500, 1.25rem)",
};

const navStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 20,
  display: "grid",
  gap: "0.6rem",
  padding: "0.85rem clamp(1rem, 2vw, 1.5rem)",
  borderBottom: "1px solid var(--p-color-border, #d2d5d8)",
  background: "var(--p-color-bg-surface, #fff)",
};

const navRowStyle: CSSProperties = {
  display: "flex",
  gap: "0.35rem",
  overflowX: "auto",
  scrollbarWidth: "thin",
  whiteSpace: "nowrap",
};

const baseLinkStyle: CSSProperties = {
  flex: "0 0 auto",
  border: "1px solid transparent",
  borderRadius: "0.5rem",
  color: "var(--p-color-text, #303030)",
  font: "inherit",
  textDecoration: "none",
};

const activeGroupLinkStyle: CSSProperties = {
  borderColor: "#111",
  background: "#111",
  color: "#fff",
};

const activeSubnavLinkStyle: CSSProperties = {
  borderColor: "var(--p-color-border, #d2d5d8)",
  background: "var(--p-color-bg-surface-selected, #f2f7fe)",
  color: "var(--p-color-text, #303030)",
  fontWeight: 650,
};

export function getAdminCompatibilityNavItems() {
  return ADMIN_NAV_GROUPS.map(({ label, path }) => ({ label, path }));
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const searchParams = new URLSearchParams(search);
  const activeGroup = getActiveGroup(pathname);
  const activeItem = getActiveItem(activeGroup.items, pathname, searchParams);
  const href = (item: AdminNavItem) => {
    const nextParams = new URLSearchParams(searchParams);
    if (item.path !== "/app/settings") {
      nextParams.delete("section");
    }
    Object.entries(item.query ?? {}).forEach(([key, value]) => nextParams.set(key, value));
    const nextSearch = nextParams.toString();
    return `${item.path}${nextSearch ? `?${nextSearch}` : ""}`;
  };

  return (
    <div className="count-on-us-admin-shell" style={shellStyle}>
      <nav className="count-on-us-admin-shell__nav" style={navStyle} aria-label="Count On Us admin">
        <div className="count-on-us-admin-shell__groups" style={navRowStyle} aria-label="Primary sections">
          {ADMIN_NAV_GROUPS.map((group) => (
            <Link
              key={group.id}
              to={href(group)}
              className="count-on-us-admin-shell__group-link"
              aria-current={group.id === activeGroup.id ? "page" : undefined}
              style={{
                ...baseLinkStyle,
                padding: "0.55rem 0.8rem",
                fontWeight: 650,
                ...(group.id === activeGroup.id ? activeGroupLinkStyle : {}),
              }}
            >
              {group.label}
            </Link>
          ))}
        </div>
        {activeGroup.items.length > 1 ? (
          <div
            className="count-on-us-admin-shell__subnav"
            style={navRowStyle}
            aria-label={`${activeGroup.label} pages`}
          >
            {activeGroup.items.map((item) => (
              <Link
                key={`${activeGroup.id}-${item.label}-${item.path}-${JSON.stringify(item.query ?? {})}`}
                to={href(item)}
                className="count-on-us-admin-shell__subnav-link"
                aria-current={activeItem === item ? "page" : undefined}
                style={{
                  ...baseLinkStyle,
                  padding: "0.4rem 0.65rem",
                  fontSize: "0.92rem",
                  ...(activeItem === item ? activeSubnavLinkStyle : {}),
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </nav>
      {children}
    </div>
  );
}
