import { createClient } from "@/lib/supabase/server";
import { rupeesToCents, formatMUR } from "@/lib/money";

export type ActivityTone = "sale" | "money" | "stock" | "cash" | "job" | "admin" | "warn" | "neutral" | "auth";
export type ActivityCategory = "sales" | "payments" | "stock" | "cash" | "jobs" | "admin" | "catalogue" | "auth";

export interface ActivityEvent {
  id: string;
  at: string; // ISO
  actorId: string | null;
  actorName: string;
  kind: string;
  category: ActivityCategory;
  title: string;
  detail: string;
  amountCents: number | null;
  href: string | null;
  tone: ActivityTone;
}
export interface ActivityFilters { from?: string; to?: string; actor?: string; category?: string; }
export interface ActivityData {
  events: ActivityEvent[];
  actors: { id: string; name: string }[];
  capped: boolean;
}

export const ACTIVITY_CATEGORIES: { key: ActivityCategory; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "payments", label: "Payments" },
  { key: "stock", label: "Stock" },
  { key: "cash", label: "Cash-up" },
  { key: "jobs", label: "Jobs" },
  { key: "catalogue", label: "Catalogue" },
  { key: "admin", label: "Staff & admin" },
  { key: "auth", label: "Sign-ins" },
];

const MU = "+04:00";
const dayStart = (d: string) => `${d}T00:00:00${MU}`;
const dayEnd = (d: string) => `${d}T23:59:59.999${MU}`;
const METHOD: Record<string, string> = { cash: "cash", card: "card", juice: "Juice", bank_transfer: "bank transfer" };
const strip = (n: string | null | undefined) => (n ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
const qtyFmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const PER = 200;
const CAP = 300;

export async function getActivity(f: ActivityFilters): Promise<ActivityData> {
  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const range = (col: string, q: any) => {
    if (f.from) q = q.gte(col, dayStart(f.from));
    if (f.to) q = q.lte(col, dayEnd(f.to));
    return q;
  };

  const [usersRes, locRes, docRes, payRes, auditRes, adjRes, refMvRes, transRes, cashRes, jobRes, poRes, certRes] = await Promise.all([
    sb.from("app_users").select("id, display_name"),
    sb.from("stock_locations").select("id, name"),
    range("issued_at", sb.from("documents").select("id, number, doc_type, total_incl, issued_at, created_by, issued_by, customers(name)").not("issued_at", "is", null).in("doc_type", ["invoice", "quote"])).order("issued_at", { ascending: false }).limit(PER),
    range("received_at", sb.from("payments").select("id, amount, method, received_at, received_by, document_id, documents(number)").is("reverses_payment_id", null)).order("received_at", { ascending: false }).limit(PER),
    range("created_at", sb.from("audit_events").select("id, event_type, actor_id, ref_type, ref_id, payload, created_at")).order("created_at", { ascending: false }).limit(PER),
    range("moved_at", sb.from("stock_movements").select("id, qty, note, moved_at, created_by, products(name, unit), stock_locations(name)").eq("ref_type", "adjustment")).order("moved_at", { ascending: false }).limit(PER),
    range("moved_at", sb.from("stock_movements").select("ref_id, created_by").in("ref_type", ["purchase_order", "job_card"])).order("moved_at", { ascending: false }).limit(500),
    sb.from("stock_transfers").select("id, from_location_id, to_location_id, dispatched_at, dispatched_by, received_at, received_by, created_at").neq("status", "draft").order("created_at", { ascending: false }).limit(PER),
    sb.from("cash_sessions").select("id, opened_at, opened_by, closed_at, closed_by, variance, device_id").order("opened_at", { ascending: false }).limit(PER),
    sb.from("jobs").select("id, created_at, created_by, ready_at, completed_by, vehicles(plate, make, model)").order("created_at", { ascending: false }).limit(PER),
    range("received_at", sb.from("purchase_orders").select("id, reference, received_at, suppliers(name)").not("received_at", "is", null)).order("received_at", { ascending: false }).limit(PER),
    range("created_at", sb.from("certificates").select("id, number, created_at, created_by, customers(name)")).order("created_at", { ascending: false }).limit(PER),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const nameById = new Map<string, string>(((usersRes.data ?? []) as any[]).map((u) => [u.id, strip(u.display_name)]));
  const nm = (id: string | null): string => (id ? nameById.get(id) ?? "—" : "—");
  const locById = new Map<string, string>(((locRes.data ?? []) as any[]).map((l) => [l.id, l.name]));
  const refActor = new Map<string, string | null>();
  for (const m of (refMvRes.data ?? []) as any[]) if (m.ref_id && !refActor.has(m.ref_id)) refActor.set(m.ref_id, m.created_by ?? null);

  const events: ActivityEvent[] = [];

  for (const d of (docRes.data ?? []) as any[]) {
    const isQuote = d.doc_type === "quote";
    events.push({
      id: `doc-${d.id}`, at: d.issued_at, actorId: d.issued_by ?? d.created_by, actorName: nm(d.issued_by ?? d.created_by),
      kind: isQuote ? "quote_issued" : "sale_issued", category: "sales",
      title: `${isQuote ? "Quote" : "Invoice"} ${d.number ?? ""} issued`.trim(),
      detail: d.customers?.name ?? "—", amountCents: rupeesToCents(Number(d.total_incl)),
      href: `/sales/${d.id}`, tone: "sale",
    });
  }

  for (const p of (payRes.data ?? []) as any[]) {
    if (Number(p.amount) <= 0) continue;
    events.push({
      id: `pay-${p.id}`, at: p.received_at, actorId: p.received_by, actorName: nm(p.received_by),
      kind: "payment", category: "payments",
      title: `Payment taken · ${METHOD[p.method] ?? p.method}`,
      detail: p.documents?.number ?? "—", amountCents: rupeesToCents(Number(p.amount)),
      href: p.document_id ? `/sales/${p.document_id}` : null, tone: "money",
    });
  }

  for (const a of (auditRes.data ?? []) as any[]) {
    const e = mapAudit(a, nm);
    if (e) events.push(e);
  }

  for (const m of (adjRes.data ?? []) as any[]) {
    // Skip the one-time go-live opening-stock import — it's data seeding, not
    // an operational action, and would otherwise flood the feed with 400+ rows.
    if ((m.note ?? "").toLowerCase().includes("opening stock")) continue;
    const q = Number(m.qty);
    events.push({
      id: `adj-${m.id}`, at: m.moved_at, actorId: m.created_by, actorName: nm(m.created_by),
      kind: "stock_adjust", category: "stock",
      title: `Stock adjusted · ${m.products?.name ?? "—"}`,
      detail: `${q > 0 ? "+" : ""}${qtyFmt(q)} ${m.products?.unit ?? ""} at ${m.stock_locations?.name ?? "—"}${m.note ? ` · ${m.note}` : ""}`.trim(),
      amountCents: null, href: "/products?tab=inventory", tone: "stock",
    });
  }

  for (const t of (transRes.data ?? []) as any[]) {
    const route = `${locById.get(t.from_location_id) ?? "—"} → ${locById.get(t.to_location_id) ?? "—"}`;
    if (t.dispatched_at) events.push({ id: `trd-${t.id}`, at: t.dispatched_at, actorId: t.dispatched_by, actorName: nm(t.dispatched_by), kind: "transfer_out", category: "stock", title: "Transfer dispatched", detail: route, amountCents: null, href: "/products?tab=transfers", tone: "stock" });
    if (t.received_at) events.push({ id: `trr-${t.id}`, at: t.received_at, actorId: t.received_by, actorName: nm(t.received_by), kind: "transfer_in", category: "stock", title: "Transfer received", detail: route, amountCents: null, href: "/products?tab=transfers", tone: "stock" });
  }

  for (const c of (cashRes.data ?? []) as any[]) {
    if (c.opened_at) events.push({ id: `cso-${c.id}`, at: c.opened_at, actorId: c.opened_by, actorName: nm(c.opened_by), kind: "cash_open", category: "cash", title: "Till opened", detail: c.device_id ?? "—", amountCents: null, href: "/reports?r=cash", tone: "cash" });
    if (c.closed_at) events.push({ id: `csc-${c.id}`, at: c.closed_at, actorId: c.closed_by, actorName: nm(c.closed_by), kind: "cash_close", category: "cash", title: "Till closed", detail: `${c.device_id ?? ""}${c.variance != null ? ` · variance ${formatMUR(rupeesToCents(Number(c.variance)))}` : ""}`.trim() || "—", amountCents: null, href: "/reports?r=cash", tone: "cash" });
  }

  for (const j of (jobRes.data ?? []) as any[]) {
    const veh = (j.vehicles ? `${j.vehicles.make ?? ""} ${j.vehicles.model ?? ""}`.trim() || j.vehicles.plate : "") || "vehicle";
    events.push({ id: `jbo-${j.id}`, at: j.created_at, actorId: j.created_by, actorName: nm(j.created_by), kind: "job_opened", category: "jobs", title: `Job opened · ${veh}`, detail: j.vehicles?.plate ?? "—", amountCents: null, href: `/jobs/${j.id}`, tone: "job" });
    if (j.ready_at) {
      const actor = j.completed_by ?? refActor.get(j.id) ?? null;
      events.push({ id: `jbc-${j.id}`, at: j.ready_at, actorId: actor, actorName: nm(actor), kind: "job_completed", category: "jobs", title: `Job completed · ${veh}`, detail: j.vehicles?.plate ?? "—", amountCents: null, href: `/jobs/${j.id}`, tone: "job" });
    }
  }

  for (const po of (poRes.data ?? []) as any[]) {
    const actor = refActor.get(po.id) ?? null;
    events.push({ id: `po-${po.id}`, at: po.received_at, actorId: actor, actorName: nm(actor), kind: "po_received", category: "stock", title: `Purchase order received${po.reference ? ` · ${po.reference}` : ""}`, detail: po.suppliers?.name ?? "—", amountCents: null, href: "/purchases?tab=orders", tone: "stock" });
  }

  for (const ct of (certRes.data ?? []) as any[]) {
    events.push({ id: `cert-${ct.id}`, at: ct.created_at, actorId: ct.created_by, actorName: nm(ct.created_by), kind: "certificate_issued", category: "sales", title: `Certificate ${ct.number ?? ""} issued`.trim(), detail: ct.customers?.name ?? "—", amountCents: null, href: "/certificates", tone: "sale" });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Post-filter (covers secondary-timestamp events like transfer/job completion),
  // then sort newest-first and cap.
  const t0 = f.from ? Date.parse(dayStart(f.from)) : null;
  const t1 = f.to ? Date.parse(dayEnd(f.to)) : null;
  let out = events.filter((e) => {
    if (!e.at) return false;
    const t = Date.parse(e.at);
    if (t0 != null && t < t0) return false;
    if (t1 != null && t > t1) return false;
    if (f.actor && e.actorId !== f.actor) return false;
    if (f.category && e.category !== f.category) return false;
    return true;
  });
  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const capped = out.length > CAP;
  out = out.slice(0, CAP);

  const actors = ((usersRes.data ?? []) as { id: string; display_name: string }[])
    .map((u) => ({ id: u.id, name: strip(u.display_name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { events: out, actors, capped };
}

const ADMIN_TITLE: Record<string, string> = {
  staff_created: "Added staff",
  staff_role_changed: "Changed role",
  staff_activated: "Reactivated staff",
  staff_deactivated: "Deactivated staff",
  staff_modules_changed: "Changed module access",
  staff_password_reset: "Reset web password",
  staff_deleted: "Deleted staff",
  staff_pin_set: "Set POS PIN",
  staff_pin_cleared: "Cleared POS PIN",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAudit(a: any, nm: (id: string | null) => string): ActivityEvent | null {
  const base = { id: `aud-${a.id}`, at: a.created_at as string, actorId: a.actor_id as string | null, actorName: nm(a.actor_id) };
  const p = (a.payload ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const money = (v: unknown) => (v != null && !Number.isNaN(Number(v)) ? rupeesToCents(Number(v)) : null);
  switch (a.event_type) {
    case "document_voided":
      return { ...base, kind: "void", category: "sales", title: `${p.number ? `Invoice ${p.number}` : "Document"} voided`, detail: (p.reason as string) ?? "—", amountCents: null, href: a.ref_id ? `/sales/${a.ref_id}` : null, tone: "warn" };
    case "payment_reversed":
      return { ...base, kind: "payment_reversed", category: "payments", title: "Payment reversed", detail: (p.reason as string) ?? (p.method ? String(p.method) : "—"), amountCents: money(p.amount), href: p.document_id ? `/sales/${p.document_id}` : null, tone: "warn" };
    case "credit_note_issued":
      return { ...base, kind: "credit_note", category: "sales", title: `Credit note ${p.number ?? ""} issued`.trim(), detail: (p.reason as string) ?? "—", amountCents: money(p.amount), href: a.ref_id ? `/sales/${a.ref_id}` : null, tone: "warn" };
    case "document_from_job":
      return { ...base, kind: "doc_from_job", category: "sales", title: "Document raised from a job", detail: "—", amountCents: null, href: a.ref_id ? `/sales/${a.ref_id}` : null, tone: "neutral" };
    case "job_from_document":
      return { ...base, kind: "job_from_doc", category: "jobs", title: "Job created from a document", detail: "—", amountCents: null, href: a.ref_id ? `/jobs/${a.ref_id}` : null, tone: "neutral" };
    case "quote_converted_to_job":
      return { ...base, kind: "quote_to_job", category: "jobs", title: "Quote converted to a job", detail: "—", amountCents: null, href: a.ref_id ? `/sales/${a.ref_id}` : null, tone: "neutral" };
    case "price_changed": {
      const parts: string[] = [];
      if (p.sellingFrom != null && p.sellingTo != null) parts.push(`Selling ${formatMUR(rupeesToCents(Number(p.sellingFrom)))} → ${formatMUR(rupeesToCents(Number(p.sellingTo)))}`);
      if (p.costFrom != null && p.costTo != null) parts.push(`Cost ${formatMUR(rupeesToCents(Number(p.costFrom)))} → ${formatMUR(rupeesToCents(Number(p.costTo)))}`);
      return { ...base, kind: "price_changed", category: "catalogue", title: `Price changed${p.name ? ` — ${p.name}` : ""}`, detail: parts.join(" · ") || "—", amountCents: null, href: "/products", tone: "money" };
    }
    case "job_started":
      return { ...base, kind: "job_started", category: "jobs", title: "Job started", detail: "—", amountCents: null, href: a.ref_id ? `/jobs/${a.ref_id}` : null, tone: "job" };
    case "job_delivered":
      return { ...base, kind: "job_delivered", category: "jobs", title: "Job delivered", detail: "—", amountCents: null, href: a.ref_id ? `/jobs/${a.ref_id}` : null, tone: "job" };
    case "technician_assigned":
      return { ...base, kind: "technician_assigned", category: "jobs", title: "Technician assigned", detail: p.tech ? String(p.tech) : "—", amountCents: null, href: a.ref_id ? `/jobs/${a.ref_id}` : null, tone: "job" };
    case "signed_in":
      return { ...base, kind: "signed_in", category: "auth", title: "Signed in", detail: p.device === "pos" ? "POS tablet" : "Web", amountCents: null, href: null, tone: "auth" };
    default: {
      const title = ADMIN_TITLE[a.event_type as string];
      if (!title) return null;
      const bits: string[] = [];
      if (p.role) bits.push(String(p.role));
      if (p.email) bits.push(String(p.email));
      return { ...base, kind: a.event_type, category: "admin", title: `${title}${p.name ? ` — ${p.name}` : ""}`, detail: bits.join(" · ") || "—", amountCents: null, href: "/settings", tone: "admin" };
    }
  }
}
