"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { ChevronLeft, ArrowRight, Search, Plus, X, FileDown, PanelRightClose, PanelRightOpen, ZoomIn, ZoomOut, Maximize2, ExternalLink } from "lucide-react";
import { computeTotals, computeLineTotals, formatMUR, parseMoneyInput } from "@/lib/money";
import { DocumentA4 } from "@/components/pdf/DocumentA4";
import { StatusPill } from "@/components/ui/StatusPill";
import { saveDraftAction, issueDocumentAction, convertQuoteToInvoiceAction } from "@/features/documents/actions";
import { DeleteDraftButton } from "@/features/documents/DeleteDraftButton";
import { DocumentShareBar } from "@/features/documents/DocumentShareBar";
import type { SaveDraftInput } from "@/features/documents/payload";
import type { BuilderContext } from "@/lib/supabase/queries/builder";
import { reducer, type BuilderState } from "./state";
import { toDocumentProps } from "./toDocumentProps";

// UUID keys so the builder's line keys can never collide with those minted
// server-side in state.ts (both previously used an l<N> counter from 0).
const newKey = () => crypto.randomUUID();

// Signature of the editable content — used to detect edits made WHILE a save is
// in flight, so saveOk doesn't clear dirty and silently drop them.
const editSig = (st: BuilderState) =>
  JSON.stringify({ l: st.lines, c: st.customerId, d: st.docType, sc: st.sectionConfig, cf: st.customFields, dk: st.docDiscountKind, dv: st.docDiscountValue });

/**
 * A money text field that keeps a local editing buffer so a transient "1500."
 * survives (a controlled value re-derived from cents rounds the dot away, making
 * fractional rates impossible to type). Commits parsed cents (clamped ≥ 0) up to
 * the parent, and re-syncs only when the cents value changes from OUTSIDE.
 */
function MoneyField({ cents, onCents, className, placeholder }: { cents: number; onCents: (c: number) => void; className: string; placeholder?: string }) {
  const [text, setText] = useState(cents ? String(cents / 100) : "");
  const last = useRef(cents);
  useEffect(() => {
    if (cents !== last.current) { setText(cents ? String(cents / 100) : ""); last.current = cents; }
  }, [cents]);
  return (
    <input
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const c = Math.max(0, parseMoneyInput(t) ?? 0);
        last.current = c;
        onCents(c);
      }}
      inputMode="decimal"
      placeholder={placeholder}
      className={className}
    />
  );
}

export function DocumentBuilder({ ctx, initial }: { ctx: BuilderContext; initial: BuilderState }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initial);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [catQuery, setCatQuery] = useState("");
  const [custQuery, setCustQuery] = useState("");
  const [adName, setAdName] = useState("");
  const [adPrice, setAdPrice] = useState("");
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [issueKey] = useState(() => crypto.randomUUID()); // idempotent Issue (per document mount)
  const paneRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Serialize saves and track the server's authoritative (docId, revision) in a
  // ref, so chained autosaves can't race the optimistic-lock counter (the cause
  // of the spurious "document was modified elsewhere" error). Seeded from the
  // mount's initial — the per-document `key` on <DocumentBuilder> guarantees a
  // fresh mount (and fresh ref) whenever the document identity changes.
  const saveChain = useRef<Promise<string | null>>(Promise.resolve(null));
  const serverRef = useRef<{ docId: string | null; revision: number }>({ docId: initial.docId, revision: initial.revision });

  const readOnly = state.status !== "draft";
  const customer = ctx.customers.find((c) => c.id === state.customerId);

  const doSave = useCallback((): Promise<string | null> => {
    const run = async (): Promise<string | null> => {
      const s = stateRef.current;
      if (s.status !== "draft") return serverRef.current.docId; // never save an issued document
      const startSig = editSig(s);
      dispatch({ type: "saveStart" });
      const payload: SaveDraftInput = {
        doc: { id: serverRef.current.docId, docType: s.docType, customerId: s.customerId, templateOverrides: { ...s.sectionConfig, customFields: s.customFields } as Record<string, unknown>, discountKind: s.docDiscountKind, discountValue: s.docDiscountValue },
        lines: s.lines.map((l) => ({
          productId: l.productId,
          title: l.title,
          description: l.description || null,
          qty: l.qty,
          unitCents: l.unitCents,
          discountPct: l.discountPct,
          discountKind: l.discountKind,
          discountAmountCents: l.discountAmountCents,
          vatRatePct: l.vatRatePct,
        })),
        expectedRev: serverRef.current.docId ? serverRef.current.revision : null,
      };
      const res = await saveDraftAction(payload);
      if (res.ok) {
        serverRef.current = { docId: res.data.id, revision: res.data.revision };
        dispatch({ type: "saveOk", docId: res.data.id, revision: res.data.revision, stillDirty: editSig(stateRef.current) !== startSig });
        return res.data.id;
      }
      dispatch({ type: "saveError", error: res.error });
      return null;
    };
    // Chain after any in-flight save so each run reads the fresh revision.
    const next = saveChain.current.then(run, run);
    saveChain.current = next.catch(() => null);
    return next;
  }, []);

  useEffect(() => {
    if (state.status !== "draft" || !state.dirty) return;
    const t = setTimeout(() => void doSave(), 1200);
    return () => clearTimeout(t);
  }, [state.dirty, state.lines, state.customerId, state.docType, state.sectionConfig, state.customFields, state.status, state.docDiscountKind, state.docDiscountValue, doSave]);

  async function onIssue() {
    const s = stateRef.current;
    if (s.lines.length === 0) return dispatch({ type: "saveError", error: "Add at least one line before issuing." });
    if (s.docType === "invoice" && !s.customerId) return dispatch({ type: "saveError", error: "An invoice requires a customer." });
    setBusy(true);
    const id = await doSave();
    if (!id) return setBusy(false);
    const res = await issueDocumentAction({ documentId: id, idempotencyKey: issueKey });
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

  const totals = computeTotals(
    state.lines.map((l) => ({ qty: l.qty, unitCents: l.unitCents, discountPct: l.discountPct, discountKind: l.discountKind, discountAmountCents: l.discountAmountCents, vatRatePct: l.vatRatePct })),
    state.docDiscountKind ? { kind: state.docDiscountKind, value: state.docDiscountValue } : null,
  );

  // Render the A4 markup only when the document changes; zoom is a cheap wrapper
  // applied on top, so dragging the zoom control never re-runs renderToStaticMarkup.
  const innerMarkup = useMemo(() => {
    const props = toDocumentProps(state, ctx.business, {
      createdBy: ctx.createdBy,
      customerName: customer?.name ?? "",
      customerCountry: customer?.country ?? "Mauritius",
      terms: ctx.templateTerms,
      assets: ctx.assets,
      number: state.number,
      issueDate: readOnly ? state.issueDate ?? new Date().toISOString().slice(0, 10) : null,
    });
    return renderToStaticMarkup(<DocumentA4 {...props} />);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, ctx, customer, readOnly]);

  const previewHtml = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#e2e7ee;padding:12px 0"><div style="zoom:${zoom}">${innerMarkup}</div></body></html>`,
    [innerMarkup, zoom],
  );

  // A4 body width is 210mm ≈ 794px; fit = scale it to the preview pane width.
  const computeFit = useCallback(() => {
    const w = paneRef.current?.clientWidth ?? 0;
    return w ? Math.min(1.5, Math.max(0.3, (w - 8) / 794)) : 1;
  }, []);

  useEffect(() => {
    if (!showPreview) return;
    const el = paneRef.current;
    if (!el) return;
    if (fitMode) setZoom(computeFit());
    const ro = new ResizeObserver(() => { if (fitMode) setZoom(computeFit()); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [showPreview, fitMode, computeFit]);

  const zoomBy = (d: number) => { setFitMode(false); setZoom((z) => Math.min(2, Math.max(0.3, +(z + d).toFixed(2)))); };
  const fitWidth = () => { setFitMode(true); setZoom(computeFit()); };
  const resetZoom = () => { setFitMode(false); setZoom(1); };

  const filtered = ctx.products.filter((p) => p.name.toLowerCase().includes(catQuery.toLowerCase())).slice(0, 5);
  const custFiltered = ctx.customers.filter((c) => c.name.toLowerCase().includes(custQuery.toLowerCase())).slice(0, 8);

  function addAdhoc() {
    const cents = parseMoneyInput(adPrice) ?? 0;
    if (!adName.trim()) return;
    dispatch({ type: "addLine", line: { key: newKey(), productId: null, title: adName.trim(), description: "", qty: 1, unitCents: cents, discountPct: 0, discountKind: "percent", discountAmountCents: 0, vatRatePct: 15 } });
    setAdName("");
    setAdPrice("");
  }

  const label = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#7e8894]";
  const inputCls = "h-11 w-full rounded-[11px] border border-line-2 bg-sub px-3.5 text-[13.5px] font-medium text-ink outline-none placeholder:text-faint focus:border-brand";

  return (
    <div className="flex h-full flex-col bg-app">
      {/* Toolbar */}
      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-sub px-4 py-2 md:gap-3 md:px-[22px]">
        <Link href="/sales" className="flex h-9 items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3 text-[12.5px] font-semibold text-body">
          <ChevronLeft size={15} /> Back
        </Link>
        <span className="font-display text-[15px] font-extrabold text-ink-strong">Document builder</span>
        <span className="hidden text-[12px] text-faint lg:inline">· live preview updates as you build</span>
        <span className="num text-[12px] text-muted">{state.number ?? ""}</span>
        {readOnly && <StatusPill status={state.status} />}
        <span className="text-[11px] text-faint">
          {state.save === "saving" ? "Saving…" : state.save === "saved" ? "Saved" : ""}
        </span>
        {!readOnly && state.docId && <DeleteDraftButton documentId={state.docId} docType={state.docType} />}
        <div className="flex-1" />
        <button
          onClick={() => setShowPreview((v) => !v)}
          title={showPreview ? "Hide preview" : "Show preview"}
          aria-pressed={showPreview}
          className="flex h-[38px] items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3 text-[12.5px] font-semibold text-body hover:border-brand"
        >
          {showPreview ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          {showPreview ? "Hide preview" : "Preview"}
        </button>
        {!readOnly && (
          <button onClick={onIssue} disabled={busy} className="grad-brand shadow-brand flex h-[38px] items-center gap-2 rounded-[10px] px-[18px] font-display text-[13px] font-extrabold text-white disabled:opacity-60">
            {busy ? "Working…" : `Issue ${state.docType}`}
            <ArrowRight size={16} />
          </button>
        )}
        {readOnly && state.docId && state.number && (
          <DocumentShareBar
            documentId={state.docId}
            number={state.number}
            defaultEmail={customer?.email ?? null}
            defaultPhone={customer?.phone ?? null}
          />
        )}
        {readOnly && state.docId && !state.number && (
          <a href={`/print/doc/${state.docId}`} target="_blank" rel="noreferrer" className="flex h-[38px] items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3 text-[13px] font-semibold text-body">
            <FileDown size={15} /> Print / PDF
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

      <div className={`grid min-h-0 flex-1 grid-cols-1 ${showPreview ? "lg:grid-cols-2" : ""}`}>
        {/* CONTROLS */}
        <div className="flex flex-col gap-4 overflow-y-auto p-4 md:p-[22px]">
          {/* doc type + bill to */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
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
              {customer ? (
                <div className="flex h-11 items-center gap-2 rounded-[11px] border border-link bg-[rgba(43,140,255,0.08)] px-3.5">
                  <span className="flex-1 truncate text-[13.5px] font-semibold text-link">{customer.name}</span>
                  {!readOnly && (
                    <button
                      onClick={() => { dispatch({ type: "setCustomer", customerId: null }); setCustQuery(""); }}
                      title="Change customer"
                      className="grid size-6 place-items-center rounded-[7px] text-link hover:bg-[rgba(43,140,255,0.16)]"
                    >
                      <X size={14} strokeWidth={2.6} />
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search size={16} className="absolute left-3.5 top-3.5 text-faint" />
                    <input
                      value={custQuery}
                      onChange={(e) => setCustQuery(e.target.value)}
                      disabled={readOnly}
                      placeholder="Search customer by name…"
                      className={`${inputCls} pl-[38px]`}
                    />
                  </div>
                  {custQuery && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {custFiltered.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { dispatch({ type: "setCustomer", customerId: c.id }); setCustQuery(""); }}
                          className="flex items-center gap-2.5 rounded-[10px] border border-line bg-sub px-3 py-2.5 text-left hover:border-brand"
                        >
                          <span className="flex-1 text-[13px] font-semibold text-body">{c.name}</span>
                          <span className="grid size-6 place-items-center rounded-[7px] bg-[rgba(43,140,255,0.14)] text-link"><Plus size={14} strokeWidth={2.6} /></span>
                        </button>
                      ))}
                      {custFiltered.length === 0 && <div className="px-3 py-2 text-[12px] text-faint">No customer matches.</div>}
                    </div>
                  )}
                </>
              )}
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
                          dispatch({ type: "addLine", line: { key: newKey(), productId: p.id, title: p.name, description: "", qty: 1, unitCents: p.unitCents, discountPct: 0, discountKind: "percent", discountAmountCents: 0, vatRatePct: p.vatRatePct } });
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
                  const net = computeLineTotals({ qty: l.qty, unitCents: l.unitCents, discountPct: l.discountPct, discountKind: l.discountKind, discountAmountCents: l.discountAmountCents, vatRatePct: l.vatRatePct }).exclCents;
                  return (
                    <div key={l.key} className="flex flex-wrap items-center gap-2.5 rounded-[11px] border border-line bg-card px-3 py-2.5">
                      <div className="min-w-0 flex-1 basis-full sm:basis-0">
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
                        <div className="flex items-center rounded-[7px] border border-line-2 bg-sub" title="Line discount (% or Rs off)">
                          <button
                            onClick={() => dispatch({ type: "patchLine", key: l.key, patch: { discountKind: l.discountKind === "amount" ? "percent" : "amount", discountPct: 0, discountAmountCents: 0 } })}
                            className="grid h-7 w-6 place-items-center text-[10px] font-bold text-faint"
                          >
                            {l.discountKind === "amount" ? "Rs" : "%"}
                          </button>
                          <input
                            value={l.discountKind === "amount" ? (l.discountAmountCents ? String(l.discountAmountCents / 100) : "") : (l.discountPct || "")}
                            onChange={(e) =>
                              l.discountKind === "amount"
                                ? dispatch({ type: "patchLine", key: l.key, patch: { discountAmountCents: Math.max(0, parseMoneyInput(e.target.value) ?? 0) } })
                                : dispatch({ type: "patchLine", key: l.key, patch: { discountPct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) } })
                            }
                            inputMode="decimal"
                            placeholder="disc"
                            className="h-7 w-11 bg-transparent pr-1.5 text-right text-[11px] text-body outline-none placeholder:text-faint"
                          />
                        </div>
                      )}
                      {!readOnly && (
                        <div className="relative w-[96px]" title="Unit rate (excl. VAT)">
                          <span className="num absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-faint">Rs</span>
                          <MoneyField
                            cents={l.unitCents}
                            onCents={(c) => dispatch({ type: "patchLine", key: l.key, patch: { unitCents: c } })}
                            placeholder="rate"
                            className="num h-7 w-full rounded-[7px] border border-line-2 bg-sub pl-6 pr-2 text-right text-[12px] font-semibold text-ink outline-none placeholder:text-faint focus:border-brand"
                          />
                        </div>
                      )}
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

          {/* custom fields */}
          {!readOnly && (
            <div className="border-t border-line pt-4">
              <div className={`${label} mb-2.5`}>Custom fields</div>
              {ctx.customFieldDefs.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const def = ctx.customFieldDefs.find((d) => d.label === e.target.value);
                    if (def) dispatch({ type: "addCustomField", field: { label: def.label, value: def.value } });
                  }}
                  className="mb-2.5 h-9 w-full rounded-[10px] border border-line-2 bg-sub px-2.5 text-[13px] font-medium text-body outline-none focus:border-brand"
                >
                  <option value="">+ Add a saved field…</option>
                  {ctx.customFieldDefs.map((d) => {
                    const used = state.customFields.some((f) => f.label.trim().toLowerCase() === d.label.trim().toLowerCase());
                    return (
                      <option key={d.label} value={d.label} disabled={used}>
                        {d.label}{used ? " · added" : ""}
                      </option>
                    );
                  })}
                </select>
              )}
              {state.customFields.length > 0 && (
                <div className="mb-2 flex flex-col gap-2">
                  {state.customFields.map((f, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={f.label} onChange={(e) => dispatch({ type: "patchCustomField", index: i, patch: { label: e.target.value } })} placeholder="Label — e.g. PO number" className="h-9 w-[42%] rounded-[9px] border border-line-2 bg-sub px-2.5 text-[13px] text-ink outline-none focus:border-brand" />
                      <input value={f.value} onChange={(e) => dispatch({ type: "patchCustomField", index: i, patch: { value: e.target.value } })} placeholder="Value" className="h-9 flex-1 rounded-[9px] border border-line-2 bg-sub px-2.5 text-[13px] text-ink outline-none focus:border-brand" />
                      <button onClick={() => dispatch({ type: "removeCustomField", index: i })} className="grid size-9 place-items-center rounded-[9px] text-faint hover:text-rose"><X size={15} /></button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => dispatch({ type: "addCustomField" })} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line-2 bg-sub px-3 text-[12.5px] font-semibold text-body">
                <Plus size={14} /> Add field
              </button>
              <p className="mt-1.5 text-[11px] text-faint">Extra label/value details shown in the document header. Save reusable ones in Settings → Templates to get one-click buttons here.</p>
            </div>
          )}

          {/* totals */}
          <div className="ml-auto w-64 border-t border-line pt-4 text-[13px]">
            {!readOnly && (
              <div className="mb-2 flex items-center gap-2">
                <span className="flex-1 text-muted">Discount (whole {state.docType})</span>
                <div className="flex items-center rounded-[8px] border border-line-2 bg-sub" title="Order discount (% or Rs off the total)">
                  <button
                    onClick={() => dispatch({ type: "setDocDiscount", kind: (state.docDiscountKind ?? "percent") === "amount" ? "percent" : "amount", value: 0 })}
                    className="grid h-8 w-7 place-items-center text-[11px] font-bold text-faint"
                  >
                    {state.docDiscountKind === "amount" ? "Rs" : "%"}
                  </button>
                  <input
                    value={state.docDiscountKind === "amount" ? (state.docDiscountValue ? String(state.docDiscountValue / 100) : "") : (state.docDiscountValue || "")}
                    onChange={(e) =>
                      (state.docDiscountKind ?? "percent") === "amount"
                        ? dispatch({ type: "setDocDiscount", kind: "amount", value: Math.max(0, parseMoneyInput(e.target.value) ?? 0) })
                        : dispatch({ type: "setDocDiscount", kind: "percent", value: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })
                    }
                    inputMode="decimal"
                    placeholder="0"
                    className="h-8 w-16 bg-transparent px-2 text-right text-[12.5px] text-body outline-none placeholder:text-faint"
                  />
                </div>
              </div>
            )}
            <div className="flex justify-between py-1 text-muted"><span>Subtotal</span><span className="num text-ink">{formatMUR(totals.grossSubtotalCents)}</span></div>
            {totals.grossSubtotalCents !== totals.subtotalCents && (
              <div className="flex justify-between py-1 text-amber-ink"><span>Discount</span><span className="num">−{formatMUR(totals.grossSubtotalCents - totals.subtotalCents)}</span></div>
            )}
            <div className="flex justify-between py-1 text-muted"><span>VAT (15%)</span><span className="num text-ink">{formatMUR(totals.vatCents)}</span></div>
            <div className="mt-1 flex justify-between rounded-[10px] bg-sub px-3 py-2 font-bold"><span className="text-ink">Total (MUR)</span><span className="num text-brand">{formatMUR(totals.totalCents)}</span></div>
          </div>
        </div>

        {/* PREVIEW */}
        {showPreview && (
          <div className="flex min-h-0 flex-col border-l border-line bg-[#e2e7ee]">
            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-sub px-3">
              <span className="mr-auto text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Preview</span>
              <button onClick={() => zoomBy(-0.1)} title="Zoom out" className="grid size-7 place-items-center rounded-[8px] border border-line-2 bg-card text-body hover:border-brand">
                <ZoomOut size={15} />
              </button>
              <button onClick={resetZoom} title="Reset to 100%" className="num h-7 min-w-[48px] rounded-[8px] border border-line-2 bg-card px-1 text-[12px] font-bold text-body hover:border-brand">
                {Math.round(zoom * 100)}%
              </button>
              <button onClick={() => zoomBy(0.1)} title="Zoom in" className="grid size-7 place-items-center rounded-[8px] border border-line-2 bg-card text-body hover:border-brand">
                <ZoomIn size={15} />
              </button>
              <button
                onClick={fitWidth}
                title="Fit to width"
                className={`ml-0.5 grid size-7 place-items-center rounded-[8px] border bg-card hover:border-brand ${fitMode ? "border-brand text-brand" : "border-line-2 text-body"}`}
              >
                <Maximize2 size={14} />
              </button>
              {state.docId && (
                <a
                  href={`/print/doc/${state.docId}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open full page in a new tab"
                  className="ml-0.5 grid size-7 place-items-center rounded-[8px] border border-line-2 bg-card text-body hover:border-brand"
                >
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
            <div ref={paneRef} className="min-h-0 flex-1 overflow-hidden">
              <iframe title="Preview" srcDoc={previewHtml} className="h-full w-full border-0" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
