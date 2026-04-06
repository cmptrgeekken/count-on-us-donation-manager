import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

type Tone = "critical" | "success" | "warning" | "subdued" | "enabled" | "info" | "attention" | "caution";

function spacingValue(token?: string) {
  if (!token) return undefined;
  const numeric = Number(token);
  if (Number.isNaN(numeric)) return token;
  return `${numeric / 400}rem`;
}

function toneColor(tone?: Tone) {
  switch (tone) {
    case "critical":
      return "#8e1f1f";
    case "success":
      return "#0f6b3c";
    case "warning":
    case "caution":
      return "#8a5a00";
    case "subdued":
      return "var(--p-color-text-subdued, #6d7175)";
    case "info":
      return "#005bd3";
    case "attention":
      return "#8a5a00";
    case "enabled":
      return "#4a4f55";
    default:
      return "inherit";
  }
}

const fieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "0.75rem",
  borderRadius: "0.75rem",
  border: "1px solid var(--p-color-border, #d2d5d8)",
  background: "var(--p-color-bg-surface, #fff)",
  color: "var(--p-color-text, #303030)",
  font: "inherit",
};

export function TitleBar({ title }: { title: string }) {
  return <ui-title-bar title={title} />;
}

export function Page({
  children,
  title,
  backAction,
  titleMetadata,
}: {
  children: ReactNode;
  title?: string;
  backAction?: { content: string; onAction: () => void };
  titleMetadata?: ReactNode;
}) {
  return (
    <>
      {title && !backAction ? <ui-title-bar title={title} /> : null}
      <s-page>
        {(title || backAction) && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
            {backAction ? (
              <button
                type="button"
                onClick={backAction.onAction}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--p-color-text-subdued, #6d7175)",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {backAction.content}
              </button>
            ) : null}
            {title ? <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{title}</h1> : null}
            {titleMetadata ? <div>{titleMetadata}</div> : null}
          </div>
        )}
        {children}
      </s-page>
    </>
  );
}

export function Card({ children, padding = "400" }: { children: ReactNode; padding?: string }) {
  return (
    <div
      style={{
        background: "var(--p-color-bg-surface, #fff)",
        border: "1px solid var(--p-color-border, #d2d5d8)",
        borderRadius: "1rem",
        padding: spacingValue(padding) ?? "1rem",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {children}
    </div>
  );
}

export function BlockStack({ children, gap = "400" }: { children: ReactNode; gap?: string }) {
  return <div style={{ display: "grid", gap: spacingValue(gap) ?? "1rem" }}>{children}</div>;
}

export function InlineStack({
  children,
  gap = "400",
  align,
  blockAlign,
  wrap = true,
}: {
  children: ReactNode;
  gap?: string;
  align?: "space-between" | "start" | "center" | "end";
  blockAlign?: "start" | "center" | "end";
  wrap?: boolean;
}) {
  const justifyContent =
    align === "space-between"
      ? "space-between"
      : align === "center"
        ? "center"
        : align === "end"
          ? "flex-end"
          : "flex-start";

  const alignItems = blockAlign === "center" ? "center" : blockAlign === "end" ? "flex-end" : "flex-start";

  return (
    <div
      style={{
        display: "flex",
        gap: spacingValue(gap) ?? "1rem",
        justifyContent,
        alignItems,
        flexWrap: wrap ? "wrap" : "nowrap",
      }}
    >
      {children}
    </div>
  );
}

export function Divider() {
  return <hr style={{ border: 0, borderTop: "1px solid var(--p-color-border, #d2d5d8)", margin: 0 }} />;
}

export function Text({
  children,
  as = "p",
  tone,
  fontWeight,
}: {
  children: ReactNode;
  as?: keyof JSX.IntrinsicElements;
  variant?: string;
  tone?: Tone;
  fontWeight?: "semibold" | "bold";
}) {
  const Component = as as keyof JSX.IntrinsicElements;
  const style: CSSProperties = {
    margin: 0,
    color: toneColor(tone),
    fontWeight: fontWeight === "bold" ? 700 : fontWeight === "semibold" ? 600 : undefined,
  };
  return <Component style={style}>{children}</Component>;
}

export function Badge({ children, tone }: { children: ReactNode; tone?: Tone }) {
  const badgeTone = tone === "attention" ? "warning" : tone === "enabled" ? "enabled" : tone;
  return <s-badge tone={badgeTone as any}>{children}</s-badge>;
}

export function Banner({
  children,
  tone,
  heading,
}: {
  children: ReactNode;
  tone?: "critical" | "success" | "warning";
  heading?: string;
}) {
  return (
    <s-banner tone={tone} heading={heading}>
      <div style={{ display: "grid", gap: "0.5rem" }}>{children}</div>
    </s-banner>
  );
}

export function Button({
  children,
  onClick,
  variant,
  tone,
  submit,
  disabled,
  loading,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "plain" | "primary";
  tone?: Tone;
  submit?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  const resolvedVariant = variant === "plain" ? "secondary" : "primary";
  return (
    <s-button
      type={submit ? "submit" : "button"}
      variant={resolvedVariant as any}
      tone={tone === "attention" ? "warning" : (tone as any)}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {loading ? "Working..." : children}
    </s-button>
  );
}

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  autoComplete,
  disabled,
  type,
  min,
  max,
  step,
  helpText,
  placeholder,
  multiline,
  name,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  autoComplete?: string;
  disabled?: boolean;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
  helpText?: string;
  placeholder?: string;
  multiline?: number | boolean;
  name?: string;
}) {
  const id = useId();

  if (multiline) {
    return (
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <label htmlFor={id}>{label}</label>
        <textarea
          id={id}
          name={name}
          rows={typeof multiline === "number" ? multiline : 3}
          value={value}
          onChange={(event) => onChange?.(event.currentTarget.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          placeholder={placeholder}
          style={{
            ...fieldStyle,
            resize: "vertical",
          }}
        />
        {helpText ? <Text as="p" tone="subdued">{helpText}</Text> : null}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type ?? "text"}
        value={value}
        onChange={(event) => onChange?.(event.currentTarget.value)}
        onBlur={onBlur}
        autoComplete={autoComplete}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        style={{
          ...fieldStyle,
        }}
      />
      {helpText ? <Text as="p" tone="subdued">{helpText}</Text> : null}
    </div>
  );
}

export function Select({
  label,
  options,
  value,
  onChange,
  labelHidden,
}: {
  label: string;
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
  labelHidden?: boolean;
}) {
  const id = useId();
  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      {!labelHidden ? <label htmlFor={id}>{label}</label> : <label htmlFor={id} style={{ position: "absolute", left: "-9999px" }}>{label}</label>}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        style={{
          ...fieldStyle,
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

type ModalAction = {
  content: string;
  onAction: () => void;
  disabled?: boolean;
  destructive?: boolean;
  loading?: boolean;
};

function ModalSection({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

export function Modal({
  open,
  onClose,
  title,
  primaryAction,
  secondaryActions = [],
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  primaryAction?: ModalAction;
  secondaryActions?: Array<{ content: string; onAction: () => void }>;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      style={{
        border: "none",
        borderRadius: "1rem",
        padding: 0,
        maxWidth: "40rem",
        width: "calc(100% - 2rem)",
      }}
    >
      <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
          <strong>{title}</strong>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            style={{ border: "none", background: "transparent", fontSize: "1.5rem", lineHeight: 1, cursor: "pointer" }}
          >
            ×
          </button>
        </div>
        {children}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
          {secondaryActions.map((action) => (
            <Button key={action.content} variant="plain" onClick={action.onAction}>
              {action.content}
            </Button>
          ))}
          {primaryAction ? (
            <Button
              variant="primary"
              tone={primaryAction.destructive ? "critical" : undefined}
              disabled={primaryAction.disabled}
              loading={primaryAction.loading}
              onClick={primaryAction.onAction}
            >
              {primaryAction.content}
            </Button>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

Modal.Section = ModalSection;

export function EmptyState({
  heading,
  children,
  fullWidth,
}: {
  heading: string;
  image?: string;
  children: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px dashed var(--p-color-border, #d2d5d8)",
        borderRadius: "1rem",
        padding: "1.25rem",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <strong>{heading}</strong>
      {children}
    </div>
  );
}

type AutocompleteOption = { value: string; label: string };

function AutocompleteTextField(props: Parameters<typeof TextField>[0]) {
  return <TextField {...props} />;
}

export function Autocomplete({
  options,
  onSelect,
  textField,
  emptyState,
}: {
  options: AutocompleteOption[];
  selected: string[];
  onSelect: (selected: string[]) => void;
  textField: ReactNode;
  emptyState?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <div
      ref={wrapperRef}
      style={{ position: "relative" }}
      onFocusCapture={() => setOpen(true)}
      onClickCapture={() => setOpen(true)}
    >
      {textField}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 0.35rem)",
            left: 0,
            right: 0,
            zIndex: 20,
            border: "1px solid var(--p-color-border, #d2d5d8)",
            borderRadius: "0.75rem",
            overflow: "hidden",
            maxHeight: "14rem",
            overflowY: "auto",
            background: "#fff",
            boxShadow: "0 12px 24px rgba(0, 0, 0, 0.12)",
          }}
        >
          {options.length === 0 ? (
            <div style={{ padding: "0.75rem 1rem" }}>{emptyState ?? null}</div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onSelect([option.value]);
                  setOpen(false);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  border: 0,
                  background: "#fff",
                  padding: "0.75rem 1rem",
                  cursor: "pointer",
                }}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

Autocomplete.TextField = AutocompleteTextField;
