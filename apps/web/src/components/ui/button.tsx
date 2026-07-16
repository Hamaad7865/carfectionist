// The one place a button's look is decided.
//
// Before this, ~174 hand-rolled class strings across 57 files had drifted into
// six different heights — the invoice header literally sat h-9 buttons beside
// h-[38px] ones — and almost nothing said `whitespace-nowrap`, so a squeezed
// row wrapped LABELS mid-text ("Email / WhatsApp" onto two lines) instead of
// wrapping buttons as whole units. That's the "buttons appearing not genuine"
// the owner screenshotted.
//
// A class-string builder rather than a component on purpose: call sites are a
// mix of <button>, <a>, <Link> and <label>, and the codebase idiom is exported
// class constants (inputCls in ui/form.tsx). Keep the element, swap the string.
//
// The look is today's design language systematised — same colours, same
// radii — not a restyle. Rules every button now gets for free:
//   • whitespace-nowrap + shrink-0 — a label NEVER breaks mid-text; when a row
//     runs out of room, the ROW wraps (give it flex-wrap), not the words
//   • a visible focus ring, and one disabled treatment
//   • one height per size, so neighbours always line up

export type BtnVariant = "primary" | "ghost" | "subtle" | "danger" | "quiet";
export type BtnSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand " +
  "disabled:opacity-50 disabled:pointer-events-none";

const VARIANT: Record<BtnVariant, string> = {
  /** The one action the screen is for. Ration it — one per row. */
  primary: "grad-brand shadow-brand font-bold text-white",
  /** The standard workhorse: white card face, brand border on hover. */
  ghost: "border border-line-2 bg-card font-semibold text-body hover:border-brand",
  /** Ghost on a card — sits on bg-sub so it doesn't melt into a white panel. */
  subtle: "border border-line-2 bg-sub font-semibold text-body hover:border-brand",
  /** Destructive or money-reversing: credit note, void, delete. */
  danger: "border border-[rgba(255,84,104,0.35)] bg-card font-bold text-pink hover:bg-[rgba(255,84,104,0.06)]",
  /** Cancel/dismiss — text only, no box competing with the real action. */
  quiet: "font-semibold text-muted hover:text-body",
};

const SIZE: Record<BtnSize, string> = {
  sm: "h-8 rounded-[9px] px-2.5 text-[12px]",
  md: "h-9 rounded-[10px] px-3 text-[13px]",
  lg: "h-10 rounded-[11px] px-4 text-[13px]",
};

export function btn(variant: BtnVariant = "ghost", size: BtnSize = "md", extra = ""): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]}${extra ? ` ${extra}` : ""}`;
}

/** Base + size with NO variant — for the handful of solid-colour modal CTAs
 *  (bg-rose "Void it", bg-pink "Credit it", bg-amber "Hand over") whose colour
 *  IS the message. They still get nowrap/focus/disabled/height for free; the
 *  caller supplies the colour. Everything else should use btn(). */
export function btnBase(size: BtnSize = "md", extra = ""): string {
  return `${BASE} ${SIZE[size]}${extra ? ` ${extra}` : ""}`;
}
