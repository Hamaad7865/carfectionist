import { CARFECTIONIST, type BrandInfo } from "@/lib/brand";

/** The brand mark — logo banner (or a text wordmark for brands with no logo file).
 *  Shared by the sidebar, login and enquiry pages so the brand is identical everywhere.
 *  Pass `brand` from the server (getBrand); it defaults to Carfectionist. */
export function Brand({
  showWordmark = true,
  subtitle = "BACK OFFICE",
  brand = CARFECTIONIST,
}: {
  showWordmark?: boolean;
  subtitle?: string;
  brand?: BrandInfo;
}) {
  return (
    <div className="inline-flex flex-col gap-1.5">
      {brand.logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={brand.logoSrc}
          alt={brand.name}
          width={500}
          height={62}
          className="block h-auto w-[184px] rounded-[8px]"
        />
      ) : (
        <span
          role="img"
          aria-label={brand.name}
          className="flex h-[46px] w-[184px] items-center justify-center rounded-[8px] bg-linear-to-br from-[#2b8cff] to-[#4a6cff] font-display text-[19px] font-extrabold tracking-wide text-white"
        >
          HAZ <span className="ml-1.5 font-semibold opacity-90">Software</span>
        </span>
      )}
      {showWordmark && subtitle ? (
        <span className="pl-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{subtitle}</span>
      ) : null}
    </div>
  );
}
