"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { ChevronLeft, ArrowRight, Search, Plus, X, FileDown } from "lucide-react";
import { computeTotals, computeLineTotals, formatMUR, parseMoneyInput } from "@/lib/money";
import { DocumentA4 } from "@/components/pdf/DocumentA4";
import { StatusPill } from "@/components/ui/StatusPill";
import { saveDraftAction, issueDocumentAction, convertQuoteToInvoiceAction } from "@/features/documents/actions";
import type { SaveDraftInput } from "@/features/documents/payload";
import type { BuilderContext } from "@/lib/supabase/queries/builder";
import { reducer, type BuilderState } from "./state";
import { toDocumentProps } from "./toDocumentProps";

let seq = 0;
const newKey = () => `l${++seq}`;

export function DocumentBuilder({ ctx, initial }: { ctx: BuilderContext; initial: BuilderState }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initial);
  const [busy, setBusy] = useState(false);
  const [catQuery, setCatQuery] = useState("");
  const [adName, setAdName] = useState("");
  const [adPrice, setAdPrice] = useState("");
  const stateRef = useRef(state);
  stateRef.current = state;

  const readOnly = state.status !== "draft";
  const customer = ctx.customers.find((c) => c.id === state.customerId);

  const doSave = useCallback(async (): Promise<string | null> => {
    const s = stateRef.current;
    dispatch({ type: "saveStart" });
    const payload: SaveDraftInput = {
      doc: { id: s.docId, docType: s.docType, customerId: s.customerId, templateOverrides: s.sectionConfig as Record<string, unknown> },
      lines: s.lines.map((l) => ({
        productId: l.productId,
        title: l.title,
        description: l.description || null,
        qty: l.qty,
        unitCents: l.unitCents,
        discountPct: l.discountPct,
        vatRatePct: l.vatRatePct,
      })),
      expectedRev: s.docId ? s.revision : null,
    };
    const res = await saveDraftAction(payload);
    if (res.ok) {
      dispatch({ type: "saveOk", docId: res.data.id, revision: res.data.revision });
      return res.data.id;
    }
    dispatch({ type: "saveError", error: res.error });
    return null;
  }, []);

  useEffect(() => {
    if (state.status !== "draft" || !state.dirty) return;
    const t = setTimeout(() => void doSave(), 1200);
    return () => clearTimeout(t);
  }, [state.dirty, state.lines, state.customerId, state.docType, state.sectionConfig, state.status, doSave]);

  async function onIssue() {
    const s = stateRef.current;
    if (s.lines.length === 0) return dispatch({ type: "saveError", error: "Add at least one line before issuing." });
    if (s.docType === "invoice" && !s.customerId) return dispatch({ type: "saveError", error: "An invoice requires a customer." });
    setBusy(true);
    const id = await doSave();
    if (!id) return setBusy(false);
    const res = await issueDocumentAction({ documentId: id });
    if (res.ok) {
      dispatch({ type: "issued", number: res.data.number ?? "", status: res.data.status });
      router.refresh();
    } else dispatch({ type: "saveError", error: res.error });
    setBusy(false);
  }

  async function onConvert() {
    const s = stateRef.current;
    if (!s.docId) return;
    setBusy(true);
    const res = await convertQuoteToInvoiceAction(s.docId);
    setBusy(false);
    if (res.ok) router.push(`/sales/${res.data.id}/edit`);
    else dispatch({ type: "saveError", error: res.error });
  }

  const totals = computeTotals(state.lines.map((l) => ({ qty: l.qty, unitCents: l.unitCents, discountPct: l.discountPct, vatRatePct: l.vatRatePct })));

  const previewHtml = useMemo(() => {
    const props = toDocumentProps(state, ctx.business, {
      createdBy: ctx.createdBy,
      customerName: customer?.name ?? "",
      customerCountry: customer?.country ?? "Mauritius",
      terms: ctx.templateTerms,
      number: state.number,
      issueDate: readOnly ? new Date().toISOString().slice(0, 10) : null,
    });
    return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#e2e7ee;padding:18px">${renderToStaticMarkup(<DocumentA4 {...props} />)}</body></html>`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, ctx, customer, readOnly]);

  const filtered = ctx.products.filter((p) => p.name.toLowerCase().includes(catQuery.toLowerCase())).slice(0, 5);

  function addAdhoc() {
    const cents = parseMoneyInput(adPrice) ?? 0;
    if (!adName.trim()) return;
    dispatch({ type: "addLine", line: { key: newKey(), productId: null, title: adName.trim(), description: "", qty: 1, unitCents: cents, discountPct: 0, vatRatePct: 15 } });
    setAdName("");
    setAdPrice("");
  }

  const label = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#7e8894]";
  const inputCls = "h-11 w-full rounded-[11px] border border-line-2 bg-sub px-3.5 text-[13.5px] font-medium text-ink outline-none placeholder:text-faint focus:border-brand";

  return (
    <div className="flex h-full flex-col bg-app">
      {/* Toolbar */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-sub px-[22px]">
        <Link href="/sales" className="flex h-9 items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3 text-[12.5px] font-semibold text-body">
          <ChevronLeft size={15} /> Back
        </Link>
        <span className="font-display text-[15px] font-extrabold text-ink-strong">Document builder</span>
        <span className="text-[12px] text-faint">· live preview updates as you build</span>
        <span className="num text-[12px] text-muted">{state.number ?? ""}</span>
        {readOnly && <StatusPill status={state.status} />}
        <span className="text-[11px] text-faint">
          {state.save === "saving" ? "Saving…" : state.save === "saved" ? "Saved" : ""}
        </span>
        <div className="flex-1" />
        {!readOnly && (
          <button onClick={onIssue} disabled={busy} className="grad-brand shadow-brand flex h-[38px] items-center gap-2 rounded-[10px] px-[18px] font-display text-[13px] font-extrabold text-white disabled:opacity-60">
            {busy ? "Working…" : `Issue ${state.docType}`}
            <ArrowRight size={16} />
          </button>
        )}
        {readOnly && state.docId && (
          <a href={`/api/documents/${state.docId}/pdf`} className="flex h-[38px] items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3 text-[13px] font-semibold text-body">
            <FileDown size={15} /> PDF
          </a>
        )}
        {readOnly && state.docType === "quote" && (
          <button onClick={onConvert} disabled={busy} className="grad-brand shadow-brand flex h-[38px] items-center justify-center rounded-[10px] px-4 font-display text-[13px] font-extrabold text-white disabled:opacity-60">
            Convert to invoice
          </button>
        )}
        {readOnly && state.docType === "invoice" && state.docId && (
          <Link href={`/sales/${state.docId}`} className="grad-brand shadow-brand flex h-[38px] items-center rounded-[10px] px-4 font-display text-[13px] font-extrabold text-white">
            Record payment
          </Link>
        )}
      </div>

      {state.saveError && <div className="border-b border-[rgba(214,59,80,.3)] bg-[rgba(214,59,80,.08)] px-[22px] py-2 text-[13px] text-rose">{state.saveError}</div>}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_520px]">
        {/* CONTROLS */}
        <div className="flex flex-col gap-4 overflow-y-auto p-[22px]">
          {/* doc type + bill to */}
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <div className={`${label} mb-2.5`}>Document type</div>
              <div className="flex gap-0 rounded-[11px] border border-line-2 bg-sub p-1">
                {(["invoice", "quote"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => !readOnly && dispatch({ type: "setDocType", docType: t })}
                    className={`inline-flex h-[38px] flex-1 items-center justify-center rounded-lg text-[13px] font-bold capitalize ${state.docType === t ? "bg-card text-ink shadow-sm" : "text-muted"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className={`${label} mb-2.5`}>Bill to</div>
              <div className="flex flex-wrap gap-1.5">
                {ctx.customers.slice(0, 6).map((c) => {
                  const on = state.customerId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => !readOnly && dispatch({ type: "setCustomer", customerId: on ? null : c.id })}
                      className={`inline-flex h-[34px] items-center justify-center rounded-[9px] px-3 text-[12px] font-semibold ${on ? "border border-link bg-[rgba(43,140,255,0.12)] text-link" : "border border-line-2 bg-card text-body"}`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* line items */}
          <div className="border-t border-line pt-4">
            <div className={`${label} mb-2.5`}>Line items</div>
            {!readOnly && (
              <>
                <div className="relative mb-2.5">
                  <Search size={16} className="absolute left-3.5 top-3.5 text-faint" />
                  <input value={catQuery} onChange={(e) => setCatQuery(e.target.value)} placeholder="Search catalogue — services and products…" className={`${inputCls} pl-[38px]`} />
                </div>
                {catQuery && (
                  <div className="mb-3 flex flex-col gap-1.5">
                    {filtered.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          dispatch({ type: "addLine", line: { key: newKey(), productId: p.id, title: p.name, description: "", qty: 1, unitCents: p.unitCents, discountPct: 0, vatRatePct: p.vatRatePct } });
                          setCatQuery("");
                        }}
                        className="flex items-center gap-2.5 rounded-[10px] border border-line bg-sub px-3 py-2.5 text-left"
                      >
                        <span className="w-14 text-[9px] font-bold uppercase tracking-wide text-link">{p.kind}</span>
                        <span className="flex-1 text-[13px] font-semibold text-body">{p.name}</span>
                        <span className="num text-[12.5px] font-bold text-muted">{formatMUR(p.unitCents)}</span>
                        <span className="grid size-6 place-items-center rounded-[7px] bg-[rgba(43,140,255,0.14)] text-link"><Plus size={14} strokeWidth={2.6} /></span>
                      </button>
                    ))}
                    {filtered.length === 0 && <div className="px-3 py-2 text-[12px] text-faint">No match.</div>}
                  </div>
                )}

                <div className="mb-3.5 flex gap-2 rounded-[11px] border border-dashed border-line-2 bg-sub p-2.5">
                  <input value={adName} onChange={(e) => setAdName(e.target.value)} placeholder="Type an ad-hoc line — e.g. Headlight restoration" className="h-[42px] flex-1 rounded-[9px] border border-line-2 bg-sub px-3 text-[13px] font-medium text-ink outline-none placeholder:text-faint" />
                  <div className="relative w-[120px]">
                    <span className="num absolute left-3 top-3 text-[13px] text-faint">Rs</span>
                    <input value={adPrice} onChange={(e) => setAdPrice(e.target.value)} inputMode="numeric" placeholder="0" className="num h-[42px] w-full rounded-[9px] border border-line-2 bg-sub pl-9 pr-3 text-[13px] font-semibold text-ink outline-none" />
                  </div>
                  <button onClick={addAdhoc} className="inline-flex h-[42px] items-center justify-center rounded-[9px] bg-[#e2e8ef] px-4 text-[13px] font-bold text-body">Add</button>
                </div>
              </>
            )}

            {state.lines.length === 0 ? (
              <div className="rounded-[11px] border border-dashed border-line-2 p-6 text-center text-[12.5px] font-semibold text-faint">No lines yet — add from the catalogue or type an ad-hoc line</div>
            ) : (
              <div className="flex flex-col gap-2">
                {state.lines.map((l) => {
                  const net = computeLineTotals({ qty: l.qty, unitCents: l.unitCents, discountPct: l.discountPct, vatRatePct: l.vatRatePct }).exclCents;
                  return (
                    <div key={l.key} className="flex items-center gap-2.5 rounded-[11px] border border-line bg-card px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-ink">{l.title || "—"}</div>
                        {l.productId === null && <span className="text-[8.5px] font-bold tracking-[0.1em] text-[#6a55d6]">AD-HOC</span>}
                      </div>
                      <button
                        onClick={() => !readOnly && dispatch({ type: "patchLine", key: l.key, patch: { vatRatePct: l.vatRatePct > 0 ? 0 : 15 } })}
                        className={`h-7 rounded-[7px] px-2.5 text-[10.5px] font-bold ${l.vatRatePct > 0 ? "bg-[rgba(43,140,255,0.14)] text-link" : "bg-[rgba(15,23,32,0.06)] text-faint"}`}
                      >
                        VAT
                      </button>
                      {!readOnly && (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => dispatch({ type: "patchLine", key: l.key, patch: { qty: Math.max(1, l.qty - 1) } })} className="grid size-[26px] place-items-center rounded-[7px] border border-line-2 bg-[#e9edf3] text-[14px] font-bold text-body">−</button>
                          <span className="num min-w-4 text-center text-[13px] font-bold text-ink">{l.qty}</span>
                          <button onClick={() => dispatch({ type: "patchLine", key: l.key, patch: { qty: l.qty + 1 } })} className="grid size-[26px] place-items-center rounded-[7px] border border-line-2 bg-[#e9edf3] text-[14px] font-bold text-body">+</button>
                        </div>
                      )}
                      <span className="num min-w-[78px] text-right text-[13px] font-bold text-ink">{formatMUR(net)}</span>
                      {!readOnly && (
                        <button onClick={() => dispatch({ type: "removeLine", key: l.key })} className="grid size-[26px] place-items-center rounded-[7px] bg-[rgba(255,84,104,0.12)] text-rose"><X size={13} strokeWidth={2.6} /></button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* sections */}
          {!readOnly && (
            <div className="border-t border-line pt-4">
              <div className={`${label} mb-2.5`}>Sections</div>
              <div className="grid grid-cols-2 gap-2">
                {([["bankDetails", "Bank details"], ["terms", "Terms & conditions"], ["signature", "Signature line"]] as const).map(([k, lbl]) => {
                  const on = state.sectionConfig[k] ?? k !== "signature";
                  return (
                    <button key={k} onClick={() => dispatch({ type: "setSection", key: k, value: !on })} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-card px-3 py-2.5 text-left">
                      <span className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors" style={{ background: on ? "#2b8cff" : "#c9d2dc" }}>
                        <span className="absolute top-0.5 size-[18px] rounded-full bg-white transition-all" style={{ left: on ? "18px" : "2px" }} />
                      </span>
                      <span className="text-[12.5px] font-semibold text-body">{lbl}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* totals */}
          <div className="ml-auto w-64 border-t border-line pt-4 text-[13px]">
            <div className="flex justify-between py-1 text-muted"><span>Subtotal</span><span className="num text-ink">{formatMUR(totals.subtotalCents)}</span></div>
            <div className="flex justify-between py-1 text-muted"><span>VAT (15%)</span><span className="num text-ink">{formatMUR(totals.vatCents)}</span></div>
            <div className="mt-1 flex justify-between rounded-[10px] bg-sub px-3 py-2 font-bold"><span className="text-ink">Total (MUR)</span><span className="num text-brand">{formatMUR(totals.totalCents)}</span></div>
          </div>
        </div>

        {/* PREVIEW */}
        <div className="min-h-0 overflow-hidden border-l border-line">
          <iframe title="Preview" srcDoc={previewHtml} className="h-full w-full border-0" />
        </div>
      </div>
    </div>
  );
}
