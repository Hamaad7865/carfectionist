import { getSessionContext } from "@/lib/auth/session";
import { getLocationsAdmin } from "@/lib/supabase/queries/stock-locations";
import { SettingsNav } from "@/features/settings/SettingsNav";
import { LocationsPanel } from "@/features/settings/LocationsPanel";

export default async function LocationsSettingsPage() {
  const [session, locations] = await Promise.all([getSessionContext(), getLocationsAdmin()]);
  // Everyone may look — the rest of the app already shows locations on every
  // transfer. Only owners and managers may change them, and the RPC, not this
  // flag, is what actually enforces that.
  const canManage = session?.role === "owner" || session?.role === "manager";

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <SettingsNav active="locations" />
        <h2 className="font-display text-[20px] font-extrabold text-ink-strong">Stock locations</h2>
        <p className="mt-1 text-[13px] text-muted">
          {canManage
            ? "Everywhere stock sits. One location is the default — where stock lands when nobody names one — and one is the till's floor, which counter sales debit."
            : "Everywhere stock sits. Only an owner or manager can add or change them."}
        </p>
        <div className="mt-6">
          <LocationsPanel locations={locations} canManage={canManage} />
        </div>
      </div>
    </div>
  );
}
