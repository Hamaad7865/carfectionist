// Bespoke, per-icon sidebar animations. Each nav icon's own geometry does its
// own thing on hover — the certificate's tick draws in like a stamp, the
// report's bars grow, the settings gears turn, the truck delivers — rather
// than one generic scale applied to all fifteen. Paths are lifted verbatim
// from lucide-react (same icon set the rest of the app uses) so the RESTING
// glyph is pixel-identical to what shipped before; only hover adds motion.
// All CSS lives in globals.css under "Sidebar nav icons" and is skipped
// entirely under prefers-reduced-motion.

import type { ComponentType, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number };

function base(props: IconProps, extraClass: string) {
  const { size = 24, strokeWidth = 2, className = "", ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `${extraClass} ${className}`.trim(),
    ...rest,
  };
}

// Dashboard — the four tiles wake up in reading order, like a screen booting.
export function DashboardIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-dash")}>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  );
}

// Jobs — the checklist ticks itself off, top row then bottom.
export function JobsIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-jobs")}>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path className="row1" d="M12 11h4" pathLength={1} />
      <path className="row2" d="M12 16h4" pathLength={1} />
      <path className="row1" d="M8 11h.01" pathLength={1} />
      <path className="row2" d="M8 16h.01" pathLength={1} />
    </svg>
  );
}

// Appointments — the clock hand ticks forward one notch.
export function AppointmentsIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-cal")}>
      <path className="hand" d="M16 14v2.2l1.6 1" />
      <path d="M16 2v4" />
      <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" />
      <path d="M3 10h5" />
      <path d="M8 2v4" />
      <circle cx="16" cy="16" r="6" />
    </svg>
  );
}

// Contacts — the front person gives a small nod.
export function ContactsIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-users")}>
      <g className="front">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
      </g>
      <path d="M16 3.128a4 4 0 0 1 0 7.744" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  );
}

// Sales & Invoices — the lines print out top to bottom.
export function SalesIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-receipt")}>
      <path
        d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"
      />
      <path className="ln ln1" d="M14 8H8" pathLength={1} />
      <path className="ln ln2" d="M16 12H8" pathLength={1} />
      <path className="ln ln3" d="M13 16H8" pathLength={1} />
    </svg>
  );
}

// Products & Inventory — the box lands and settles, like being set on a shelf.
export function ProductsIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-pkg")}>
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
      <path d="M12 22V12" />
      <polyline points="3.29 7 12 12 20.71 7" />
      <path d="m7.5 4.27 9 5.15" />
    </svg>
  );
}

// Point of Sale — the handheld screen lights up.
export function PosIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-pos")}>
      <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8" />
      <path d="M10 19v-3.96 3.15" />
      <path d="M7 19h5" />
      <rect className="phone" width="6" height="10" x="16" y="12" rx="2" />
    </svg>
  );
}

// Certificates — the tick draws in like a stamp of approval (the ask).
export function CertificatesIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-cert")}>
      <path
        className="badge"
        d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
      />
      <path className="tick" d="m9 12 2 2 4-4" pathLength={1} />
    </svg>
  );
}

// Purchases & Expenses — the delivery truck rolls in.
export function PurchasesIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-truck")}>
      <g className="body">
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
        <path d="M15 18H9" />
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      </g>
      <circle className="wheel wheel1" cx="17" cy="18" r="2" />
      <circle className="wheel wheel2" cx="7" cy="18" r="2" />
    </svg>
  );
}

// Sales Journal — the ledger rules itself in, line by line. (lucide book-text)
export function SalesJournalIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-journal")}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
      <path className="rule rule1" d="M8 7h6" />
      <path className="rule rule2" d="M8 11h8" />
    </svg>
  );
}

// Accounting & Reports — the bars grow, left to right.
export function ReportsIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-chart")}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path className="bar bar1" d="M8 17v-3" />
      <path className="bar bar2" d="M13 17V5" />
      <path className="bar bar3" d="M18 17V9" />
    </svg>
  );
}

// Forms & Enquiries — a new letter drops into the tray.
export function EnquiriesIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-inbox")}>
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <polyline className="flap" points="22 12 16 12 14 15 10 15 8 12 2 12" />
    </svg>
  );
}

// Messages — a typing indicator blips, like a reply coming in.
export function MessagesIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-msg")}>
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
      <circle className="dot dot1" cx="8.3" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle className="dot dot2" cx="11.5" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle className="dot dot3" cx="14.7" cy="11" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Marketing — the megaphone broadcasts a couple of sound waves.
export function MarketingIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-mega")}>
      <path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      <path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14" />
      <path d="M8 6v8" />
      <path className="wave wave1" d="M22.5 7.5a7 7 0 0 1 0 5" />
      <path className="wave wave2" d="M24.2 5.8a10 10 0 0 1 0 8.4" />
    </svg>
  );
}

// Team & Settings — the gears turn while you're hovering.
export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-gear")}>
      <path d="M14 17H5" />
      <path d="M19 7h-9" />
      <circle className="gear gear1" cx="17" cy="17" r="3" />
      <circle className="gear gear2" cx="7" cy="7" r="3" />
    </svg>
  );
}

// Activity — the hand winds back, matching what "history" means.
export function ActivityIcon(props: IconProps) {
  return (
    <svg {...base(props, "nav-ic-hist")}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path className="hand" d="M12 7v5l4 2" />
    </svg>
  );
}

export const ANIMATED_NAV_ICONS: Record<string, ComponentType<IconProps>> = {
  "/dashboard": DashboardIcon,
  "/jobs": JobsIcon,
  "/appointments": AppointmentsIcon,
  "/contacts": ContactsIcon,
  "/sales": SalesIcon,
  "/products": ProductsIcon,
  "/point-of-sale": PosIcon,
  "/certificates": CertificatesIcon,
  "/purchases": PurchasesIcon,
  "/sales-journal": SalesJournalIcon,
  "/reports": ReportsIcon,
  "/enquiries": EnquiriesIcon,
  "/messages": MessagesIcon,
  "/marketing": MarketingIcon,
  "/settings": SettingsIcon,
  "/activity": ActivityIcon,
};
