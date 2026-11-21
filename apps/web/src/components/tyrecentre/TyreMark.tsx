/** The tyre-centre logo glyph: a tyre seen side-on, drawn in currentColor. */
export function TyreGlyph({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="2" />
      <path d="M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** The black rounded square holding the glyph — sidebar header, nav rail, login. */
export function TyreMark({ size = 32, radius = 8 }: { size?: number; radius?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center bg-[#0f1720] text-white"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <TyreGlyph size={Math.round(size * 0.56)} />
    </span>
  );
}
