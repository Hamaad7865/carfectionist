import {
  LayoutDashboard,
  ClipboardList,
  CalendarClock,
  Users,
  ReceiptText,
  Package,
  Truck,
  BarChart3,
  Inbox,
  BadgeCheck,
  Settings2,
  History,
  MonitorSmartphone,
  Megaphone,
  MessageCircle,
  BookText,
  type LucideIcon,
} from "lucide-react";

export type Role = "owner" | "manager" | "cashier" | "technician" | "accountant";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  technician: "Technician",
  accountant: "Accountant",
};

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
}

const ALL: Role[] = ["owner", "manager", "cashier", "technician", "accountant"];

// Sidebar order and per-role visibility. Cashier deliberately excludes
// Accounting & Reports (and Purchases/Settings) — enforced again at the
// route layout and by RLS.
export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ALL },
  { label: "Jobs", href: "/jobs", icon: ClipboardList, roles: ["owner", "manager", "cashier", "technician"] },
  { label: "Appointments", href: "/appointments", icon: CalendarClock, roles: ["owner", "manager", "cashier"] },
  { label: "Contacts", href: "/contacts", icon: Users, roles: ["owner", "manager", "cashier", "accountant"] },
  { label: "Sales & Invoices", href: "/sales", icon: ReceiptText, roles: ["owner", "manager", "cashier", "accountant"] },
  { label: "Products & Inventory", href: "/products", icon: Package, roles: ["owner", "manager", "cashier"] },
  { label: "Point of Sale", href: "/point-of-sale", icon: MonitorSmartphone, roles: ["owner", "manager"] },
  { label: "Certificates", href: "/certificates", icon: BadgeCheck, roles: ["owner", "manager", "cashier", "technician"] },
  { label: "Purchases & Expenses", href: "/purchases", icon: Truck, roles: ["owner", "manager", "accountant"] },
  { label: "Sales Journal", href: "/sales-journal", icon: BookText, roles: ["owner", "manager", "accountant"] },
  { label: "Accounting & Reports", href: "/reports", icon: BarChart3, roles: ["owner", "manager", "accountant"] },
  { label: "Forms & Enquiries", href: "/enquiries", icon: Inbox, roles: ["owner", "manager"] },
  { label: "Messages", href: "/messages", icon: MessageCircle, roles: ["owner", "manager", "cashier"] },
  { label: "Marketing", href: "/marketing", icon: Megaphone, roles: ["owner"] },
  { label: "Team & Settings", href: "/settings", icon: Settings2, roles: ["owner", "manager"] },
  { label: "Activity", href: "/activity", icon: History, roles: ["owner"] },
];

export function navForRole(role: Role): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role));
}

// ── Per-user module access ───────────────────────────────────────────────────
// A user's `modules` override (list of hrefs) narrows OR widens the role default.
// Owners are always full-access; Dashboard is always available to everyone.
export const ALWAYS_ON = ["/dashboard"];

/** The nav sections an owner can toggle per user (everything except Dashboard and
 *  owner-only sections like Activity, which no non-owner can be granted). */
export const TOGGLEABLE_MODULES = NAV.filter((n) => !ALWAYS_ON.includes(n.href) && n.roles.some((r) => r !== "owner")).map((n) => ({ href: n.href, label: n.label }));

export function defaultModulesForRole(role: Role): string[] {
  return NAV.filter((n) => n.roles.includes(role)).map((n) => n.href);
}

/** Effective set of allowed hrefs for a user. */
export function effectiveModules(role: Role, override: string[] | null | undefined): string[] {
  if (role === "owner") return NAV.map((n) => n.href); // owner = full access, always
  const base = override != null ? override : defaultModulesForRole(role); // [] = dashboard only
  return [...new Set([...ALWAYS_ON, ...base])];
}

export function hasModule(role: Role, override: string[] | null | undefined, href: string): boolean {
  if (role === "owner" || ALWAYS_ON.includes(href)) return true;
  return effectiveModules(role, override).includes(href);
}

export function navForUser(role: Role, override: string[] | null | undefined): NavItem[] {
  const allowed = new Set(effectiveModules(role, override));
  return NAV.filter((item) => allowed.has(item.href));
}

/** Best-matching nav label for a pathname (for the topbar title). */
export function titleForPath(pathname: string): string {
  const match = NAV.filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return match?.label ?? "Carfectionist";
}
