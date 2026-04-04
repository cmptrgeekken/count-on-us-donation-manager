import { useCallback, useEffect } from "react";
import { useNavigate } from "@remix-run/react";

export function useUnsavedChangesGuard(isDirty: boolean) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isDirty) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const confirmThenNavigate = useCallback(
    async (to: string) => {
      if (isDirty) {
        await globalThis.shopify?.saveBar?.leaveConfirmation?.();
      }

      navigate(to);
    },
    [isDirty, navigate],
  );

  return { confirmThenNavigate };
}
