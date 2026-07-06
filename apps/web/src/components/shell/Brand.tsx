/** Carfectionist logo (dark banner — carries the car mark + wordmark + tagline).
 *  Shared by the sidebar, login and enquiry pages so the brand is identical everywhere. */
export function Brand({ showWordmark = true, subtitle = "BACK OFFICE" }: { showWordmark?: boolean; subtitle?: string }) {
  return (
    <div className="inline-flex flex-col gap-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo.png"
        alt="Carfectionist"
        width={500}
        height={62}
        className="block h-auto w-[184px] rounded-[8px]"
      />
      {showWordmark && subtitle ? (
        <span className="pl-1 text-[8px] font-semibold uppercase tracking-[0.2em] text-fainter">{subtitle}</span>
      ) : null}
    </div>
  );
}
