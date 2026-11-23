"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import * as rpc from "@/lib/supabase/rpc";

const ROLES = ["owner", "manager"] as const;
type Result = { ok: true } | { ok: false; error: string };

const reminderSchema = z.object({
  reminderDays: z.number().int().min(1, "Use at least 1 day").max(30, "Keep the reminder window to 30 days or less"),
});

const placeSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, "A place of work needs a name").max(60, "Keep the name to 60 characters"),
});

function reason(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  const clean = msg.replace(/^ERROR:\s*/i, "").split("\n")[0].trim();
  return clean.length > 0 && clean.length < 200 ? clean : fallback;
}

function done() {
  revalidatePath("/settings/appointments");
  revalidatePath("/appointments");
  revalidatePath("/jobs");
  revalidatePath("/sales/new");
}

export async function saveAppointmentReminderAction(input: z.input<typeof reminderSchema>): Promise<Result> {
  const ctx = await requireRole(...ROLES);
  const parsed = reminderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the reminder days" };

  const sb = await createClient();
  const { error } = await sb
    .from("business_settings")
    .update({ appointment_reminder_days: parsed.data.reminderDays })
    .eq("id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  done();
  return { ok: true };
}

export async function saveWorkPlaceAction(input: z.input<typeof placeSchema>): Promise<Result> {
  await requireRole(...ROLES);
  const parsed = placeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the place of work" };

  const sb = await createClient();
  try {
    await rpc.saveWorkPlace(sb, parsed.data);
  } catch (e) {
    return { ok: false, error: reason(e, "Could not save that place of work.") };
  }

  done();
  return { ok: true };
}

export async function deleteWorkPlaceAction(input: { id: string }): Promise<Result> {
  await requireRole(...ROLES);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown place of work." };

  const sb = await createClient();
  try {
    await rpc.deleteWorkPlace(sb, parsed.data.id);
  } catch (e) {
    return { ok: false, error: reason(e, "Could not delete that place of work.") };
  }

  done();
  return { ok: true };
}
