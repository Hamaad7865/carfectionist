"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";

const CONTACT_ROLES = ["owner", "manager", "cashier"] as const;
const SUPPLIER_ROLES = ["owner", "manager"] as const;
type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const opt = z.string().trim().optional().transform((v) => (v ? v : null));

// ── Customers ────────────────────────────────────────────────────────────────
const customerSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Name is required"),
  email: opt,
  phone: opt,
  address: opt,
  brn: opt,
  vatNumber: opt,
  notes: opt,
});

export async function saveCustomerAction(input: z.input<typeof customerSchema>): Promise<Result<{ id: string }>> {
  const ctx = await requireRole(...CONTACT_ROLES);
  const p = customerSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid customer" };
  const sb = await createClient();
  const row = {
    name: p.data.name,
    email: p.data.email,
    phone: p.data.phone,
    address: p.data.address,
    brn: p.data.brn,
    vat_number: p.data.vatNumber,
    notes: p.data.notes,
  };
  if (p.data.id) {
    const { error } = await sb.from("customers").update(row).eq("id", p.data.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/contacts");
    return { ok: true, data: { id: p.data.id } };
  }
  const { data, error } = await sb.from("customers").insert({ tenant_id: ctx.tenantId, ...row }).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contacts");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: true, data: { id: (data as any).id } };
}

// ── Vehicles ─────────────────────────────────────────────────────────────────
const vehicleSchema = z.object({
  id: z.string().optional(),
  customerId: z.string().min(1),
  plate: z.string().trim().min(1, "Plate is required"),
  make: opt,
  model: opt,
  year: z.union([z.number(), z.string()]).optional().transform((v) => {
    if (v === undefined || v === "" || v === null) return null;
    const n = typeof v === "number" ? v : parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }),
  color: opt,
  vin: opt,
});

export async function saveVehicleAction(input: z.input<typeof vehicleSchema>): Promise<Result<{ id: string }>> {
  const ctx = await requireRole(...CONTACT_ROLES);
  const p = vehicleSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid vehicle" };
  const sb = await createClient();
  const row = { plate: p.data.plate, make: p.data.make, model: p.data.model, year: p.data.year, color: p.data.color, vin: p.data.vin };
  if (p.data.id) {
    const { error } = await sb.from("vehicles").update(row).eq("id", p.data.id);
    if (error) return { ok: false, error: friendlyPlate(error.message) };
    revalidatePath("/contacts");
    return { ok: true, data: { id: p.data.id } };
  }
  const { data, error } = await sb.from("vehicles").insert({ tenant_id: ctx.tenantId, customer_id: p.data.customerId, ...row }).select("id").single();
  if (error) return { ok: false, error: friendlyPlate(error.message) };
  revalidatePath("/contacts");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: true, data: { id: (data as any).id } };
}

export async function deleteVehicleAction(id: string): Promise<Result> {
  await requireRole(...CONTACT_ROLES);
  const sb = await createClient();
  const { error } = await sb.from("vehicles").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contacts");
  return { ok: true };
}

function friendlyPlate(msg: string): string {
  return /duplicate key|unique/i.test(msg) ? "A vehicle with that plate already exists." : msg;
}

// ── Suppliers ────────────────────────────────────────────────────────────────
const supplierSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Name is required"),
  email: opt,
  phone: opt,
  address: opt,
  brn: opt,
  vatNumber: opt,
  notes: opt,
});

export async function saveSupplierAction(input: z.input<typeof supplierSchema>): Promise<Result<{ id: string }>> {
  const ctx = await requireRole(...SUPPLIER_ROLES);
  const p = supplierSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid supplier" };
  const sb = await createClient();
  const row = {
    name: p.data.name,
    email: p.data.email,
    phone: p.data.phone,
    address: p.data.address,
    brn: p.data.brn,
    vat_number: p.data.vatNumber,
    notes: p.data.notes,
  };
  if (p.data.id) {
    const { error } = await sb.from("suppliers").update(row).eq("id", p.data.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/contacts");
    return { ok: true, data: { id: p.data.id } };
  }
  const { data, error } = await sb.from("suppliers").insert({ tenant_id: ctx.tenantId, ...row }).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/contacts");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok: true, data: { id: (data as any).id } };
}
