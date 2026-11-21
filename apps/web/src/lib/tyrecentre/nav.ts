import {
  BarChart3,
  Banknote,
  CarFront,
  FileText,
  LayoutGrid,
  Lock,
  Package,
  ShoppingCart,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { NAV, effectiveModules, type Role } from "@/lib/auth/roles";

/** What a row's badge counts — filled in from the live shell status. */
export type BadgeKind = "readyJobs" | "unpaidInvoices" | "lowStock";

export interface TcNavLink {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  kbd?: string;
  badge?: BadgeKind;
  chevron?: boolean;
  children?: { key: string; label: string; href: string; badge?: BadgeKind }[];
}

export interface TcNav {
  shopFloor: TcNavLink[];
  till: TcNavLink[];
  /** Modules the design's menu has no row for. Never dropped: a module the user may
   *  open stays reachable, folded under "More". */
  more: TcNavLink[];
  settings: TcNavLink | null;
}

const NEW_SALE_HREF = "/sales/counter";

/** The tyre-centre sidebar (DESIGN-SPEC §6.1), cut to what this user's role and modules
 *  allow — the same rule the Carfectionist sidebar uses (navForUser). Each row names the
 *  module it opens; the route layouts and RLS enforce it again. */
export function tyreCentreNav(role: Role, modules: string[] | null | undefined): TcNav {
  const allowed = new Set(effectiveModules(role, modules));
  const can = (href: string) => allowed.has(href);
  const tillRoles: Role[] = ["owner", "manager"];

  const shopFloor: TcNavLink[] = [];
  shopFloor.push({ key: "overview", label: "Overview", href: "/dashboard", icon: LayoutGrid });
  if (can("/sales")) shopFloor.push({ key: "new-sale", label: "New sale", href: NEW_SALE_HREF, icon: ShoppingCart, kbd: "F2" });
  if (can("/jobs")) shopFloor.push({ key: "jobs", label: "Jobs", href: "/jobs", icon: Wrench, badge: "readyJobs" });
  if (can("/contacts")) shopFloor.push({ key: "customers", label: "Customers & cars", href: "/contacts", icon: CarFront });
  if (can("/sales")) {
    shopFloor.push({
      key: "documents",
      label: "Documents",
      href: "/sales",
      icon: FileText,
      children: [
        { key: "quotes", label: "Quotes", href: "/sales?type=quote" },
        { key: "invoices", label: "Invoices", href: "/sales?type=invoice", badge: "unpaidInvoices" },
        // Credit notes are kept with the archived paperwork (queries/documents.ts).
        { key: "credit-notes", label: "Credit notes", href: "/sales?view=archived&type=credit_note" },
      ],
    });
  }
  if (can("/products")) shopFloor.push({ key: "stock", label: "Tyre stock", href: "/products", icon: Package, badge: "lowStock" });
  if (can("/reports")) shopFloor.push({ key: "reports", label: "Reports", href: "/reports", icon: BarChart3, chevron: true });

  const till: TcNavLink[] =
    tillRoles.includes(role) && can("/point-of-sale")
      ? [
          { key: "drawer", label: "Cash drawer", href: "/point-of-sale", icon: Banknote },
          { key: "close-day", label: "Close the day", href: "/point-of-sale", icon: Lock },
        ]
      : [];

  const covered = new Set(["/dashboard", "/sales", "/jobs", "/contacts", "/products", "/reports", "/point-of-sale", "/settings"]);
  const more: TcNavLink[] = NAV.filter((n) => !covered.has(n.href) && can(n.href)).map((n) => ({
    key: n.href,
    label: n.label,
    href: n.href,
    icon: n.icon,
  }));

  const settings = can("/settings") ? { key: "settings", label: "Settings", href: "/settings", icon: SlidersHorizontal } : null;

  return { shopFloor, till, more, settings };
}

/** Which row a pathname belongs to. New sale lives under /sales but is its own row. */
export function isActiveHref(pathname: string, href: string): boolean {
  const path = href.split("?")[0];
  if (path === "/sales" && pathname.startsWith(NEW_SALE_HREF)) return false;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function isNewSalePath(pathname: string): boolean {
  return pathname === NEW_SALE_HREF || pathname.startsWith(`${NEW_SALE_HREF}/`);
}

export { NEW_SALE_HREF };
