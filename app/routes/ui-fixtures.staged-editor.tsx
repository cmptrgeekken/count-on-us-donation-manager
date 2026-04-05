import { useMemo, useState } from "react";

const initialDraft = {
  name: "Sticker Sheet Template",
  description: "Laminated sticker set with backing card.",
};

export default function StagedEditorFixturePage() {
  const [baseDraft, setBaseDraft] = useState(initialDraft);
  const [draft, setDraft] = useState(initialDraft);
  const [lastAction, setLastAction] = useState("No pending changes.");

  const isDirty = useMemo(
    () => JSON.stringify(baseDraft) !== JSON.stringify(draft),
    [baseDraft, draft],
  );

  function discardChanges() {
    setDraft(baseDraft);
    setLastAction("Discarded staged changes.");
  }

  function saveChanges() {
    setBaseDraft(draft);
    setLastAction("Saved staged changes.");
  }

  return (
    <main style={{ padding: "2rem", display: "grid", gap: "1.5rem", paddingBottom: "8rem" }}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <h1 style={{ margin: 0 }}>Staged Editor Fixture</h1>
        <p style={{ margin: 0, maxWidth: "52rem" }}>
          Deterministic fixture route for Playwright coverage of staged editing and save/discard behavior.
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gap: "1rem",
          border: "1px solid #d2d5d8",
          borderRadius: "1rem",
          padding: "1.5rem",
          background: "#fff",
          maxWidth: "48rem",
        }}
      >
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor="fixture-template-name">Name</label>
          <input
            id="fixture-template-name"
            data-testid="fixture-name"
            type="text"
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.currentTarget.value }))
            }
            style={{
              width: "100%",
              padding: "0.75rem",
              border: "1px solid #c9cccf",
              borderRadius: "0.75rem",
              font: "inherit",
            }}
          />
        </div>

        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor="fixture-template-description">Description</label>
          <textarea
            id="fixture-template-description"
            data-testid="fixture-description"
            value={draft.description}
            onChange={(event) =>
              setDraft((current) => ({ ...current, description: event.currentTarget.value }))
            }
            rows={4}
            style={{
              width: "100%",
              padding: "0.75rem",
              border: "1px solid #c9cccf",
              borderRadius: "0.75rem",
              font: "inherit",
            }}
          />
        </div>

        <p data-testid="fixture-status" style={{ margin: 0 }}>
          {lastAction}
        </p>
      </section>

      {isDirty ? (
        <div
          data-testid="fixture-save-bar"
          style={{
            position: "fixed",
            left: "50%",
            bottom: "1.5rem",
            transform: "translateX(-50%)",
            width: "min(100% - 2rem, 48rem)",
            background: "#111827",
            color: "#fff",
            borderRadius: "1rem",
            padding: "1rem 1.25rem",
            boxShadow: "0 12px 24px rgba(0, 0, 0, 0.25)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <span>Unsaved changes</span>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button type="button" data-testid="fixture-discard" onClick={discardChanges}>
              Discard
            </button>
            <button type="button" data-testid="fixture-save" onClick={saveChanges}>
              Save
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
