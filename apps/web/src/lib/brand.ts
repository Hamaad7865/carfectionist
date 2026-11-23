/** Which brand the app presents. Chosen by the host the request came in on, so one
 *  Worker serves the Carfectionist shop on its own address and the HAZ Software demo
 *  on app.hazsoftware.com without either showing the other's name. Pure data — safe in
 *  server and client components; the host lookup lives in brand-server.ts. */
export type BrandInfo = {
  key: "carfectionist" | "haz" | "tyrecentre" | "shop";
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

/** The tyre-centre client (docs/redesign). Its own look, scoped by `data-brand` on <html>.
 *  The name is a placeholder until the owner names the shop; the sidebar shows the
 *  trading name from business_settings. */
export const TYRECENTRE: BrandInfo = {
  key: "tyrecentre",
  name: "Tyre Centre",
  logoSrc: null,
  loginBlurb: "Point of sale and back office for your tyre centre.",
  footer: "Tyre Centre · Mauritius · under HAZ Software",
  emailPlaceholder: "you@yourbusiness.mu",
  pageDescription: "Tyre Centre — point of sale and back office",
};

/** Hosts that present the tyre-centre brand. A subdomain of the HAZ demo until the owner buys
 *  a domain — swap it here. `tyrecentre.localhost` lets `next dev` show it locally. */
const TYRECENTRE_HOSTS = new Set(["tyrecentre.hazsoftware.com", "tyrecentre.localhost"]);

export function brandForHost(host: string | null | undefined): BrandInfo {
  const h = (host ?? "").toLowerCase().split(":")[0];
  if (TYRECENTRE_HOSTS.has(h)) return TYRECENTRE;
  return h === "hazsoftware.com" || h.endsWith(".hazsoftware.com") ? HAZ : CARFECTIONIST;
}

/** The Carfectionist shop and its TEST Sandbox: the only tenants that wear the Carfectionist brand. */
export const CARFECTIONIST_TENANTS: readonly string[] = [
  "11111111-1111-4111-8111-000000000001",
  "22222222-2222-4222-8222-000000000002",
];

/** The brand inside the app, once we know whose shop is signed in. Carfectionist's own tenants
 *  keep the host's brand; any other shop (the tyre centre) sees its own name as a text wordmark
 *  and nothing of Carfectionist, whichever address it signed in on. */
export function brandForShop(hostBrand: BrandInfo, tenantId: string, shopName: string | null | undefined): BrandInfo {
  if (CARFECTIONIST_TENANTS.includes(tenantId)) return hostBrand;
  const name = (shopName ?? "").trim() || (hostBrand.key === "tyrecentre" ? TYRECENTRE.name : HAZ.name);
  // On the tyre-centre address the shop keeps the tyre-centre look (data-brand), under its own name.
  const base = hostBrand.key === "tyrecentre" ? TYRECENTRE : { ...HAZ, key: "shop" as const };
  return { ...base, name, pageDescription: `${name} — point of sale and back office` };
}
