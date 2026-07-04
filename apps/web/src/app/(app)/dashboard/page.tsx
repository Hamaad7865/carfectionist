import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/auth/roles";

async function counts() {
  const supabase = await createClient();
  const [services, stocked, locations, team] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("kind", "service"),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("is_stocked", true),
    supabase.from("stock_locations").select("id", { count: "exact", head: true }),
    supabase.from("app_users").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);
  return {
    services: services.count ?? 0,
    stocked: stocked.count ?? 0,
    locations: locations.count ?? 0,
    team: team.count ?? 0,
  };
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="edge-hi rounded-xl border border-graphite-700 bg-graphite-900 p-5">
      <p className="text-[11px] uppercase tracking-[0.14em] text-graphite-500">{label}</p>
      <p className="num mt-2 text-2xl text-graphite-100">{value}</p>
      <p className="mt-1 text-[11px] text-graphite-500">{note}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const ctx = await getSessionContext();
  const name = (ctx?.displayName ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
  const c = await counts();

  return (
    <div className="p-8">
      <div className="mx-auto max-w-5xl">
        <p className="text-[11px] uppercase tracking-[0.15em] text-graphite-500">Dashboard</p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-graphite-100">
          Welcome{name ? `, ${name}` : ""}
        </h2>
        <p className="mt-1.5 text-sm text-graphite-400">
          Signed in as {ctx ? ROLE_LABEL[ctx.role] : ""}. Live figures below read straight from the
          database through row-level security.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile label="Catalogue services" value={String(c.services)} note="active" />
          <Tile label="Stocked products" value={String(c.stocked)} note="tracked in inventory" />
          <Tile label="Stock locations" value={String(c.locations)} note="storeroom + shop floor" />
          <Tile label="Team members" value={String(c.team)} note="active logins" />
        </div>

        <div className="mt-6 flex items-center gap-3 rounded-xl border border-teal-deep/30 bg-teal-deep/10 px-5 py-4">
          <span className="size-2 shrink-0 rounded-full bg-teal shadow-[0_0_8px] shadow-teal/70" />
          <p className="text-sm text-graphite-300">
            <span className="font-medium text-graphite-100">Phase 0 foundation is live.</span>{" "}
            Turnover, payments collected, outstanding and best-sellers activate with the money path
            (Phase 1) and dashboard reporting (Phase 2).
          </p>
        </div>
      </div>
    </div>
  );
}
