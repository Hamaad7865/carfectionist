import Link from "next/link";
import { getBrand } from "@/lib/brand-server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/session";
import { hasWhatsApp } from "@/lib/auth/roles";

const ITEMS = [
  { key: "business", label: "Business profile", href: "/settings" },
  { key: "companies", label: "Companies", href: "/settings/companies" },
  { key: "pos-rules", label: "POS rules", href: "/settings/pos-rules" },
  { key: "templates", label: "Document template", href: "/settings/templates" },
  { key: "team", label: "Team & roles", href: "/settings/team" },
  { key: "locations", label: "Stock locations", href: "/settings/locations" },
  { key: "whatsapp", label: "WhatsApp", href: "/settings/whatsapp" },
];

/** "Companies" shows only where it means something: the tyre-centre site, or any shop that
 *  already bills under more than one company. A one-company shop's settings look as before. */
async function showCompanies(active: string): Promise<boolean> {
  if (active === "companies") return true;
  if (((await getBrand()).key as string) === "tyrecentre") return true;
  const sb = await createClient();
  const { count } = await sb.from("legal_entities").select("id", { count: "exact", head: true }).eq("is_active", true);
  return (count ?? 0) > 1;
}

export async function SettingsNav({ active }: { active: string }) {
  const [companies, session] = await Promise.all([showCompanies(active), getSessionContext()]);
  // The WhatsApp number is Carfectionist's; a shop without WhatsApp has no tab for it.
  const whatsapp = hasWhatsApp(session?.tenantId);
  return (
    <div className="mb-6 flex flex-wrap gap-1.5 border-b border-line pb-4">
      {ITEMS.filter((i) => (i.key !== "companies" || companies) && (i.key !== "whatsapp" || whatsapp)).map((i) => (
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
