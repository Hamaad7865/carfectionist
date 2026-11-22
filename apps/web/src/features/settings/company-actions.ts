"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import * as rpc from "@/lib/supabase/rpc";

// Settings → Companies. Owner only — a company's identity and number series are fiscal facts.
// Every rule lives in save_legal_entity (numbering and VAT status fixed once it has issued, the
// default company edited in Business profile, no switching off while products are sold by it);
// this layer checks shape and relays the database's own sentence.

type Result = { ok: true } | { ok: false; error: string };

const opt = z.string().trim().max(200).optional().nullable();
const prefix = (what: string) =>
  z.string().trim().min(1, `A company needs its ${what} prefix`).max(12, `Keep the ${what} prefix under 12 characters`)
    .regex(/^[A-Za-z0-9-]+$/, `The ${what} prefix may hold letters, digits and dashes only`);
const next = z.number().int().min(1).max(9_999_999).optional().nullable();

const schema = z.object({
  id: z.string().uuid().nullable().optional(),
  legal_name: z.string().trim().min(1, "A company needs its legal name").max(200),
  trading_name: opt,
  brn: opt,
  vat_registered: z.boolean(),
  vat_number: opt,
  vat_rate: z.number().min(0).max(100).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  phone: opt,
  email: z.string().trim().max(200).optional().nullable()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "That email doesn't look right"),
  bank_account_name: opt,
  bank_account_number: opt,
  bank_name: opt,
  receipt_header_text: z.string().trim().max(500).optional().nullable(),
  receipt_footer_text: z.string().trim().max(500).optional().nullable(),
  quote_prefix: prefix("quote"),
  invoice_prefix: prefix("invoice"),
  credit_note_prefix: prefix("credit note"),
  quote_next_number: next,
  invoice_next_number: next,
  credit_note_next_number: next,
  is_active: z.boolean().optional().nullable(),
});

export type CompanyInput = z.infer<typeof schema>;

function reason(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  const clean = msg.replace(/^ERROR:\s*/i, "").split("\n")[0].trim();
  return clean.length > 0 && clean.length < 240 ? clean : fallback;
}

export async function saveCompanyAction(input: CompanyInput): Promise<Result> {
  await requireRole("owner");
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the details" };
  const prefixes = [p.data.quote_prefix, p.data.invoice_prefix, p.data.credit_note_prefix].map((x) => x.toUpperCase());
  if (new Set(prefixes).size < 3) return { ok: false, error: "Quotes, invoices and credit notes each need a different prefix." };
  const sb = await createClient();
  try {
    await rpc.saveLegalEntity(sb, { ...p.data, id: p.data.id ?? null });
  } catch (e) {
    return { ok: false, error: reason(e, "Could not save that company.") };
  }
  revalidatePath("/settings/companies");
  revalidatePath("/products");
  revalidatePath("/sales/counter");
  return { ok: true };
}
