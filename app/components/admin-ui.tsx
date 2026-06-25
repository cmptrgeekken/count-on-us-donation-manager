import type { ReactNode } from "react";

export const adminFieldStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "0.75rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--p-color-border, #d2d5d8)",
  background: "var(--p-color-bg-surface, #fff)",
  color: "var(--p-color-text, #303030)",
  font: "inherit",
};

export function FetcherBanners({
  data,
}: {
  data?: { ok: boolean; message?: string } | null;
}) {
  if (!data?.message) return null;

  return (
    <s-banner tone={data.ok ? "success" : "critical"}>
      <s-text>{data.message}</s-text>
    </s-banner>
  );
}

export function StatusBanners({
  items,
}: {
  items: Array<{ ok: boolean; message?: string } | null | undefined>;
}) {
  return (
    <>
      {items.map((item, index) => (
        <FetcherBanners key={index} data={item} />
      ))}
    </>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gap: "0.75rem",
        gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))",
      }}
    >
      {children}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: ReactNode;
  tone?: "critical" | "warning" | "success" | "subdued";
  detail?: ReactNode;
}) {
  const color =
    tone === "critical"
      ? "var(--p-color-text-critical, #8e1f1f)"
      : tone === "warning"
        ? "#8a5a00"
        : tone === "success"
          ? "#0f6b3c"
          : "inherit";

  return (
    <div
      style={{
        display: "grid",
        gap: "0.25rem",
        padding: "0.85rem",
        border: "1px solid var(--p-color-border, #d2d5d8)",
        borderRadius: "0.5rem",
        background: "var(--p-color-bg-surface, #fff)",
      }}
    >
      <span style={{ color: "var(--p-color-text-subdued, #6d7175)" }}>{label}</span>
      <strong style={{ color, fontSize: "1.35rem" }}>{value}</strong>
      {detail ? <s-text color="subdued">{detail}</s-text> : null}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start", flexWrap: "wrap" }}>
      <div style={{ display: "grid", gap: "0.25rem" }}>
        <strong>{title}</strong>
        {description ? <s-text color="subdued">{description}</s-text> : null}
      </div>
      {actions ? <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>{actions}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "1rem",
        alignItems: "start",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "grid", gap: "0.3rem", maxWidth: "48rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.35rem", lineHeight: 1.25 }}>{title}</h1>
        {description ? <s-text color="subdued">{description}</s-text> : null}
      </div>
      {actions ? <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>{actions}</div> : null}
    </div>
  );
}

export function ResourceTableHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      slot="filters"
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "1rem",
        alignItems: "center",
        flexWrap: "wrap",
        padding: "1rem",
      }}
    >
      <div style={{ display: "grid", gap: "0.2rem", minWidth: "min(100%, 16rem)" }}>
        <strong>{title}</strong>
        {description ? <s-text color="subdued">{description}</s-text> : null}
      </div>
      {action ? <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>{action}</div> : null}
    </div>
  );
}

export function EmptyTableRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <s-table-row>
      <s-table-cell>{children}</s-table-cell>
      {Array.from({ length: Math.max(colSpan - 1, 0) }).map((_, index) => (
        <s-table-cell key={index}></s-table-cell>
      ))}
    </s-table-row>
  );
}

export function SegmentedTabs<TValue extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: Array<{ value: TValue; label: string }>;
  value: TValue;
  onChange: (value: TValue) => void;
}) {
  return (
    <div role="tablist" aria-label={label} style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.value)}
            style={{
              border: "1px solid var(--p-color-border, #d2d5d8)",
              borderRadius: "0.5rem",
              background: selected ? "var(--p-color-bg-fill-brand, #005bd3)" : "var(--p-color-bg-surface, #fff)",
              color: selected ? "#fff" : "var(--p-color-text, #303030)",
              padding: "0.55rem 0.8rem",
              font: "inherit",
              fontWeight: selected ? 650 : 500,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function WorkflowTabs<TValue extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: Array<{ value: TValue; label: string }>;
  value: TValue;
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="admin-workflow-tabs">
      <style>
        {`
          .admin-workflow-tabs__select {
            display: none;
          }

          .admin-workflow-tabs__tablist {
            display: flex;
            gap: 0.35rem;
            overflow-x: auto;
            scrollbar-width: thin;
            white-space: nowrap;
          }

          .admin-workflow-tabs__tab {
            flex: 0 0 auto;
            border: 1px solid var(--p-color-border, #d2d5d8);
            border-radius: 0.5rem;
            padding: 0.55rem 0.8rem;
            background: var(--p-color-bg-surface, #fff);
            color: var(--p-color-text, #303030);
            font: inherit;
            font-weight: 500;
            cursor: pointer;
          }

          .admin-workflow-tabs__tab[aria-selected="true"] {
            border-color: #111;
            background: #111;
            color: #fff;
            font-weight: 650;
          }

          @media (max-width: 640px) {
            .admin-workflow-tabs__select {
              display: block;
              width: 100%;
              box-sizing: border-box;
              padding: 0.75rem;
              border-radius: 0.5rem;
              border: 1px solid var(--p-color-border, #d2d5d8);
              background: var(--p-color-bg-surface, #fff);
              color: var(--p-color-text, #303030);
              font: inherit;
            }

            .admin-workflow-tabs__tablist {
              display: none;
            }
          }
        `}
      </style>
      <select
        className="admin-workflow-tabs__select"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as TValue)}
      >
        {tabs.map((tab) => (
          <option key={tab.value} value={tab.value}>
            {tab.label}
          </option>
        ))}
      </select>
      <div role="tablist" aria-label={label} className="admin-workflow-tabs__tablist">
        {tabs.map((tab) => {
          const selected = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={selected}
              className="admin-workflow-tabs__tab"
              onClick={() => onChange(tab.value)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
