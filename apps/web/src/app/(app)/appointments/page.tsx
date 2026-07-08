import { getAppointments } from "@/lib/supabase/queries/appointments";
import { AppointmentsPanel } from "@/features/appointments/AppointmentsPanel";

export default async function AppointmentsPage() {
  const now = new Date().toISOString();
  const data = await getAppointments(now);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <h2 className="font-display text-[20px] font-extrabold text-ink-strong">Appointments</h2>
      <p className="-mt-2 text-[12.5px] text-muted">Book cars in, then turn an appointment into a job when it arrives.</p>
      <AppointmentsPanel data={data} />
    </div>
  );
}
