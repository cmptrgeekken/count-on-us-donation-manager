# Accessibility Standards — WCAG 2.1 AA

Shopify Polaris provides a strong accessibility baseline, but it does not automate everything. This document defines the implementation rules developers must follow to meet WCAG 2.1 Level AA throughout the app.

---

## Baseline

Polaris handles: color contrast ratios, focus ring styles, ARIA roles on its own components (Button, Modal, Select, IndexTable, etc.), and keyboard interaction for those components.

Developers are responsible for: semantic HTML structure, `aria-live` announcements for dynamic content, accessible names for custom interactions, focus management after modal/navigation transitions, and not breaking what Polaris provides.

---

## 1. Perceivable

### Text Alternatives (1.1)

- All `<img>` elements must have an `alt` attribute.
  - Informative images: `alt` describes the content.
  - Decorative images: `alt=""` (empty string, not omitted).
- Icons used without visible text labels must have an accessible name via `aria-label` or be accompanied by a visually-hidden text label.

```tsx
// Correct — icon with label
<Button icon={DeleteIcon} accessibilityLabel="Delete template" />

// Wrong — icon-only button with no accessible name
<Button icon={DeleteIcon} />
```

### Status Messages (1.3, 4.1.3)

Dynamic status messages — success confirmations, error announcements, in-progress states — must be announced to screen readers without moving focus.

Use the established `aria-live` pattern from `app/routes/app.variants._index.tsx`:

```tsx
<div
  aria-live="polite"
  aria-atomic="true"
  style={{
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap",
  }}
>
  {fetcher.data?.message ?? ""}
</div>
```

Use `aria-live="assertive"` only for critical errors that require immediate attention. Use `aria-live="polite"` for everything else.

### Color (1.4.1)

Color alone must never convey meaning. Always pair color with text or an icon.

```tsx
// Correct — Badge uses both color and text
<Badge tone={hasConfig ? "success" : "enabled"}>
  {hasConfig ? "Configured" : "Not configured"}
</Badge>

// Wrong — color-only status indicator with no text
<div style={{ backgroundColor: hasConfig ? "green" : "gray" }} />
```

### Text Sizing (1.4.4)

Use Polaris typography tokens (`Text` component with `variant` prop). Never set font sizes in `px` on text elements — use relative units so text scales with browser zoom.

---

## 2. Operable

### Keyboard Navigation (2.1)

All interactive elements must be operable with a keyboard alone.

- Use `<button>` for actions, `<a>` or Remix `<Link>` for navigation. Never attach `onClick` to a `<div>`, `<span>`, or non-interactive element.
- Custom interactive components (e.g., drag-and-drop reordering, if added) must expose keyboard alternatives.
- Modal dialogs must trap focus while open (Polaris `Modal` handles this automatically — do not replace it with custom dialog implementations).

```tsx
// Correct
<Button onClick={handleDelete}>Delete</Button>
<Link to={`/app/variants/${id}`}>Configure</Link>

// Wrong — div is not keyboard operable by default
<div onClick={handleDelete} role="button">Delete</div>
```

### Focus Management (2.4.3)

After a significant UI change, move focus to an appropriate element:

- After a modal closes (save or cancel), focus returns to the trigger button. Polaris `Modal` handles this.
- After a navigation action (e.g., saving a form that redirects), the new page's first meaningful heading or the `Page` title receives focus. Remix handles scroll restoration; verify focus lands predictably.
- After an inline action (e.g., a toast/banner confirms success), focus stays where it is — the `aria-live` region handles announcement.

### Skip Navigation (2.4.1)

For pages with repeated navigation structure, provide a skip-to-main-content link as the first focusable element. Shopify's App Bridge iframe architecture limits the need for this in most cases, but it is required if a persistent sidebar or navigation header is added to the app shell.

### Timing (2.2)

- Do not auto-dismiss success Banners. Leave them visible until the user dismisses or navigates away.
- Do not use timed redirects after form submissions. Use explicit navigation (redirect from action, or user-initiated link).

### Seizures and Physical Reactions (2.3)

- Do not use flashing content or animations that flash more than 3 times per second.
- Respect `prefers-reduced-motion`. If CSS animations are added, wrap them in a `@media (prefers-reduced-motion: no-preference)` query.

---

## 3. Understandable

### Labels and Instructions (3.3)

- Every form input must have a visible label. Never rely on `placeholder` as the only label — placeholders disappear on focus.
- Use Polaris `TextField`, `Select`, and `Checkbox` components which associate labels correctly via `label` prop.
- Required fields must be marked with the `requiredIndicator` prop on Polaris components.
- Validation errors must be surfaced inline on the specific field using the `error` prop, not only in a top-level Banner.

```tsx
// Correct — label + inline error
<TextField
  label="Labor rate ($/hr)"
  value={laborRate}
  onChange={setLaborRate}
  type="number"
  requiredIndicator
  error={errors?.laborRate}
/>
```

### Error Identification (3.3.1, 3.3.3)

Form validation errors must:
1. Identify which field has the error (inline `error` prop).
2. Describe what is wrong in plain language (not just "Invalid input").
3. Suggest how to fix it when possible ("Must be a positive number").

### Consistent Navigation (3.2.3)

Navigation elements — the Shopify App Bridge `TitleBar`, sidebar links — must appear in the same location and same order on every page.

---

## 4. Robust

### Valid HTML (4.1.1)

- Do not nest block elements inside inline elements.
- Do not use duplicate `id` attributes on a page.
- Interactive elements must not be nested inside other interactive elements (e.g., a `<button>` inside an `<a>`).

```tsx
// Wrong — button nested inside link
<Link to="/app/variants/123">
  <Button>Configure</Button>
</Link>

// Correct — use Link's own styling, or make the cell clickable via row navigation
<Link to={`/app/variants/${v.id}`}>
  <Text as="span" variant="bodyMd" fontWeight="semibold">{v.title}</Text>
</Link>
```

### ARIA Roles (4.1.2)

- Do not override Polaris ARIA roles unless you have a specific, documented reason.
- Custom components that behave like standard widgets (listbox, combobox, dialog) must implement the corresponding ARIA pattern from the ARIA Authoring Practices Guide.
- Every `aria-labelledby` and `aria-describedby` reference must point to an element that exists in the DOM.

---

## Testing Accessibility

Before merging any route or component change:

1. **Keyboard test**: Tab through all interactive elements on the page. Every element must be reachable, have a visible focus indicator, and activate on Enter/Space as appropriate.
2. **Screen reader spot-check**: Run VoiceOver (macOS) or NVDA (Windows) and verify that page structure, form labels, and status announcements are correct.
3. **Zoom test**: Zoom the browser to 200%. No content should overflow or become inaccessible.
4. **Automated scan**: Run `axe-core` (via the axe DevTools browser extension) on each page. Fix all violations before merging.
