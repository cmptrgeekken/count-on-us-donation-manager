import { useEffect, useMemo, useState, type ReactNode } from "react";

export type AssignmentPickerOption = {
  id: string;
  label: string;
  description?: string;
  meta?: string[];
  disabled?: boolean;
  disabledReason?: string;
};

export type AssignmentListItem = {
  id: string;
  title: string;
  subtitle?: string;
  summary?: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
  searchText?: string;
  defaultExpanded?: boolean;
  tone?: "default" | "critical";
};

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "0.75rem",
  borderRadius: "0.75rem",
  border: "1px solid var(--p-color-border, #d2d5d8)",
  background: "var(--p-color-bg-surface, #fff)",
  color: "var(--p-color-text, #303030)",
  font: "inherit",
};

const secondaryButtonStyle = {
  border: "1px solid var(--p-color-border, #d2d5d8)",
  borderRadius: "0.5rem",
  background: "var(--p-color-bg-surface, #fff)",
  padding: "0.55rem 0.75rem",
  cursor: "pointer",
  font: "inherit",
};

const primaryButtonStyle = {
  ...secondaryButtonStyle,
  background: "var(--p-color-bg-inverse, #303030)",
  color: "var(--p-color-text-inverse, #fff)",
  borderColor: "var(--p-color-bg-inverse, #303030)",
};

export function AssignmentPicker({
  id,
  label,
  triggerLabel,
  options,
  selectedIds,
  onAdd,
  multi = true,
  hideSelected = true,
  searchPlaceholder = "Search",
  emptyText = "No matching items.",
  disabled = false,
}: {
  id: string;
  label: string;
  triggerLabel: string;
  options: AssignmentPickerOption[];
  selectedIds: Set<string>;
  onAdd: (ids: string[]) => void;
  multi?: boolean;
  hideSelected?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const visibleOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return options.filter((option) => {
      if (hideSelected && selectedIds.has(option.id)) return false;
      if (!normalized) return true;
      const haystack = [option.label, option.description, ...(option.meta ?? [])].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalized);
    });
  }, [hideSelected, options, query, selectedIds]);

  function togglePending(optionId: string) {
    setPendingIds((current) => {
      if (!multi) return current.includes(optionId) ? [] : [optionId];
      return current.includes(optionId)
        ? current.filter((idValue) => idValue !== optionId)
        : [...current, optionId];
    });
  }

  function closePicker() {
    setOpen(false);
    setQuery("");
    setPendingIds([]);
  }

  function addSelected(keepOpen: boolean) {
    if (pendingIds.length === 0) return;
    onAdd(pendingIds);
    setPendingIds([]);
    setQuery("");
    if (!keepOpen) {
      setOpen(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} style={secondaryButtonStyle}>
        {triggerLabel}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "grid",
            placeItems: "center",
            padding: "1rem",
            background: "rgba(0, 0, 0, 0.32)",
          }}
        >
          <div
            style={{
              width: "min(46rem, 100%)",
              maxHeight: "min(42rem, calc(100vh - 2rem))",
              display: "grid",
              gridTemplateRows: "auto auto 1fr auto",
              gap: "0.85rem",
              padding: "1rem",
              borderRadius: "0.75rem",
              background: "var(--p-color-bg-surface, #fff)",
              boxShadow: "0 24px 64px rgba(0, 0, 0, 0.2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
              <strong id={`${id}-title`}>{label}</strong>
              <button type="button" onClick={closePicker} style={secondaryButtonStyle}>
                Close
              </button>
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={searchPlaceholder}
              style={fieldStyle}
            />
            <div
              style={{
                overflowY: "auto",
                border: "1px solid var(--p-color-border, #d2d5d8)",
                borderRadius: "0.6rem",
              }}
            >
              {visibleOptions.length === 0 ? (
                <div style={{ padding: "1rem", color: "var(--p-color-text-subdued, #6d7175)" }}>{emptyText}</div>
              ) : (
                visibleOptions.map((option) => {
                  const checked = pendingIds.includes(option.id) || (pendingIds.length === 0 && selectedIds.has(option.id));
                  return (
                    <label
                      key={option.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: "0.75rem",
                        padding: "0.8rem 1rem",
                        borderBottom: "1px solid var(--p-color-border-subdued, #ebebeb)",
                        cursor: option.disabled ? "not-allowed" : "pointer",
                        opacity: option.disabled ? 0.55 : 1,
                      }}
                    >
                      <input
                        type={multi ? "checkbox" : "radio"}
                        checked={checked}
                        disabled={option.disabled}
                        onChange={() => togglePending(option.id)}
                      />
                      <span style={{ display: "grid", gap: "0.2rem" }}>
                        <strong>{option.label}</strong>
                        {option.description ? <span style={{ color: "var(--p-color-text-subdued, #6d7175)" }}>{option.description}</span> : null}
                        {option.meta && option.meta.length > 0 ? (
                          <span style={{ color: "var(--p-color-text-subdued, #6d7175)" }}>{option.meta.join(" · ")}</span>
                        ) : null}
                        {option.disabledReason ? (
                          <span style={{ color: "var(--p-color-text-critical, #8e1f1f)" }}>{option.disabledReason}</span>
                        ) : null}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: "var(--p-color-text-subdued, #6d7175)" }}>{pendingIds.length} selected</span>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                {multi ? (
                  <button type="button" onClick={() => addSelected(true)} disabled={pendingIds.length === 0} style={secondaryButtonStyle}>
                    Add and keep open
                  </button>
                ) : null}
                <button type="button" onClick={() => addSelected(false)} disabled={pendingIds.length === 0} style={primaryButtonStyle}>
                  Add selected
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function CompactAssignmentList({
  items,
  emptyText,
  searchPlaceholder = "Filter selected items",
}: {
  items: AssignmentListItem[];
  emptyText: string;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(items.filter((item) => item.defaultExpanded).map((item) => item.id)),
  );

  useEffect(() => {
    setExpandedIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const item of items) {
        if (item.defaultExpanded && !next.has(item.id)) {
          next.add(item.id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => {
      const haystack = [item.title, item.subtitle, item.searchText].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalized);
    });
  }, [items, query]);

  function setAllExpanded(open: boolean) {
    setExpandedIds(open ? new Set(items.map((item) => item.id)) : new Set());
  }

  function toggleExpanded(itemId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  if (items.length === 0) {
    return <p style={{ margin: 0, color: "var(--p-color-text-subdued, #6d7175)" }}>{emptyText}</p>;
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      {items.length > 5 ? (
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={searchPlaceholder}
            style={{ ...fieldStyle, flex: "1 1 18rem" }}
          />
          <button type="button" onClick={() => setAllExpanded(true)} style={secondaryButtonStyle}>
            Expand all
          </button>
          <button type="button" onClick={() => setAllExpanded(false)} style={secondaryButtonStyle}>
            Collapse all
          </button>
        </div>
      ) : null}
      <div style={{ display: "grid", gap: "0.5rem" }}>
        {filteredItems.map((item) => {
          const expanded = expandedIds.has(item.id);
          return (
            <div
              key={item.id}
              style={{
                display: "grid",
                gap: expanded ? "0.75rem" : 0,
                padding: "0.75rem",
                border: `1px solid ${item.tone === "critical" ? "var(--p-color-border-critical, #c4320a)" : "var(--p-color-border, #d2d5d8)"}`,
                borderRadius: "0.5rem",
                background: "var(--p-color-bg-surface, #fff)",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gap: "0.75rem",
                  gridTemplateColumns: "minmax(12rem, 1fr) minmax(9rem, auto) auto auto",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "grid", gap: "0.18rem", minWidth: 0 }}>
                  <strong>{item.title}</strong>
                  {item.subtitle ? <span style={{ color: "var(--p-color-text-subdued, #6d7175)" }}>{item.subtitle}</span> : null}
                </div>
                <div>{item.summary}</div>
                {item.details ? (
                  <button type="button" onClick={() => toggleExpanded(item.id)} style={secondaryButtonStyle}>
                    {expanded ? "Hide details" : "Edit"}
                  </button>
                ) : <span />}
                <div>{item.actions}</div>
              </div>
              {expanded && item.details ? <div>{item.details}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
