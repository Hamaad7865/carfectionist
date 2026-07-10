"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ArrowRight } from "lucide-react";
import type { Transfer, TransfersRef } from "@/lib/supabase/queries/transfers";
import { createTransferAction, dispatchTransferAction, receiveTransferAction } from "./actions";

const field = "h-10 rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand";
const qfmt = (n: number) => (Number.isInteger(n) ? String(n) : String(n));

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  draft: { label: "Draft", cls: "bg-[rgba(140,150,161,0.14)] text-muted", dot: "#8c96a1" },
  dispatched: { label: "In transit", cls: "bg-[rgba(245,166,35,0.14)] text-amber-ink", dot: "#f5a623" },
  received: { label: "Received", cls: "bg-[rgba(13,167,124,0.14)] text-mint", dot: "#0da77c" },
};

export function TransfersPanel({ transfers, refData }: { transfers: Transfer[]; refData: TransfersRef }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── new-transfer builder ──────────────────────────────────────────────────
  const [fromId, setFromId] = useState(refData.locations.find((l) => l.isDefault)?.id ?? refData.locations[0]?.id ?? "");
  const [toId, setToId] = useState(refData.locations.find((l) => !l.isDefault)?.id ?? refData.locations[1]?.id ?? "");
  const [lines, setLines] = useState<{ key: number; productId: string; qty: string }[]>([]);
  const [nextKey, setNextKey] = useState(1);

  const fromIsWarehouse = useMemo(() => refData.locations.find((l) => l.id === fromId)?.isDefault ?? false, [fromId, refData.locations]);
  const availAt = (pid: string) => {
    const p = refData.products.find((x) => x.id === pid);
    if (!p) return 0;
    return fromIsWarehouse ? p.warehouse : p.shop;
  };

  function addLine() {
    setLines((ls) => [...ls, { key: nextKey, productId: refData.products[0]?.id ?? "", qty: "" }]);
    setNextKey((k) => k + 1);
  }
  function setLine(key: number, patch: Partial<{ productId: string; qty: string }>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function create() {
    setError(null);
    const parsed = lines
      .map((l) => ({ productId: l.productId, qty: parseFloat(l.qty) }))
      .filter((l) => l.productId && l.qty > 0);
    if (parsed.length === 0) return setError("Add at least one line with a quantity.");
    setBusy(true);
    const r = await createTransferAction({ fromLocationId: fromId, toLocationId: toId, lines: parsed });
    setBusy(false);
    if (r.ok) {
      setLines([]);
      router.refresh();
    } else setError(r.error);
  }

  async function dispatch(id: string) {
    setError(null);
    setBusy(true);
    const r = await dispatchTransferAction(id);
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="rounded-[10px] border border-[rgba(214,59,80,0.3)] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[13px] text-rose">{error}</p>}

      {/* new transfer */}
      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="mb-4 flex flex-col items-start gap-3 md:flex-row md:items-center">
          <span className="font-display text-[14px] font-bold text-ink-strong">New transfer</span>
          <div className="flex w-full items-center gap-2 text-[13px] md:w-auto">
            <select className={`${field} min-w-0 flex-1 md:flex-initial`} value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {refData.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <ArrowRight size={15} className="shrink-0 text-faint" />
            <select className={`${field} min-w-0 flex-1 md:flex-initial`} value={toId} onChange={(e) => setToId(e.target.value)}>
              {refData.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>

        {lines.length > 0 && (
          <div className="mb-3 flex flex-col gap-2">
            {lines.map((l) => {
              const avail = availAt(l.productId);
              const over = parseFloat(l.qty) > avail;
              return (
                <div key={l.key} className="flex flex-col gap-2 md:flex-row md:items-center">
                  <select className={`${field} w-full md:w-auto md:flex-1`} value={l.productId} onChange={(e) => setLine(l.key, { productId: e.target.value })}>
                    {refData.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <div className="flex items-center gap-2">
                    <input
                      className={`${field} flex-1 text-right md:w-[110px] md:flex-none ${over ? "border-rose text-rose" : ""}`}
                      value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      inputMode="decimal"
                      placeholder="Qty"
                    />
                    <span className="w-[86px] text-[11px] text-faint">avail {qfmt(avail)}</span>
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
          <button onClick={addLine} className="flex h-9 items-center gap-1.5 rounded-[10px] border border-line-2 bg-sub px-3 text-[12.5px] font-semibold text-body">
            <Plus size={14} /> Add product
          </button>
          <div className="flex-1" />
          <button onClick={create} disabled={busy || lines.length === 0} className="grad-brand shadow-brand inline-flex h-9 items-center justify-center rounded-[10px] px-4 text-[13px] font-bold text-white disabled:opacity-50">
            {busy ? "Saving…" : "Create draft"}
          </button>
        </div>
      </div>

      {/* existing transfers */}
      {transfers.length === 0 ? (
        <div className="rounded-[15px] border border-line bg-card p-8 text-center text-[13px] text-muted">No transfers yet.</div>
      ) : (
        transfers.map((t) => <TransferCard key={t.id} t={t} onDispatch={() => dispatch(t.id)} busy={busy} setBusy={setBusy} setError={setError} />)
      )}
    </div>
  );
}

function TransferCard({
  t,
  onDispatch,
  busy,
  setBusy,
  setError,
}: {
  t: Transfer;
  onDispatch: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (s: string | null) => void;
}) {
  const router = useRouter();
  const s = STATUS[t.status];
  const [recv, setRecv] = useState<Record<string, string>>(() => Object.fromEntries(t.lines.map((l) => [l.id, String(l.qtyDispatched)])));

  async function receive() {
    setError(null);
    setBusy(true);
    const r = await receiveTransferAction({
      id: t.id,
      lines: t.lines.map((l) => ({ lineId: l.id, qtyReceived: parseFloat(recv[l.id] ?? "0") || 0 })),
    });
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }

  return (
    <div className="overflow-hidden rounded-[15px] border border-line bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <span className="text-[13px] font-bold text-ink">{t.fromName}</span>
        <ArrowRight size={14} className="text-faint" />
        <span className="text-[13px] font-bold text-ink">{t.toName}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${s.cls}`}>
          <span className="size-1.5 rounded-full" style={{ background: s.dot }} />
          {s.label}
        </span>
        <span className="num ml-auto text-[11px] text-faint">{t.createdAt.slice(0, 10)}</span>
      </div>

      <div className="divide-y divide-line">
        {t.lines.map((l) => (
          <div key={l.id} className="flex items-center gap-3 px-5 py-2.5 text-[12.5px]">
            <span className="min-w-0 flex-1 text-body">{l.name}</span>
            <span className="num text-muted">
              {qfmt(l.qtyDispatched)} {l.unit}
            </span>
            {t.status === "dispatched" ? (
              <input
                className={`${field} w-[100px] text-right`}
                value={recv[l.id] ?? ""}
                onChange={(e) => setRecv((r) => ({ ...r, [l.id]: e.target.value }))}
                inputMode="decimal"
              />
            ) : t.status === "received" ? (
              <span className="num w-[100px] text-right font-bold text-mint">↓ {qfmt(l.qtyReceived ?? 0)}</span>
            ) : (
              <span className="w-[100px] text-right text-faint">—</span>
            )}
          </div>
        ))}
      </div>

      {(t.status === "draft" || t.status === "dispatched") && (
        <div className="flex justify-end gap-2 border-t border-line bg-sub px-5 py-3">
          {t.status === "draft" && (
            <button onClick={onDispatch} disabled={busy} className="grad-brand shadow-brand inline-flex h-9 items-center justify-center rounded-[10px] px-4 text-[13px] font-bold text-white disabled:opacity-50">
              Dispatch
            </button>
          )}
          {t.status === "dispatched" && (
            <button onClick={receive} disabled={busy} className="grad-brand shadow-brand inline-flex h-9 items-center justify-center rounded-[10px] px-4 text-[13px] font-bold text-white disabled:opacity-50">
              Receive into {t.toName}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
