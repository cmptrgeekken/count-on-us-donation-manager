import { useEffect, useId } from "react";

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

  useEffect(() => {
    const api = (globalThis as any).shopify?.saveBar;
    if (!api) return;

    const action = open ? api.show?.(id) : api.hide?.(id);
    void action;

    return () => {
      void api.hide?.(id);
    };
  }, [id, open]);

  return (
    <ui-save-bar id={id}>
      <button
        type="button"
        disabled={saveDisabled || loading}
        onClick={onSave}
      >
        {loading ? "Saving..." : saveLabel}
      </button>
      <button type="button" disabled={loading} onClick={onDiscard}>
        {discardLabel}
      </button>
    </ui-save-bar>
  );
}
