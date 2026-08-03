"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import * as rpc from "@/lib/supabase/rpc";

type Result = { ok: true } | { ok: false; error: string };

// Power off = close the device's till for the day (the owner's chosen meaning).
// counted cash is required because close_cash_session derives expected/variance.
const powerOffSchema = z.object({ sessionId: z.string(), countedCents: z.number().int().nonnegative() });
export async function powerOffAction(input: z.infer<typeof powerOffSchema>): Promise<Result> {
  await requireRole("owner", "manager");
  const p = powerOffSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid count" };
  const sb = await createClient();
  try {
    await rpc.closeCashSession(sb, p.data.sessionId, p.data.countedCents / 100);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/point-of-sale");
  return { ok: true };
}

const renameSchema = z.object({ deviceId: z.string(), name: z.string().max(60) });
export async function renameDeviceAction(input: z.infer<typeof renameSchema>): Promise<Result> {
  await requireRole("owner", "manager");
  const p = renameSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid name" };
  const sb = await createClient();
  try {
    await rpc.renameDevice(sb, p.data.deviceId, p.data.name);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/point-of-sale");
  return { ok: true };
}

const activeSchema = z.object({ deviceId: z.string(), active: z.boolean() });
export async function setDeviceActiveAction(input: z.infer<typeof activeSchema>): Promise<Result> {
  await requireRole("owner", "manager");
  const p = activeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid input" };
  const sb = await createClient();
  try {
    await rpc.setDeviceActive(sb, p.data.deviceId, p.data.active);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/point-of-sale");
  return { ok: true };
}

// Quotation-only terminals (reception's tablet): the RPC refuses the switch while
// the device still holds an open session, and its message is the useful one —
// surface it rather than a generic failure.
const takesPaymentsSchema = z.object({ deviceId: z.string(), takesPayments: z.boolean() });
export async function setDeviceTakesPaymentsAction(input: z.infer<typeof takesPaymentsSchema>): Promise<Result> {
  await requireRole("owner", "manager");
  const p = takesPaymentsSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid input" };
  const sb = await createClient();
  try {
    await rpc.setDeviceTakesPayments(sb, p.data.deviceId, p.data.takesPayments);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/point-of-sale");
  return { ok: true };
}

// Petty cash out of an open till (Cashmag's "Autre" outflow rows). The RPC
// enforces the real rules: open session, positive amount, reason, ≤ drawer.
const cashOutSchema = z.object({
  sessionId: z.string(),
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().nullable().optional(),
});
export async function tillCashOutAction(input: z.infer<typeof cashOutSchema>): Promise<Result> {
  await requireRole("owner", "manager");
  const p = cashOutSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Enter an amount and a reason." };
  const sb = await createClient();
  try {
    await rpc.recordTillCashOut(sb, p.data.sessionId, p.data.amountCents / 100, p.data.reason, p.data.idempotencyKey ?? null);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/point-of-sale");
  return { ok: true };
}

const periodSchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export async function closePeriodAction(input: z.infer<typeof periodSchema>): Promise<Result> {
  await requireRole("owner"); // RPC enforces owner again
  const p = periodSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid period" };
  const sb = await createClient();
  try {
    await rpc.closePeriod(sb, p.data.period);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/point-of-sale");
  return { ok: true };
}
