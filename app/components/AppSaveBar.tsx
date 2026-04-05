import { useEffect, useId, useRef } from "react";

type AppSaveBarProps = {
  open: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
  discardLabel?: string;
  saveDisabled?: boolean;
  loading?: boolean;
};

export function AppSaveBar({
  open,
  onSave,
  onDiscard,
  saveLabel = "Save",
  discardLabel = "Discard",
  saveDisabled = false,
  loading = false,
}: AppSaveBarProps) {
  const id = useId().replace(/:/g, "");
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const discardButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const api = (globalThis as any).shopify?.saveBar;
    if (!api) return;

    const action = open ? api.show?.(id) : api.hide?.(id);
    void action;

    return () => {
      void api.hide?.(id);
    };
  }, [id, open]);

  useEffect(() => {
    const saveButton = saveButtonRef.current;
    const discardButton = discardButtonRef.current;
    if (!saveButton || !discardButton) return;

    const handleSave = () => {
      if (!saveDisabled && !loading) {
        onSave();
      }
    };
    const handleDiscard = () => {
      if (!loading) {
        onDiscard();
      }
    };

    saveButton.addEventListener("click", handleSave);
    discardButton.addEventListener("click", handleDiscard);

    return () => {
      saveButton.removeEventListener("click", handleSave);
      discardButton.removeEventListener("click", handleDiscard);
    };
  }, [loading, onDiscard, onSave, saveDisabled]);

  useEffect(() => {
    const saveButton = saveButtonRef.current;
    const discardButton = discardButtonRef.current;
    if (!saveButton || !discardButton) return;

    saveButton.setAttribute("variant", "primary");

    if (saveDisabled || loading) {
      saveButton.setAttribute("disabled", "true");
    } else {
      saveButton.removeAttribute("disabled");
    }

    if (loading) {
      saveButton.setAttribute("loading", "true");
      discardButton.setAttribute("disabled", "true");
    } else {
      saveButton.removeAttribute("loading");
      discardButton.removeAttribute("disabled");
    }
  }, [loading, saveDisabled]);

  return (
    <ui-save-bar id={id}>
      <button
        ref={saveButtonRef}
        type="button"
      >
        {loading ? "Saving..." : saveLabel}
      </button>
      <button ref={discardButtonRef} type="button">
        {discardLabel}
      </button>
    </ui-save-bar>
  );
}
