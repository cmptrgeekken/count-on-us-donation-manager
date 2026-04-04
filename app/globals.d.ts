import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "*.css";

type ShopifyElementProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  heading?: string;
  size?: "base" | "large";
  tone?: "info" | "success" | "warning" | "critical";
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
};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-page": ShopifyElementProps;
      "s-section": ShopifyElementProps;
      "s-banner": ShopifyElementProps;
      "s-text": ShopifyElementProps;
      "s-button": ShopifyElementProps;
      "s-box": ShopifyElementProps;
      "s-stack": ShopifyElementProps;
      "s-text-field": ShopifyElementProps;
      "ui-title-bar": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        title?: string;
      };
    }
  }
}
