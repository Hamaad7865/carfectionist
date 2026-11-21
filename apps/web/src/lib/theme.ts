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

/** The tyre-centre brand's startup script: an explicit choice wins, and with none the
 *  computer's own light/dark setting decides. Dependency-free, shipped as a string. */
export const THEME_INIT_SCRIPT_SYSTEM = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.dataset.theme="dark"}catch(e){}`;

/** What the user picked: a theme, or "system" (no saved choice — follow the computer). */
export type ThemeChoice = Theme | "system";

export function savedChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "dark" || v === "light" ? v : "system";
  } catch {
    return "system";
  }
}

/** The theme a choice comes to, given the computer's setting. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): Theme {
  return choice === "system" ? (prefersDark ? "dark" : "light") : choice;
}

const prefersDark = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;

/** Tyre centre: apply a choice ("system" forgets the saved one and follows the computer). */
export function applyThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* storage blocked — the theme still applies for this visit */
  }
  if (resolveTheme(choice, prefersDark()) === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  window.dispatchEvent(new Event(THEME_EVENT));
}

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

/** Same as THEME_INIT_SCRIPT, for a client-side entry into the back office. With
 *  `followSystem` (tyre centre) no saved choice means the computer's setting. */
export function restoreSavedTheme(followSystem = false): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    /* storage blocked — light */
  }
  const dark = followSystem ? resolveTheme(saved === "dark" || saved === "light" ? saved : "system", prefersDark()) === "dark" : parseTheme(saved) === "dark";
  if (dark) document.documentElement.dataset.theme = "dark";
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Leaving the back office (sign-out → login) drops the theme without
 *  forgetting the choice: public and printed pages are always light. */
export function clearAppliedTheme(): void {
  delete document.documentElement.dataset.theme;
  window.dispatchEvent(new Event(THEME_EVENT));
}
