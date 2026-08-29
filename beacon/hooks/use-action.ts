"use client";

import { useCallback } from "react";
import { toast } from "sonner";

/**
 * Runs an action that resolves to its success message, toasts the outcome and calls `after` on
 * success (usually a refresh). Returns whether it succeeded.
 */
export function useAction(after?: () => void) {
  return useCallback(
    async (fn: () => Promise<string>, refresh = true) => {
      try {
        toast.success(await fn());
        if (refresh) after?.();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed");
        return false;
      }
    },
    [after],
  );
}
