import type { ReactNode } from "react";

export function HelpText({ children }: { children: ReactNode }) {
  return <s-text color="subdued">{children}</s-text>;
}
