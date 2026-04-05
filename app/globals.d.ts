import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "*.css";

type ShopifyElementProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  heading?: string;
  size?: "base" | "large";
  tone?: "info" | "success" | "warning" | "critical" | "enabled" | "neutral" | "caution";
  color?: "subdued" | "strong";
  variant?: "primary" | "secondary" | "plain";
  type?: string;
  href?: string;
  target?: string;
  gap?: string;
  padding?: string;
  background?: string;
  border?: string;
  borderRadius?: string;
  value?: string;
  label?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  slot?: string;
  details?: string;
  placeholder?: string;
  command?: string;
  commandFor?: string;
  format?: "base" | "numeric" | "currency";
  listSlot?: "primary" | "secondary" | "kicker" | "inline" | "labeled";
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-page": ShopifyElementProps;
      "s-section": ShopifyElementProps;
      "s-banner": ShopifyElementProps;
      "s-badge": ShopifyElementProps;
      "s-text": ShopifyElementProps;
      "s-button": ShopifyElementProps;
      "s-box": ShopifyElementProps;
      "s-stack": ShopifyElementProps;
      "s-modal": ShopifyElementProps;
      "s-link": ShopifyElementProps;
      "s-select": ShopifyElementProps;
      "s-option": ShopifyElementProps;
      "s-table": ShopifyElementProps;
      "s-table-body": ShopifyElementProps;
      "s-table-cell": ShopifyElementProps;
      "s-table-header": ShopifyElementProps;
      "s-table-header-row": ShopifyElementProps;
      "s-table-row": ShopifyElementProps;
      "s-text-field": ShopifyElementProps;
      "ui-nav-menu": ShopifyElementProps;
      "ui-save-bar": ShopifyElementProps;
      "ui-title-bar": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        title?: string;
      };
    }
  }
}
