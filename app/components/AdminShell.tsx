import type { ReactNode } from "react";
import { Link, useLocation } from "@remix-run/react";

type AdminNavItem = {
  label: string;
  path: string;
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
    matches: ["/app/reporting", "/app/expenses", "/app/order-history", "/app/audit-log"],
    items: [
      { label: "Reporting", path: "/app/reporting" },
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
    items: [{ label: "Settings", path: "/app/settings" }],
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

function getActiveItem(items: AdminNavItem[], pathname: string) {
  return items.find((item) => pathMatches(pathname, item.path));
}

export function getAdminCompatibilityNavItems() {
  return ADMIN_NAV_GROUPS.map(({ label, path }) => ({ label, path }));
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const activeGroup = getActiveGroup(pathname);
  const activeItem = getActiveItem(activeGroup.items, pathname);
  const href = (path: string) => `${path}${search}`;

  return (
    <div className="count-on-us-admin-shell">
      <style>
        {`
          .count-on-us-admin-shell {
            min-height: 100%;
            background: var(--p-color-bg, #f6f6f7);
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
        `}
      </style>
      <nav className="count-on-us-admin-shell__nav" aria-label="Count On Us admin">
        <div className="count-on-us-admin-shell__groups" aria-label="Primary sections">
          {ADMIN_NAV_GROUPS.map((group) => (
            <Link
              key={group.id}
              to={href(group.path)}
              className="count-on-us-admin-shell__group-link"
              aria-current={group.id === activeGroup.id ? "page" : undefined}
            >
              {group.label}
            </Link>
          ))}
        </div>
        <div className="count-on-us-admin-shell__subnav" aria-label={`${activeGroup.label} pages`}>
          {activeGroup.items.map((item) => (
            <Link
              key={`${activeGroup.id}-${item.label}-${item.path}`}
              to={href(item.path)}
              className="count-on-us-admin-shell__subnav-link"
              aria-current={activeItem?.path === item.path ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}
