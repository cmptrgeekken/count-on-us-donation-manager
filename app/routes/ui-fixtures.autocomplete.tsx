import { useMemo, useState } from "react";

const materials = [
  { id: "mat-laminate", name: "Laminate Sheet" },
  { id: "mat-super-glue", name: "Super Glue" },
  { id: "mat-vinyl", name: "Vinyl Roll" },
];

export default function AutocompleteFixturePage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return materials;
    return materials.filter((item) => item.name.toLowerCase().includes(normalized));
  }, [query]);

  function openDialog() {
    setDialogOpen(true);
    setListOpen(false);
  }

  function closeDialog() {
    setDialogOpen(false);
    setListOpen(false);
  }

  function handleSelect(name: string) {
    setSelected(name);
    setQuery(name);
    setListOpen(false);
  }

  return (
    <main style={{ padding: "2rem", display: "grid", gap: "1rem" }}>
      <h1>Autocomplete Fixture</h1>
      <p style={{ margin: 0, maxWidth: "50rem" }}>
        Deterministic fixture route for Playwright coverage of dialog and autocomplete behavior.
      </p>

      <div>
        <button type="button" onClick={openDialog} data-testid="open-dialog">
          Open fixture dialog
        </button>
      </div>

      {dialogOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.25)",
            display: "grid",
            placeItems: "center",
            padding: "2rem",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="autocomplete-fixture-heading"
            style={{
              width: "min(100%, 36rem)",
              background: "#fff",
              borderRadius: "1rem",
              padding: "1.5rem",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.2)",
              display: "grid",
              gap: "1rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 id="autocomplete-fixture-heading" style={{ margin: 0 }}>
                Add material
              </h2>
              <button type="button" aria-label="Close dialog" onClick={closeDialog}>
                ×
              </button>
            </div>

            <div style={{ display: "grid", gap: "0.4rem", position: "relative" }}>
              <label htmlFor="fixture-material-search">Material</label>
              <input
                id="fixture-material-search"
                data-testid="material-search"
                type="text"
                value={query}
                placeholder="Search materials"
                onFocus={() => setListOpen(true)}
                onClick={() => setListOpen(true)}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setListOpen(true);
                }}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #c9cccf",
                  borderRadius: "0.75rem",
                  font: "inherit",
                }}
              />
              {listOpen ? (
                <div
                  data-testid="material-results"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 0.35rem)",
                    left: 0,
                    right: 0,
                    background: "#fff",
                    border: "1px solid #c9cccf",
                    borderRadius: "0.75rem",
                    boxShadow: "0 12px 24px rgba(0, 0, 0, 0.12)",
                    overflow: "hidden",
                    zIndex: 2,
                  }}
                >
                  {filtered.length === 0 ? (
                    <div style={{ padding: "0.75rem 1rem" }}>No materials match that search.</div>
                  ) : (
                    filtered.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelect(item.name)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: 0,
                          background: "#fff",
                          padding: "0.75rem 1rem",
                          cursor: "pointer",
                        }}
                      >
                        {item.name}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p data-testid="selected-material" style={{ margin: 0 }}>
                Selected: {selected ?? "None"}
              </p>
              <button type="button" onClick={closeDialog}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
