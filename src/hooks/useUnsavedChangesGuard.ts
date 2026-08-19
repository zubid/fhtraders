import { useCallback, useRef } from "react";
import { useBlocker } from "@tanstack/react-router";

const MESSAGE = "You have unsaved changes. Leave this page and discard them?";

/** Protects dirty forms from both router navigation and browser refresh/close. */
export function useUnsavedChangesGuard(isDirty: boolean) {
  const navigationAllowed = useRef(false);

  useBlocker({
    shouldBlockFn: () =>
      isDirty && !navigationAllowed.current ? !window.confirm(MESSAGE) : false,
    enableBeforeUnload: () => isDirty && !navigationAllowed.current,
  });

  const allowNavigation = useCallback(() => {
    navigationAllowed.current = true;
  }, []);

  return { allowNavigation };
}
