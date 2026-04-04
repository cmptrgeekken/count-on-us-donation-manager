import { SaveBar } from "@shopify/app-bridge-react";

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
  return (
    <SaveBar open={open} discardConfirmation>
      <button type="button" variant="primary" disabled={saveDisabled} loading={loading} onClick={onSave}>
        {saveLabel}
      </button>
      <button type="button" disabled={loading} onClick={onDiscard}>
        {discardLabel}
      </button>
    </SaveBar>
  );
}
