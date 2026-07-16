"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, PackagePlus } from "lucide-react";
import type { POData, PurchaseOrder } from "@/lib/supabase/queries/purchases";
import { formatMUR } from "@/lib/money";
import { createSupplierAction, createPurchaseOrderAction, receivePurchaseOrderAction } from "./po-actions";
import { btn } from "@/components/ui/button";

const field = "h-10 rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand";

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  draft: { label: "Draft", cls: "bg-[rgba(140,150,161,0.14)] text-muted", dot: "#8c96a1" },
  ordered: { label: "Ordered", cls: "bg-[rgba(43,140,255,0.12)] text-link", dot: "#2b8cff" },
  partially_received: { label: "Part-received", cls: "bg-[rgba(245,166,35,0.14)] text-amber-ink", dot: "#f5a623" },
  received: { label: "Received", cls: "bg-[rgba(13,167,124,0.14)] text-mint", dot: "#0da77c" },
  cancelled: { label: "Cancelled", cls: "bg-[rgba(214,59,80,0.12)] text-rose", dot: "#d63b50" },
};
const qfmt = (n: number) => (Number.isInteger(n) ? String(n) : String(n));

export function PurchaseOrdersPanel({ data }: { data: POData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suppliers, setSuppliers] = useState(data.suppliers);

  const [supplierId, setSupplierId] = useState(data.suppliers[0]?.id ?? "");
  const [newSupplier, setNewSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<{ key: number; productId: string; qty: string; cost: string }[]>([]);
  const [nextKey, setNextKey] = useState(1);

  function addLine() {
    const first = data.products[0];
    setLines((ls) => [...ls, { key: nextKey, productId: first?.id ?? "", qty: "", cost: first ? String(first.costCents / 100) : "" }]);
    setNextKey((k) => k + 1);
  }
  function setLine(key: number, patch: Partial<{ productId: string; qty: string; cost: string }>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        if (patch.productId) {
          const prod = data.products.find((p) => p.id === patch.productId);
          if (prod) next.cost = String(prod.costCents / 100);
        }
        return next;
      }),
    );
  }

  async function addSupplier() {
    setError(null);
    const r = await createSupplierAction(newSupplier);
    if (r.ok && r.data) {
      setSuppliers((s) => [...s, r.data!].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierId(r.data.id);
      setNewSupplier("");
    } else if (!r.ok) setError(r.error);
  }

  async function create() {
    setError(null);
    const parsed = lines
      .map((l) => ({ productId: l.productId, qty: parseFloat(l.qty), unitCost: parseFloat(l.cost) || 0 }))
      .filter((l) => l.productId && l.qty > 0);
    if (!supplierId) return setError("Pick or add a supplier.");
    if (parsed.length === 0) return setError("Add at least one line with a quantity.");
    setBusy(true);
    const r = await createPurchaseOrderAction({ supplierId, reference, lines: parsed });
    setBusy(false);
    if (r.ok) {
      setLines([]);
      setReference("");
      router.refresh();
    } else setError(r.error);
  }

  const draftTotal = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.cost) || 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="rounded-[10px] border border-[rgba(214,59,80,0.3)] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[13px] text-rose">{error}</p>}

      {/* new PO */}
      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <PackagePlus size={16} className="text-brand" />
          <span className="font-display text-[14px] font-bold text-ink-strong">New purchase order</span>
        </div>

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Supplier</span>
            <select className={`${field} min-w-[200px]`} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {suppliers.length === 0 && <option value="">— none yet —</option>}
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-1.5">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Add supplier</span>
              <input className={`${field} w-[170px]`} value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} placeholder="New supplier name" />
            </label>
            <button onClick={addSupplier} disabled={!newSupplier.trim()} className={btn("subtle", "lg")}>
              Save
            </button>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Reference</span>
            <input className={`${field} w-[150px]`} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO / invoice no." />
          </label>
        </div>

        {lines.length > 0 && (
          <div className="mb-3 flex flex-col gap-2">
            <div className="hidden md:grid grid-cols-[1fr_100px_120px_110px_28px] gap-2 px-1 text-[10px] font-bold uppercase tracking-wide text-th">
              <span>Product</span><span className="text-right">Qty</span><span className="text-right">Unit cost</span><span className="text-right">Line</span><span />
            </div>
            {lines.map((l) => {
              const lineTotal = (parseFloat(l.qty) || 0) * (parseFloat(l.cost) || 0);
              return (
                <div key={l.key}>
                  {/* Mobile: stacked editable line */}
                  <div className="flex flex-col gap-2 rounded-[11px] border border-line-2 bg-sub px-3 py-2.5 md:hidden">
                    <select className={field} value={l.productId} onChange={(e) => setLine(l.key, { productId: e.target.value })}>
                      {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <div className="flex items-end gap-2">
                      <label className="flex flex-1 flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-faint">Qty</span>
                        <input className={`${field} text-right`} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} inputMode="decimal" placeholder="0" />
                      </label>
                      <label className="flex flex-1 flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-faint">Unit cost</span>
                        <input className={`${field} text-right`} value={l.cost} onChange={(e) => setLine(l.key, { cost: e.target.value })} inputMode="decimal" placeholder="0.00" />
                      </label>
                      <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="flex h-10 w-10 shrink-0 items-center justify-center text-faint hover:text-rose">
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-faint">Line total</span>
                      <span className="num text-[13px] font-semibold text-body">{formatMUR(Math.round(lineTotal * 100))}</span>
                    </div>
                  </div>
                  {/* Desktop grid (unchanged) */}
                  <div className="hidden md:grid grid-cols-[1fr_100px_120px_110px_28px] items-center gap-2">
                    <select className={field} value={l.productId} onChange={(e) => setLine(l.key, { productId: e.target.value })}>
                      {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input className={`${field} text-right`} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} inputMode="decimal" placeholder="0" />
                    <input className={`${field} text-right`} value={l.cost} onChange={(e) => setLine(l.key, { cost: e.target.value })} inputMode="decimal" placeholder="0.00" />
                    <span className="num text-right text-[13px] font-semibold text-body">{formatMUR(Math.round(lineTotal * 100))}</span>
                    <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-faint hover:text-rose">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button onClick={addLine} className={btn("subtle")}>
            <Plus size={14} /> Add product
          </button>
          <div className="flex-1" />
          {lines.length > 0 && <span className="num mr-2 text-[13px] font-bold text-ink">{formatMUR(Math.round(draftTotal * 100))}</span>}
          <button onClick={create} disabled={busy || lines.length === 0} className={btn("primary")}>
            {busy ? "Saving…" : "Create order"}
          </button>
        </div>
      </div>

      {/* existing POs */}
      {data.pos.length === 0 ? (
        <div className="rounded-[15px] border border-line bg-card p-8 text-center text-[13px] text-muted">No purchase orders yet.</div>
      ) : (
        data.pos.map((po) => <POCard key={po.id} po={po} locations={data.locations} busy={busy} setBusy={setBusy} setError={setError} />)
      )}
    </div>
  );
}

function POCard({
  po,
  locations,
  busy,
  setBusy,
  setError,
}: {
  po: PurchaseOrder;
  locations: { id: string; name: string }[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (s: string | null) => void;
}) {
  const router = useRouter();
  const s = STATUS[po.status] ?? STATUS.ordered;
  const receivable = po.status !== "received" && po.status !== "cancelled";
  const [locId, setLocId] = useState(locations[0]?.id ?? "");
  const [recv, setRecv] = useState<Record<string, string>>(() =>
    Object.fromEntries(po.lines.map((l) => [l.id, String(Math.max(0, l.qtyOrdered - l.qtyReceived))])),
  );

  async function receive() {
    setError(null);
    setBusy(true);
    const r = await receivePurchaseOrderAction({
      id: po.id,
      locationId: locId || null,
      lines: po.lines.map((l) => ({ lineId: l.id, qty: parseFloat(recv[l.id] ?? "0") || 0 })),
    });
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }

  return (
    <div className="overflow-hidden rounded-[15px] border border-line bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-3 md:flex-nowrap md:px-5">
        <span className="text-[13px] font-bold text-ink">{po.supplier ?? "—"}</span>
        {po.reference && <span className="num text-[11px] text-faint">{po.reference}</span>}
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${s.cls}`}>
          <span className="size-1.5 rounded-full" style={{ background: s.dot }} />
          {s.label}
        </span>
        <span className="num ml-auto text-[13px] font-extrabold text-ink">{formatMUR(po.totalCents)}</span>
      </div>

      <div className="hidden md:grid grid-cols-[1fr_90px_90px_110px] gap-2 border-b border-line bg-sub px-5 py-2 text-[10px] font-bold uppercase tracking-wide text-th">
        <span>Product</span><span className="text-right">Ordered</span><span className="text-right">Received</span><span className="text-right">Receive now</span>
      </div>
      <div className="divide-y divide-line">
        {po.lines.map((l) => (
          <div key={l.id}>
            {/* Mobile card */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 md:hidden">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-body">{l.name}</div>
                <div className="mt-0.5 text-[11.5px] text-muted">
                  <span className="num">{qfmt(l.qtyOrdered)} {l.unit}</span> ordered · <span className="num">{qfmt(l.qtyReceived)}</span> received
                </div>
              </div>
              {receivable ? (
                <label className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-faint">Receive</span>
                  <input
                    className={`${field} h-9 w-24 text-right`}
                    value={recv[l.id] ?? ""}
                    onChange={(e) => setRecv((r) => ({ ...r, [l.id]: e.target.value }))}
                    inputMode="decimal"
                  />
                </label>
              ) : (
                <span className="shrink-0 text-faint">—</span>
              )}
            </div>
            {/* Desktop grid (unchanged) */}
            <div className="hidden md:grid grid-cols-[1fr_90px_90px_110px] items-center gap-2 px-5 py-2.5 text-[12.5px]">
              <span className="text-body">{l.name}</span>
              <span className="num text-right text-muted">{qfmt(l.qtyOrdered)} {l.unit}</span>
              <span className="num text-right text-muted">{qfmt(l.qtyReceived)}</span>
              {receivable ? (
                <input
                  className={`${field} h-9 w-full text-right`}
                  value={recv[l.id] ?? ""}
                  onChange={(e) => setRecv((r) => ({ ...r, [l.id]: e.target.value }))}
                  inputMode="decimal"
                />
              ) : (
                <span className="text-right text-faint">—</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {receivable && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-sub px-4 py-3 md:px-5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-faint">Into</span>
          <select className={`${field} h-9`} value={locId} onChange={(e) => setLocId(e.target.value)}>
            {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
          <button onClick={receive} disabled={busy} className={btn("primary")}>
            Receive stock
          </button>
        </div>
      )}
    </div>
  );
}
