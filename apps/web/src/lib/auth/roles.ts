import {
  LayoutDashboard,
  ClipboardList,
  Users,
  ReceiptText,
  Package,
  Truck,
  BarChart3,
  Inbox,
  Settings2,
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
  { label: "Contacts", href: "/contacts", icon: Users, roles: ["owner", "manager", "cashier", "accountant"] },
  { label: "Sales & Invoices", href: "/sales", icon: ReceiptText, roles: ["owner", "manager", "cashier", "accountant"] },
  { label: "Products & Inventory", href: "/products", icon: Package, roles: ["owner", "manager", "cashier"] },
  { label: "Purchases & Expenses", href: "/purchases", icon: Truck, roles: ["owner", "manager", "accountant"] },
  { label: "Accounting & Reports", href: "/reports", icon: BarChart3, roles: ["owner", "manager", "accountant"] },
  { label: "Forms & Enquiries", href: "/enquiries", icon: Inbox, roles: ["owner", "manager"] },
  { label: "Team & Settings", href: "/settings", icon: Settings2, roles: ["owner", "manager"] },
];

export function navForRole(role: Role): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role));
}

/** Best-matching nav label for a pathname (for the topbar title). */
export function titleForPath(pathname: string): string {
  const match = NAV.filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return match?.label ?? "Carfectionist";
}
