import { getSessionContext } from "@/lib/auth/session";
import { getAppointmentSettings } from "@/lib/supabase/queries/appointment-settings";
import { SettingsNav } from "@/features/settings/SettingsNav";
import { AppointmentSettingsPanel } from "@/features/settings/AppointmentSettingsPanel";

export default async function AppointmentSettingsPage() {
  const [session, settings] = await Promise.all([
    getSessionContext(),
    getAppointmentSettings(),
  ]);
  const canManage = session?.role === "owner" || session?.role === "manager";

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <SettingsNav active="appointments" />
        <h2 className="font-display text-[20px] font-extrabold text-ink-strong">Appointment settings</h2>
        <p className="mt-1 text-[13px] text-muted">
          Manage this tenant&apos;s places of work and choose how early upcoming bookings appear in the notification bell.
        </p>
        <div className="mt-6">
          <AppointmentSettingsPanel settings={settings} canManage={canManage} />
        </div>
      </div>
    </div>
  );
}
