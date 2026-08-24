"use client";

import { useEffect } from "react";
import { THEME_STORAGE_KEY } from "@fairchild/folio/theme";

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/**
 * Same `d` as the other cells, reaching Folio's mechanism rather than
 * next-themes': the package writes `data-theme` on `<html>` before first paint
 * and remembers the choice under its own storage key, and the ◐ in the masthead
 * is already wired to it. What isn't exported is the hook behind that button —
 * `useThemeToggle` stays internal — so a host that wants the same flip from a
 * keypress writes these six lines against the two constants that are.
 */
export function ThemeHotkey() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key.toLowerCase() !== "d") {
        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      const next =
        document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Private mode etc. — the flip still holds for this page view.
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
