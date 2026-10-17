/**
 * Light / dark theme for the signed-in back office.
 *
 * The choice lives in this browser (localStorage), not on the account: the
 * reception PC and the owner's laptop can differ. No choice yet = light, the
 * design the shop signed off. The theme is the `data-theme` attribute on
 * <html>, which globals.css keys every colour token off.
 */
export type Theme = "light" | "dark";

export const THEME_KEY = "theme";
export const THEME_EVENT = "themechange";

export function parseTheme(value: string | null | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

/** Runs before first paint (inline in the app layout) so a dark-mode user never
 *  sees a white flash. Must stay dependency-free: it is shipped as a string. */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export function currentTheme(): Theme {
  return parseTheme(document.documentElement.dataset.theme);
}

export function applyTheme(theme: Theme): void {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage blocked — the theme still applies for this visit */
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Same as THEME_INIT_SCRIPT, for a client-side entry into the back office. */
export function restoreSavedTheme(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    /* storage blocked — light */
  }
  if (parseTheme(saved) === "dark") document.documentElement.dataset.theme = "dark";
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Leaving the back office (sign-out → login) drops the theme without
 *  forgetting the choice: public and printed pages are always light. */
export function clearAppliedTheme(): void {
  delete document.documentElement.dataset.theme;
  window.dispatchEvent(new Event(THEME_EVENT));
}
