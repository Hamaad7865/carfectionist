"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, currentTheme, THEME_EVENT, type Theme } from "@/lib/theme";

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

/** Sun / moon switch in the topbar. Shows what a click will switch TO. */
export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme>(subscribe, currentTheme, () => "light");
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => applyTheme(next)}
      aria-label={next === "dark" ? "Switch to dark mode" : "Switch to light mode"}
      title={next === "dark" ? "Dark mode" : "Light mode"}
      className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-line-2 bg-card text-muted transition-colors hover:text-body md:size-[38px]"
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
