/** Which brand the app presents. Chosen by the host the request came in on, so one
 *  Worker serves the Carfectionist shop on its own address and the HAZ Software demo
 *  on app.hazsoftware.com without either showing the other's name. Pure data — safe in
 *  server and client components; the host lookup lives in brand-server.ts. */
export type BrandInfo = {
  key: "carfectionist" | "haz";
  /** Product / company name shown in titles and the top bar. */
  name: string;
  /** Logo image, or null to draw the text wordmark. */
  logoSrc: string | null;
  loginBlurb: string;
  footer: string;
  emailPlaceholder: string;
  pageDescription: string;
};

export const CARFECTIONIST: BrandInfo = {
  key: "carfectionist",
  name: "Carfectionist",
  logoSrc: "/brand/logo.png",
  loginBlurb: "Detailing studio management — back office.",
  footer: "Carfectionist · Mauritius · under Haz Software",
  emailPlaceholder: "you@carfectionist.mu",
  pageDescription: "Carfection — detailing studio management",
};

export const HAZ: BrandInfo = {
  key: "haz",
  name: "HAZ Software",
  logoSrc: null,
  loginBlurb: "Point of sale and back office for your business.",
  footer: "HAZ Software · Mauritius",
  emailPlaceholder: "you@yourbusiness.mu",
  pageDescription: "HAZ Software — point of sale and back-office management",
};

export function brandForHost(host: string | null | undefined): BrandInfo {
  const h = (host ?? "").toLowerCase().split(":")[0];
  return h === "hazsoftware.com" || h.endsWith(".hazsoftware.com") ? HAZ : CARFECTIONIST;
}
