import { createClient } from "@/lib/supabase/server";

export interface WorkPlace {
  id: string;
  name: string;
}

export interface AppointmentSettings {
  workPlaces: WorkPlace[];
  reminderDays: number;
}

export async function getWorkPlaces(): Promise<WorkPlace[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("work_places")
    .select("id, name")
    .order("sort_order")
    .order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((place) => ({ id: place.id, name: place.name }));
}

export async function getAppointmentSettings(): Promise<AppointmentSettings> {
  const sb = await createClient();
  const [{ data: places }, { data: settings }] = await Promise.all([
    sb.from("work_places").select("id, name").order("sort_order").order("name"),
    sb.from("business_settings").select("appointment_reminder_days").limit(1).maybeSingle(),
  ]);

  // The fallback keeps the old build usable for the short migration-to-deploy
  // window; after the migration the stored tenant value is authoritative.
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workPlaces: ((places ?? []) as any[]).map((place) => ({ id: place.id, name: place.name })),
    reminderDays: Number(settings?.appointment_reminder_days ?? 3),
  };
}
