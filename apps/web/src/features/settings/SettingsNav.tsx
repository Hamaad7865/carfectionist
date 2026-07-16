import Link from "next/link";

const ITEMS = [
  { key: "business", label: "Business profile", href: "/settings" },
  { key: "templates", label: "Document template", href: "/settings/templates" },
  { key: "team", label: "Team & roles", href: "/settings/team" },
  { key: "locations", label: "Stock locations", href: "/settings/locations" },
  { key: "whatsapp", label: "WhatsApp", href: "/settings/whatsapp" },
];

export function SettingsNav({ active }: { active: string }) {
  return (
    <div className="mb-6 flex flex-wrap gap-1.5 border-b border-line pb-4">
      {ITEMS.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className={`inline-flex h-9 items-center justify-center rounded-[10px] px-3.5 text-[13px] font-bold ${active === i.key ? "grad-brand shadow-brand text-white" : "border border-line-2 bg-card text-body hover:border-brand"}`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}
