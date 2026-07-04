/** Ceramic-gem mark + wordmark. The rotated iridescent diamond nods to the
 *  Diamondbrite coating; used in the sidebar and on the login screen. */
export function Brand({ showWordmark = true }: { showWordmark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative grid size-7 place-items-center">
        <span className="iris-rail absolute inset-0 rotate-45 rounded-[6px] opacity-90" />
        <span className="absolute inset-[3px] rotate-45 rounded-[3px] bg-graphite-950" />
        <span className="relative size-1.5 rounded-full bg-teal shadow-[0_0_8px] shadow-teal/70" />
      </span>
      {showWordmark && (
        <span className="font-display text-sm font-bold tracking-[0.18em] text-graphite-100">
          CARFECTIONIST
        </span>
      )}
    </div>
  );
}
