"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import dynamic from "next/dynamic";
import { ChevronLeft, ArrowRight, Search, Plus, X, FileDown, PanelRightClose, PanelRightOpen, ZoomIn, ZoomOut, Maximize2, ExternalLink, ChevronUp, ChevronDown, Copy, AlignLeft, KeyRound } from "lucide-react";
import { richToPlainText } from "@/lib/rich/plain";

/**
 * ProseMirror builds against a real DOM at construction time and the Workers
 * runtime has no DOM, so the editor must never be part of the SSR pass — being
 * inside a "use client" file is not enough, Next still prerenders client trees on
 * the server. `next dev` will not catch this; the OpenNext preview will.
 */
const RichEditor = dynamic(() => import("./RichEditor"), {
  ssr: false,
  loading: () => (
    <div className="rounded-[9px] border border-line-2 bg-sub px-3 py-4 text-[12px] text-faint">Loading editor…</div>
  ),
});
import { computeTotals, computeLineTotals, computeAllowance, lineAllowanceCents, policyOf, formatMUR, parseMoneyInput, grossCents, netFromGrossCents, unitCentsFromTyped } from "@/lib/money";
import { DocumentA4 } from "@/components/pdf/DocumentA4";
import { StatusPill } from "@/components/ui/StatusPill";
import { saveDraftAction, issueDocumentAction, convertQuoteToInvoiceAction } from "@/features/documents/actions";
import { DeleteDraftButton } from "@/features/documents/DeleteDraftButton";
import { DocumentShareBar } from "@/features/documents/DocumentShareBar";
import type { SaveDraftInput } from "@/features/documents/payload";
import type { BuilderContext, BuilderCustomer } from "@/lib/supabase/queries/builder";
import { reducer, toSaveDraftLines, type BuilderState } from "./state";
import { toDocumentProps } from "./toDocumentProps";
import { NewCustomerButton } from "./NewCustomerButton";
import { OwnerOverrideDialog } from "@/features/documents/OwnerOverrideDialog";
import { btn } from "@/components/ui/button";

// UUID keys so the builder's line keys can never collide with those minted
// server-side in state.ts (both previously used an l<N> counter from 0).
const newKey = () => crypto.randomUUID();

// Signature of the editable content — used to detect edits made WHILE a save is
// in flight, so saveOk doesn't clear dirty and silently drop them.
const editSig = (st: BuilderState) =>
  JSON.stringify({ l: st.lines, c: st.customerId, d: st.docType, sc: st.sectionConfig, cf: st.customFields, cm: st.comment, dk: st.docDiscountKind, dv: st.docDiscountValue, dr: st.docDiscountReason });

/**
 * A money text field that keeps a local editing buffer so a transient "1500."
 * survives (a controlled value re-derived from cents rounds the dot away, making
 * fractional rates impossible to type). Commits parsed cents (clamped ≥ 0) up to
 * the parent, and re-syncs only when the cents value changes from OUTSIDE.
 */
/**
 * A money input whose TYPED TEXT is the source of truth.
 *
 * `cents` seeds it and nothing more: the re-sync deliberately watches [syncKey], never [cents].
 * When this field fed a VAT-inclusive box, watching `cents` corrupted prices — the parent echoed
 * back grossCents(netFromGrossCents(typed)), which is not the typed figure for ~13% of values, so
 * the effect fired mid-keystroke and rewrote the operator's input. Typing "1500" became "149.990"
 * and saved a unit price of 130.43. Pass a syncKey that changes only when something OTHER than
 * typing sets the price (picking a catalogue product), and the round trip can never reach the text.
 * This is the shape the tablet's quote builder uses (QuoteViewModel.priceText).
 */
function MoneyField({ cents, onCents, className, placeholder, syncKey }: { cents: number; onCents: (c: number) => void; className: string; placeholder?: string; syncKey?: string | number }) {
  const [text, setText] = useState(cents ? String(cents / 100) : "");
  const seeded = useRef(syncKey);
  useEffect(() => {
    if (syncKey !== seeded.current) { setText(cents ? String(cents / 100) : ""); seeded.current = syncKey; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);
  return (
    <input
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        onCents(Math.max(0, parseMoneyInput(t) ?? 0));
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
  const [openDesc, setOpenDesc] = useState<string | null>(null); // which line's description is being edited
  const [catKind, setCatKind] = useState<"all" | "service" | "product">("all");
  const [custQuery, setCustQuery] = useState("");
  // Customers created from the "New" button live here until a reload folds them
  // into ctx.customers — so the one just made is selectable and shows in the preview.
  const [createdCustomers, setCreatedCustomers] = useState<BuilderCustomer[]>([]);
  const [adName, setAdName] = useState("");
  const [adPrice, setAdPrice] = useState("");
  // Work or goods — asked every time a line is typed by hand, because nothing else can
  // say what it is, and the answer decides whether an accepted quote raises a job.
  const [adKind, setAdKind] = useState<"service" | "product">("service");
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [issueKey] = useState(() => crypto.randomUUID()); // idempotent Issue (per document mount)
  // The owner's on-the-spot approval for THIS document only. Plain state, not a
  // ref or anything persisted — <DocumentBuilder key={docId|"new"}> remounts on
  // every document (see sales/new and sales/[id]/edit), so navigating to a
  // different document starts this at null again with no extra plumbing.
  const [approvedMaxCents, setApprovedMaxCents] = useState<number | null>(null);
  const [overrideDialogDocId, setOverrideDialogDocId] = useState<string | null>(null);
  const [askOwnerBusy, setAskOwnerBusy] = useState(false);
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
  // Merge in customers created this session, newest first, without duplicating any
  // that a later reload has already pulled into ctx.customers.
  const allCustomers = useMemo(() => {
    const known = new Set(ctx.customers.map((c) => c.id));
    return [...createdCustomers.filter((c) => !known.has(c.id)), ...ctx.customers];
  }, [ctx.customers, createdCustomers]);
  const customer = allCustomers.find((c) => c.id === state.customerId);

  const doSave = useCallback((): Promise<string | null> => {
    const run = async (): Promise<string | null> => {
      const s = stateRef.current;
      if (s.status !== "draft") return serverRef.current.docId; // never save an issued document
      const startSig = editSig(s);
      dispatch({ type: "saveStart" });
      const payload: SaveDraftInput = {
        doc: { id: serverRef.current.docId, docType: s.docType, customerId: s.customerId, templateOverrides: { ...s.sectionConfig, customFields: s.customFields } as Record<string, unknown>, comment: s.comment, discountKind: s.docDiscountKind, discountValue: s.docDiscountValue, discountReason: s.docDiscountReason },
        lines: toSaveDraftLines(s.lines),
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
  }, [state.dirty, state.lines, state.customerId, state.docType, state.sectionConfig, state.customFields, state.comment, state.status, state.docDiscountKind, state.docDiscountValue, state.docDiscountReason, doSave]);

  async function onIssue() {
    const s = stateRef.current;
    if (s.lines.length === 0) return dispatch({ type: "saveError", error: "Add at least one line before issuing." });
    if (s.docType === "invoice" && !s.customerId) return dispatch({ type: "saveError", error: "An invoice requires a customer." });
    if (discountBlockReason) return dispatch({ type: "saveError", error: discountBlockReason });
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

  // "Ask the owner": the way out of the disabled-Issue dead end. The override
  // the RPC records is pinned to a document id (app.assert_discount_allowed
  // re-reads it by ref_id), so a never-yet-saved draft needs a real one before
  // the dialog can open — flush the same doSave() chain Issue itself uses, so
  // this can't race an in-flight autosave or hand the dialog a stale id.
  async function askOwner() {
    setAskOwnerBusy(true);
    const id = await doSave();
    setAskOwnerBusy(false);
    if (id) setOverrideDialogDocId(id);
  }

  // One assembly, shared by the totals and the discount-allowance math below — a line's
  // policy rides beside the fields computeTotals already wanted.
  const lineInputs = state.lines.map((l) => ({
    qty: l.qty,
    unitCents: l.unitCents,
    discountPct: l.discountPct,
    discountKind: l.discountKind,
    discountAmountCents: l.discountAmountCents,
    vatRatePct: l.vatRatePct,
    policy: l.discountPolicy,
    priceInclusive: l.priceInclusive,
  }));
  const docDiscount = state.docDiscountKind ? { kind: state.docDiscountKind, value: state.docDiscountValue } : null;
  const totals = computeTotals(lineInputs, docDiscount);
  // The database is the authority (app.assert_discount_allowed, raised from inside
  // issue_document) — this mirrors it so the builder can clamp an input and explain
  // the limit before the cashier fills a basket they will not be allowed to issue.
  // approvedMaxCents comes from the "Ask the owner" dialog below: an owner's PIN,
  // checked server-side, raises the ceiling for this document only — see askOwner().
  const allowance = computeAllowance(lineInputs, docDiscount, approvedMaxCents, ctx.posRules.carwashPct);
  const discountBlockReason = allowance.overCeiling
    ? `This discount is over the ${formatMUR(allowance.ceilingCents)} allowed on this ${state.docType} — ask the owner.`
    : allowance.reasonRequired && !state.docDiscountReason.trim()
      ? "Add a reason for this discount before issuing."
      : null;
  // Quoting gross: state the subtotal and discount at shelf price, each line at its own rate,
  // so Subtotal − Discount = Total still reads correctly. VAT becomes "of which".
  const subtotalShown = ctx.pricesInclVat
    ? totals.lines.reduce((s, l) => s + l.exclCents + l.vatCents, 0)
    : totals.grossSubtotalCents;
  const discountShown = ctx.pricesInclVat
    ? subtotalShown - totals.totalCents
    : totals.grossSubtotalCents - totals.subtotalCents;

  // Render the A4 markup only when the document changes; zoom is a cheap wrapper
  // applied on top, so dragging the zoom control never re-runs renderToStaticMarkup.
  const innerMarkup = useMemo(() => {
    const props = toDocumentProps(state, ctx.business, {
      createdBy: ctx.createdBy,
      customerName: customer?.name ?? "",
      customerCountry: customer?.country ?? "Mauritius",
      customerBrn: customer?.brn ?? "",
      customerVatNo: customer?.vatNo ?? "",
      terms: ctx.templateTerms,
      assets: ctx.assets,
      pricesInclVat: ctx.pricesInclVat,
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

  // Catalogue picker: filter by kind as well as text. With ~800 products and only
  // ~70 services, "show me the services" is the common ask at the desk — searching
  // by name first meant knowing the name.
  const filtered = ctx.products
    .filter((p) => (catKind === "all" || p.kind === catKind) && p.name.toLowerCase().includes(catQuery.toLowerCase()))
    .slice(0, catQuery ? 8 : 12);
  const custFiltered = allCustomers.filter((c) => c.name.toLowerCase().includes(custQuery.toLowerCase())).slice(0, 8);

  function addAdhoc() {
    // Clamp at zero like MoneyField — a typed "-500" must not build a negative-total
    // invoice (audit #10). The schema and a DB CHECK back this up.
    const typed = Math.max(0, parseMoneyInput(adPrice) ?? 0);
    if (!adName.trim()) return;
    // Typed as the shelf price when the shop quotes gross — stored AS TYPED with
    // price_includes_vat, so the ledger extracts the VAT and a typed 1000 stays
    // 1000.00. Squashing it to a 2dp net (869.57) re-grossed a cent off — the
    // 1000.01 the owner reported (20260812000020).
    // No product to ask, so the row's own Service/Product control decides the allowance too.
    dispatch({ type: "addLine", line: { key: newKey(), productId: null, title: adName.trim(), description: "", rich: null, unitLabel: "", qty: 1, unitCents: typed, priceInclusive: ctx.pricesInclVat, discountPct: 0, discountKind: "percent", discountAmountCents: 0, discountPolicy: policyOf(null, adKind, ctx.posRules.policyDefaults), vatRatePct: 15, lineKind: adKind } });
    setAdName("");
    setAdPrice("");
    setAdKind("service");
  }

  const label = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#7e8894]";
  const inputCls = "h-11 w-full rounded-[11px] border border-line-2 bg-sub px-3.5 text-[13.5px] font-medium text-ink outline-none placeholder:text-faint focus:border-brand";

  return (
    <div className="flex h-full flex-col bg-app">
      {/* Toolbar */}
      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-sub px-4 py-2 md:gap-3 md:px-[22px]">
        <Link href="/sales" className={btn()}>
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
        {/* A quotation is sent BEFORE it is agreed — the customer has to read the price
            to accept it. Sending issues the draft on the way out, so this sits beside
            Issue rather than behind it, and it is the SAME element from draft through
            issued: swapping in the read-only bar below would tear the send sheet down
            in the middle of its "sent ✓". The save is flushed first — the autosave
            debounce means the newest line may not have reached the server yet. */}
        {state.docType === "quote" && state.docId && (!readOnly || state.number) && (
          !readOnly && discountBlockReason ? (
            // Sending a draft quote issues it on the way out (same path as the Issue
            // button), so it hits the same DB refusal — block it here instead.
            <span
              title={discountBlockReason}
              className="flex h-[38px] items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3 text-[12.5px] font-semibold text-faint"
            >
              Can&rsquo;t send — {discountBlockReason}
            </span>
          ) : (
            <DocumentShareBar
              documentId={state.docId}
              number={state.number}
              onBeforeSend={async () => !!(await doSave())}
              onSent={(issued) => {
                if (!issued) return;
                dispatch({ type: "issued", number: issued.number, status: issued.status });
                router.refresh();
              }}
            />
          )
        )}
        {/* The disabled Issue button below explains the ceiling; this is the way
            out of it — an owner's PIN, checked server-side, without signing the
            cashier out or anyone becoming an owner. Also clears the quote-send
            block above, since both read the same discountBlockReason. */}
        {!readOnly && allowance.overCeiling && (
          <button
            onClick={askOwner}
            disabled={askOwnerBusy}
            title="An owner's PIN can approve this discount for this document"
            className="flex h-[38px] items-center gap-1.5 rounded-[10px] border border-line-2 bg-card px-3 text-[12.5px] font-semibold text-link hover:border-brand disabled:opacity-60"
          >
            <KeyRound size={15} /> {askOwnerBusy ? "Saving…" : "Ask the owner"}
          </button>
        )}
        {!readOnly && (
          <button
            onClick={onIssue}
            disabled={busy || !!discountBlockReason}
            title={discountBlockReason ?? undefined}
            className="grad-brand shadow-brand flex h-[38px] items-center gap-2 rounded-[10px] px-[18px] font-display text-[13px] font-extrabold text-white disabled:opacity-60"
          >
            {busy ? "Working…" : `Issue ${state.docType}`}
            <ArrowRight size={16} />
          </button>
        )}
        {/* Quotes are served by the bar above, from draft onwards. */}
        {readOnly && state.docType !== "quote" && state.docId && state.number && (
          <DocumentShareBar
            documentId={state.docId}
            number={state.number}
            defaultEmail={customer?.email ?? null}
            defaultPhone={customer?.phone ?? null}
          />
        )}
        {/* Nothing to share: a void quote never got a number. */}
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
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search size={16} className="absolute left-3.5 top-3.5 text-faint" />
                      <input
                        value={custQuery}
                        onChange={(e) => setCustQuery(e.target.value)}
                        disabled={readOnly}
                        placeholder="Search customer by name…"
                        className={`${inputCls} pl-[38px]`}
                      />
                    </div>
                    {!readOnly && (
                      <NewCustomerButton
                        defaultName={custQuery}
                        onCreated={(c) => {
                          setCreatedCustomers((cs) => [c, ...cs]);
                          dispatch({ type: "setCustomer", customerId: c.id });
                          setCustQuery("");
                        }}
                      />
                    )}
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
                      {custFiltered.length === 0 && <div className="px-3 py-2 text-[12px] text-faint">No match — tap “New” to add “{custQuery}”.</div>}
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
                <div className="relative mb-2">
                  <Search size={16} className="absolute left-3.5 top-3.5 text-faint" />
                  <input value={catQuery} onChange={(e) => setCatQuery(e.target.value)} placeholder="Search catalogue — services and products…" className={`${inputCls} pl-[38px]`} />
                </div>
                <div className="mb-2.5 flex items-center gap-1.5">
                  {([["all", "All"], ["service", "Services"], ["product", "Products"]] as const).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setCatKind(k)}
                      className={`h-7 rounded-[8px] px-2.5 text-[11.5px] font-bold ${catKind === k ? "grad-brand text-white" : "border border-line-2 bg-sub text-body hover:border-brand"}`}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="ml-auto text-[11px] text-faint">
                    {ctx.products.filter((p) => catKind === "all" || p.kind === catKind).length} in catalogue
                  </span>
                </div>
                {(catQuery || catKind !== "all") && (
                  <div className="mb-3 flex flex-col gap-1.5">
                    {filtered.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          // From the catalogue: the product's own kind answers, so this stays null.
                          // Under gross quoting the figure ON SCREEN is the price: the shelf
                          // gross is stored as shown with price_includes_vat, so the ledger
                          // extracts the VAT and the line lands on the displayed number —
                          // the same rule the tablet's quote builder applies (20260812000020).
                          dispatch({ type: "addLine", line: { key: newKey(), productId: p.id, title: p.name, description: "", rich: null, unitLabel: "", qty: 1, unitCents: ctx.pricesInclVat ? grossCents(p.unitCents, p.vatRatePct) : p.unitCents, priceInclusive: ctx.pricesInclVat, discountPct: 0, discountKind: "percent", discountAmountCents: 0, discountPolicy: policyOf(p.discountPolicy, p.kind, ctx.posRules.policyDefaults), vatRatePct: p.vatRatePct, lineKind: null } });
                          setCatQuery("");
                        }}
                        className="flex items-center gap-2.5 rounded-[10px] border border-line bg-sub px-3 py-2.5 text-left"
                      >
                        {p.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.photoUrl} alt="" className="size-7 shrink-0 rounded-[6px] object-cover" />
                        ) : (
                          <span className="size-7 shrink-0 rounded-[6px] bg-sub" />
                        )}
                        <span className="w-14 text-[9px] font-bold uppercase tracking-wide text-link">{p.kind}</span>
                        <span className="flex-1 text-[13px] font-semibold text-body">{p.name}</span>
                        <span className="num text-[12.5px] font-bold text-muted">{formatMUR(ctx.pricesInclVat ? grossCents(p.unitCents, p.vatRatePct) : p.unitCents)}</span>
                        <span className="grid size-6 place-items-center rounded-[7px] bg-[rgba(43,140,255,0.14)] text-link"><Plus size={14} strokeWidth={2.6} /></span>
                      </button>
                    ))}
                    {filtered.length === 0 && <div className="px-3 py-2 text-[12px] text-faint">No match.</div>}
                  </div>
                )}

                <div className="mb-3.5 flex flex-wrap gap-2 rounded-[11px] border border-dashed border-line-2 bg-sub p-2.5">
                  <input value={adName} onChange={(e) => setAdName(e.target.value)} placeholder="Type an ad-hoc line — e.g. Headlight restoration" className="h-[42px] min-w-[180px] flex-1 rounded-[9px] border border-line-2 bg-sub px-3 text-[13px] font-medium text-ink outline-none placeholder:text-faint" />
                  <div className="relative w-[120px]">
                    <span className="num absolute left-3 top-3 text-[13px] text-faint">Rs</span>
                    <input value={adPrice} onChange={(e) => setAdPrice(e.target.value)} inputMode="numeric" placeholder="0" className="num h-[42px] w-full rounded-[9px] border border-line-2 bg-sub pl-9 pr-3 text-[13px] font-semibold text-ink outline-none" />
                  </div>
                  {/* Work or goods. A catalogue line is answered by its product; a line
                      typed by hand has nothing to ask, and the answer is what decides
                      whether accepting the quote puts the car on the jobs board. */}
                  <div className="flex h-[42px] items-center gap-0 rounded-[9px] border border-line-2 bg-card p-1">
                    {(["service", "product"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={adKind === k}
                        onClick={() => setAdKind(k)}
                        title={k === "service" ? "Work on the car — an accepted quote can raise a job" : "Goods sold — no job of its own"}
                        className={`h-[34px] rounded-[7px] px-3 text-[12px] font-bold capitalize ${adKind === k ? "bg-brand-wash text-link" : "text-muted"}`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                  <button onClick={addAdhoc} className="inline-flex h-[42px] items-center justify-center rounded-[9px] bg-[#e2e8ef] px-4 text-[13px] font-bold text-body">Add</button>
                </div>
              </>
            )}

            {state.lines.length === 0 ? (
              <div className="rounded-[11px] border border-dashed border-line-2 p-6 text-center text-[12.5px] font-semibold text-faint">No lines yet — add from the catalogue or type an ad-hoc line</div>
            ) : (
              <div className="flex flex-col gap-2">
                {state.lines.map((l, li) => {
                  const lt = computeLineTotals({ qty: l.qty, unitCents: l.unitCents, discountPct: l.discountPct, discountKind: l.discountKind, discountAmountCents: l.discountAmountCents, vatRatePct: l.vatRatePct, priceInclusive: l.priceInclusive });
                  const net = lt.exclCents;
                  const descOpen = openDesc === l.key;
                  const summary = l.rich ? richToPlainText(l.rich) : l.description;
                  // What this line's own discount control may give away — the database's
                  // app.document_discount_limits computes the same ceiling from the product join.
                  const lineDiscountDisabled = l.discountPolicy === "none";
                  const linePctMax = l.discountPolicy === "carwash" ? ctx.posRules.carwashPct : 100;
                  const lineAmtMax = l.discountPolicy === "carwash"
                    ? lineAllowanceCents({ qty: l.qty, unitCents: l.unitCents, vatRatePct: l.vatRatePct, policy: l.discountPolicy, discountKind: l.discountKind, discountPct: l.discountPct, discountAmountCents: l.discountAmountCents, priceInclusive: l.priceInclusive }, ctx.posRules.carwashPct)
                    : Infinity;
                  return (
                    <div key={l.key} className="rounded-[11px] border border-line bg-card">
                    <div className="flex flex-wrap items-center gap-2.5 px-3 py-2.5">
                      {!readOnly && (
                        /* The rail sits BESIDE the row, not as icons on top of the
                           content — Refrens hides these behind a hover on the row
                           itself, which is unfindable on a tablet. */
                        <div className="flex flex-col gap-px" title="Move this line">
                          <button
                            onClick={() => dispatch({ type: "moveLine", key: l.key, by: -1 })}
                            disabled={li === 0}
                            aria-label="Move line up"
                            className="grid h-3.5 w-5 place-items-center rounded-t-[5px] border border-line-2 text-faint hover:text-ink disabled:opacity-30"
                          >
                            <ChevronUp size={11} />
                          </button>
                          <button
                            onClick={() => dispatch({ type: "moveLine", key: l.key, by: 1 })}
                            disabled={li === state.lines.length - 1}
                            aria-label="Move line down"
                            className="grid h-3.5 w-5 place-items-center rounded-b-[5px] border border-line-2 text-faint hover:text-ink disabled:opacity-30"
                          >
                            <ChevronDown size={11} />
                          </button>
                        </div>
                      )}
                      <div className="min-w-0 flex-1 basis-full sm:basis-0">
                        <div className="truncate text-[13px] font-semibold text-ink">{l.title || "—"}</div>
                        {l.productId === null && <span className="text-[8.5px] font-bold tracking-[0.1em] text-[#6a55d6]">AD-HOC</span>}
                        {!descOpen && summary && (
                          <div className="truncate text-[11px] text-faint" title={summary}>{summary.replace(/\n/g, " · ")}</div>
                        )}
                      </div>
                      <button
                        onClick={() => !readOnly && dispatch({ type: "patchLine", key: l.key, patch: { vatRatePct: l.vatRatePct > 0 ? 0 : 15 } })}
                        className={`h-7 rounded-[7px] px-2.5 text-[10.5px] font-bold ${l.vatRatePct > 0 ? "bg-[rgba(43,140,255,0.14)] text-link" : "bg-[rgba(15,23,32,0.06)] text-faint"}`}
                      >
                        VAT
                      </button>
                      {!readOnly && (
                        <div
                          className={`flex items-center rounded-[7px] border border-line-2 bg-sub ${lineDiscountDisabled ? "opacity-50" : ""}`}
                          title={lineDiscountDisabled ? "This service is not discounted — ask the owner" : "Line discount (% or Rs off)"}
                        >
                          <button
                            disabled={lineDiscountDisabled}
                            onClick={() => dispatch({ type: "patchLine", key: l.key, patch: { discountKind: l.discountKind === "amount" ? "percent" : "amount", discountPct: 0, discountAmountCents: 0 } })}
                            className="grid h-7 w-6 place-items-center text-[10px] font-bold text-faint disabled:cursor-not-allowed"
                          >
                            {l.discountKind === "amount" ? "Rs" : "%"}
                          </button>
                          <input
                            disabled={lineDiscountDisabled}
                            value={l.discountKind === "amount" ? (l.discountAmountCents ? String(l.discountAmountCents / 100) : "") : (l.discountPct || "")}
                            onChange={(e) =>
                              l.discountKind === "amount"
                                ? dispatch({ type: "patchLine", key: l.key, patch: { discountAmountCents: Math.min(lineAmtMax, Math.max(0, parseMoneyInput(e.target.value) ?? 0)) } })
                                : dispatch({ type: "patchLine", key: l.key, patch: { discountPct: Math.min(linePctMax, Math.max(0, parseFloat(e.target.value) || 0)) } })
                            }
                            inputMode="decimal"
                            placeholder="disc"
                            className="h-7 w-11 bg-transparent pr-1.5 text-right text-[11px] text-body outline-none placeholder:text-faint disabled:cursor-not-allowed"
                          />
                        </div>
                      )}
                      {!readOnly && (
                        /* Stays NET on purpose. Displaying gross here fed grossCents(netFromGrossCents(x))
                           back into a controlled input, and that is not an identity (~13% of values land a
                           cent out) — the field rewrote itself under the cursor and saved a mangled rate
                           (typing "1500" could bill Rs 149.99). The line total and the printed document
                           below state the shelf price, and so does this box — type what the customer pays. */
                        <div className="relative w-[96px]" title={ctx.pricesInclVat ? "Unit rate (incl. VAT)" : "Unit rate (excl. VAT)"}>
                          <span className="num absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-faint">Rs</span>
                          <MoneyField
                            // Gross in, net stored — ONE WAY. The typed text is never derived back
                            // from unitCents (see MoneyField), so the conversion cannot round a
                            // price out from under the person entering it. The tablet's quote box
                            // takes gross too; this box used to take net, so the same typed 1500
                            // billed Rs 1,725.00 here and Rs 1,500.00 there.
                            syncKey={l.productId ?? l.key}
                            // A flagged line's stored unit IS the shelf figure — show it as stored.
                            cents={l.priceInclusive ? l.unitCents : ctx.pricesInclVat ? grossCents(l.unitCents, l.vatRatePct) : l.unitCents}
                            // Typing under gross pricing makes THAT figure the price: stored as
                            // typed with price_includes_vat, the ledger extracts the VAT and the
                            // total lands on the typed number (20260812000020) — no conversion
                            // left to round a cent off.
                            onCents={(c) => dispatch({ type: "patchLine", key: l.key, patch: ctx.pricesInclVat ? { unitCents: c, priceInclusive: true } : { unitCents: unitCentsFromTyped(c, l.vatRatePct, false) } })}
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
                          <input
                            value={l.unitLabel}
                            onChange={(e) => dispatch({ type: "patchLine", key: l.key, patch: { unitLabel: e.target.value.slice(0, 24) } })}
                            placeholder="unit"
                            title={'Unit shown beside the quantity — "panels", "hrs". Leave blank for none.'}
                            className="h-7 w-[58px] rounded-[7px] border border-line-2 bg-sub px-2 text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-brand"
                          />
                        </div>
                      )}
                      {readOnly && l.unitLabel && <span className="text-[12px] text-muted">{l.unitLabel}</span>}
                      <span className="num min-w-[78px] text-right text-[13px] font-bold text-ink">{formatMUR(l.priceInclusive ? lt.exclCents + lt.vatCents : ctx.pricesInclVat ? grossCents(net, l.vatRatePct) : net)}</span>
                      {!readOnly && (
                        <>
                          <button
                            onClick={() => setOpenDesc(descOpen ? null : l.key)}
                            aria-expanded={descOpen}
                            title={summary ? "Edit this line's description" : "Add a description to this line"}
                            className={`grid size-[26px] place-items-center rounded-[7px] border ${descOpen || summary ? "border-brand bg-[rgba(43,140,255,0.12)] text-link" : "border-line-2 bg-sub text-faint hover:text-body"}`}
                          >
                            <AlignLeft size={13} />
                          </button>
                          <button
                            onClick={() => dispatch({ type: "duplicateLine", key: l.key })}
                            title="Duplicate this line"
                            aria-label="Duplicate line"
                            className="grid size-[26px] place-items-center rounded-[7px] border border-line-2 bg-sub text-faint hover:text-body"
                          >
                            <Copy size={13} />
                          </button>
                          <button onClick={() => dispatch({ type: "removeLine", key: l.key })} aria-label="Remove line" className="grid size-[26px] place-items-center rounded-[7px] bg-[rgba(255,84,104,0.12)] text-rose"><X size={13} strokeWidth={2.6} /></button>
                        </>
                      )}
                    </div>
                    {!readOnly && descOpen && (
                      <div className="px-3 pb-3">
                        <RichEditor
                          value={l.rich}
                          onChange={(doc) => dispatch({ type: "patchLine", key: l.key, patch: { rich: doc } })}
                          onClose={() => setOpenDesc(null)}
                        />
                        {!l.rich && l.description && (
                          <p className="mt-1.5 text-[11px] text-faint">
                            This line has an older plain-text description: &ldquo;{l.description}&rdquo;. Typing above replaces it.
                          </p>
                        )}
                      </div>
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
              <button onClick={() => dispatch({ type: "addCustomField" })} className={btn("subtle")}>
                <Plus size={14} /> Add field
              </button>
              <p className="mt-1.5 text-[11px] text-faint">Extra label/value details shown in the document header. Save reusable ones in Settings → Templates to get one-click buttons here.</p>
            </div>
          )}

          {/* internal comment — back-office only, never printed on a receipt/PDF */}
          {(!readOnly || state.comment) && (
            <div className="border-t border-line pt-4">
              <div className={`${label} mb-2.5`}>Internal comment</div>
              {readOnly ? (
                <p className="whitespace-pre-wrap rounded-[11px] border border-line bg-sub px-3.5 py-2.5 text-[13px] text-body">{state.comment}</p>
              ) : (
                <>
                  <textarea
                    value={state.comment}
                    onChange={(e) => dispatch({ type: "setComment", comment: e.target.value })}
                    rows={2}
                    placeholder="A note for the shop — e.g. staff discount approved, collect Friday PM"
                    className="w-full resize-y rounded-[11px] border border-line-2 bg-sub px-3.5 py-2.5 text-[13px] font-medium text-ink outline-none placeholder:text-faint focus:border-brand"
                  />
                  <p className="mt-1.5 text-[11px] text-faint">Shown on the Sales list and the invoice screen. Never printed on the customer&rsquo;s receipt or invoice PDF.</p>
                </>
              )}
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
            {!readOnly && allowance.actualCents > 0 && (
              <p className="mb-2 text-[11px] text-faint">
                Up to {formatMUR(allowance.ceilingCents)} may be discounted on this bill.
              </p>
            )}
            {!readOnly && allowance.reasonRequired && (
              <input
                value={state.docDiscountReason}
                onChange={(e) => dispatch({ type: "setDiscountReason", reason: e.target.value })}
                required
                placeholder="Why — e.g. regular customer, repeat wash"
                className="mb-2 h-9 w-full rounded-[9px] border border-line-2 bg-sub px-2.5 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-brand"
              />
            )}
            {!readOnly && discountBlockReason && (
              <p className="mb-2 text-[11px] font-semibold text-rose">{discountBlockReason}</p>
            )}
            <div className="flex justify-between py-1 text-muted"><span>Subtotal</span><span className="num text-ink">{formatMUR(subtotalShown)}</span></div>
            {discountShown > 0 && (
              <div className="flex justify-between py-1 text-amber-ink"><span>Discount</span><span className="num">−{formatMUR(discountShown)}</span></div>
            )}
            <div className="flex justify-between py-1 text-muted"><span>{ctx.pricesInclVat ? "of which VAT (15%)" : "VAT (15%)"}</span><span className="num text-ink">{formatMUR(totals.vatCents)}</span></div>
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

      {overrideDialogDocId && (
        <OwnerOverrideDialog
          documentId={overrideDialogDocId}
          docType={state.docType}
          requestedCents={allowance.actualCents}
          onClose={() => setOverrideDialogDocId(null)}
          onApproved={(cents) => { setApprovedMaxCents(cents); setOverrideDialogDocId(null); }}
        />
      )}
    </div>
  );
}
