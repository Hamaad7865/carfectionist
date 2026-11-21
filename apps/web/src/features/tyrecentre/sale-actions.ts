"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { muDate } from "@/lib/mu-date";

export interface CarVisit {
  id: string;
  number: string | null;
  /** Mauritius date, yyyy-mm-dd. */
  date: string;
  summary: string;
  /** Catalogue lines on the bill — what "Add again" puts back in the cart. */
  lines: { productId: string; title: string; qty: number }[];
}

/** A car's last bills, newest first — the New sale "last visits" card. RLS-scoped. */
export async function getCarHistoryAction(vehicleId: string): Promise<CarVisit[]> {
  await requireRole("owner", "manager", "cashier");
  if (!z.string().uuid().safeParse(vehicleId).success) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("documents")
    .select("id, number, issued_at, document_lines(product_id, title, qty, sort_order)")
    .eq("vehicle_id", vehicleId)
    .eq("doc_type", "invoice")
    .in("status", ["issued", "partly_paid", "paid"])
    .not("issued_at", "is", null)
    .order("issued_at", { ascending: false })
    .limit(5);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = ((d.document_lines ?? []) as any[]).sort((a, b) => a.sort_order - b.sort_order);
    return {
      id: d.id,
      number: d.number,
      date: muDate(d.issued_at),
      summary: lines.map((l) => l.title).join(" · "),
      lines: lines.filter((l) => l.product_id).map((l) => ({ productId: l.product_id, title: l.title, qty: Number(l.qty) })),
    };
  });
}
