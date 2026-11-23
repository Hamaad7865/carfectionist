"use client";

import { useCallback, useEffect, useRef } from "react";

const KEY = "__overlay";

/**
 * Phones: while a full-screen overlay is open (the More menu, phone search), the
 * back gesture closes it instead of leaving the page.
 *
 * Opening pushes one history entry for the same URL. Back pops it and `onClosed`
 * runs. Every other way out goes through the returned `dismiss`, which pops that
 * entry itself — and `dismiss(then)` runs `then` (say, a router.push) only once
 * the pop has landed, so a page picked from the overlay replaces nothing and the
 * next Back returns to where the user was, in one press.
 */
export function useBackToClose(open: boolean, onClosed: () => void) {
  const closedRef = useRef(onClosed);
  const entry = useRef<string | null>(null);
  const after = useRef<(() => void) | null>(null);

  useEffect(() => {
    closedRef.current = onClosed;
  });

  useEffect(() => {
    if (!open) return;
    const id = Math.random().toString(36).slice(2);
    const state = window.history.state ?? {};
    // Already standing on an overlay entry (React dev re-runs effects; Forward
    // after a Back lands on the old one): take it over instead of stacking a second.
    if (state[KEY]) window.history.replaceState({ ...state, [KEY]: id }, "");
    else window.history.pushState({ ...state, [KEY]: id }, "");
    entry.current = id;
    const onPop = () => {
      if (window.history.state?.[KEY] === id) return; // still on our entry
      entry.current = null;
      closedRef.current();
      const then = after.current;
      after.current = null;
      then?.();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      entry.current = null;
    };
  }, [open]);

  /** Close the overlay (popping its history entry), then optionally run `then`. */
  return useCallback((then?: () => void) => {
    const id = entry.current;
    if (id && window.history.state?.[KEY] === id) {
      after.current = then ?? null;
      window.history.back();
    } else {
      // Our entry is gone (a navigation replaced it) — just close.
      closedRef.current();
      then?.();
    }
  }, []);
}
