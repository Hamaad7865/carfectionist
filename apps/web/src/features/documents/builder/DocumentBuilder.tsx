"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { Plus, Trash2, FileDown } from "lucide-react";
import { computeTotals, computeLineTotals, formatMUR, parseMoneyInput } from "@/lib/money";
import { DocumentA4 } from "@/components/pdf/DocumentA4";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  saveDraftAction,
  issueDocumentAction,
  convertQuoteToInvoiceAction,
} from "@/features/documents/actions";
import type { SaveDraftInput } from "@/features/documents/payload";
import type { BuilderContext } from "@/lib/supabase/queries/builder";
import { reducer, blankLine, newKey, type BuilderState, type BuilderLine } from "./state";
import { toDocumentProps } from "./toDocumentProps";

const input =
  "h-8 rounded border border-graphite-700 bg-graphite-850 px-2 text-[13px] text-graphite-100 outline-none focus:border-teal";

export function DocumentBuilder({ ctx, initial }: { ctx: BuilderContext; initial: BuilderState }) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, initial);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const readOnly = state.status !== "draft";
  const customer = ctx.customers.find((c) => c.id === state.customerId);

  const doSave = useCallback(async (): Promise<string | null> => {
    const s = stateRef.current;
    dispatch({ type: "saveStart" });
    const payload: SaveDraftInput = {
      doc: {
        id: s.docId,
        docType: s.docType,
        customerId: s.customerId,
        templateOverrides: s.sectionConfig as Record<string, unknown>,
      },
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

  // Debounced autosave for drafts.
  useEffect(() => {
    if (state.status !== "draft" || !state.dirty) return;
    const t = setTimeout(() => void doSave(), 1200);
    return () => clearTimeout(t);
  }, [state.dirty, state.lines, state.customerId, state.docType, state.sectionConfig, state.status, doSave]);

  async function onIssue() {
    const s = stateRef.current;
    if (s.lines.length === 0) return dispatch({ type: "saveError", error: "Add at least one line before issuing." });
    if (s.docType === "invoice" && !s.customerId)
      return dispatch({ type: "saveError", error: "An invoice requires a customer." });
    setBusy(true);
    const id = await doSave();
    if (!id) return setBusy(false);
    const res = await issueDocumentAction({ documentId: id });
    if (res.ok) {
      dispatch({ type: "issued", number: res.data.number ?? "", status: res.data.status });
      router.refresh();
    } else {
      dispatch({ type: "saveError", error: res.error });
    }
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
    state.lines.map((l) => ({ qty: l.qty, unitCents: l.unitCents, discountPct: l.discountPct, vatRatePct: l.vatRatePct })),
  );

  const previewHtml = useMemo(() => {
    const props = toDocumentProps(state, ctx.business, {
      createdBy: ctx.createdBy,
      customerName: customer?.name ?? "",
      customerCountry: customer?.country ?? "Mauritius",
      terms: ctx.templateTerms,
      number: state.number,
      issueDate: readOnly ? new Date().toISOString().slice(0, 10) : null,
    });
    return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#e9edf0;padding:16px">${renderToStaticMarkup(
      <DocumentA4 {...props} />,
    )}</body></html>`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, ctx, customer, readOnly]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 border-b border-graphite-700 px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/sales" className="text-[13px] text-graphite-400 hover:text-graphite-100">
            ← Sales
          </Link>
          <span className="font-display text-[15px] font-semibold text-graphite-100">
            {state.docType === "quote" ? "Quotation" : "Invoice"}
          </span>
          <span className="num text-[13px] text-graphite-400">{state.number ?? "Draft"}</span>
          <StatusPill status={state.status} />
          <span className="text-[11px] text-graphite-500">
            {state.save === "saving" ? "Saving…" : state.save === "saved" ? "Saved" : state.save === "error" ? "Save failed" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <button
              onClick={onIssue}
              disabled={busy}
              className="h-9 rounded-md bg-teal px-4 text-[13px] font-semibold text-graphite-950 hover:bg-teal-bright disabled:opacity-60"
            >
              {busy ? "Working…" : `Issue ${state.docType}`}
            </button>
          )}
          {readOnly && state.docId && (
            <a
              href={`/api/documents/${state.docId}/pdf`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-graphite-700 bg-graphite-850 px-3 text-[13px] text-graphite-100 hover:border-graphite-600"
            >
              <FileDown size={15} /> PDF
            </a>
          )}
          {readOnly && state.docType === "quote" && (
            <button
              onClick={onConvert}
              disabled={busy}
              className="h-9 rounded-md bg-teal px-4 text-[13px] font-semibold text-graphite-950 hover:bg-teal-bright disabled:opacity-60"
            >
              Convert to invoice
            </button>
          )}
          {readOnly && state.docType === "invoice" && state.docId && (
            <Link
              href={`/sales/${state.docId}`}
              className="h-9 rounded-md bg-teal px-4 text-[13px] font-semibold leading-9 text-graphite-950 hover:bg-teal-bright"
            >
              Record payment
            </Link>
          )}
        </div>
      </div>

      {state.saveError && (
        <div className="border-b border-danger/30 bg-danger/10 px-6 py-2 text-[13px] text-danger">{state.saveError}</div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        {/* Editor */}
        <div className="min-h-0 overflow-y-auto border-r border-graphite-700 p-6">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wider text-graphite-500">Customer</span>
            <select
              className={`${input} h-9 w-full`}
              value={state.customerId ?? ""}
              disabled={readOnly}
              onChange={(e) => dispatch({ type: "setCustomer", customerId: e.target.value || null })}
            >
              <option value="">— none —</option>
              {ctx.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {/* Lines */}
          <div className="mt-6 overflow-hidden rounded-lg border border-graphite-700">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-graphite-850 text-left text-[10px] uppercase tracking-wider text-graphite-500">
                  <th className="px-2 py-2 font-medium">Item</th>
                  <th className="w-14 px-2 py-2 text-right font-medium">Qty</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Unit price</th>
                  <th className="w-16 px-2 py-2 text-right font-medium">Disc %</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Amount</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {state.lines.map((l) => (
                  <LineRow key={l.key} line={l} readOnly={readOnly} dispatch={dispatch} />
                ))}
                {state.lines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-graphite-500">
                      No lines yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {!readOnly && (
            <div className="mt-3 flex items-center gap-2">
              <select
                className={`${input} h-9`}
                value=""
                onChange={(e) => {
                  const p = ctx.products.find((x) => x.id === e.target.value);
                  if (p)
                    dispatch({
                      type: "addLine",
                      line: {
                        key: newKey(),
                        productId: p.id,
                        title: p.name,
                        description: "",
                        qty: 1,
                        unitCents: p.unitCents,
                        discountPct: 0,
                        vatRatePct: p.vatRatePct,
                      },
                    });
                  e.target.value = "";
                }}
              >
                <option value="">+ Catalogue item…</option>
                {ctx.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatMUR(p.unitCents)}
                  </option>
                ))}
              </select>
              <button
                onClick={() => dispatch({ type: "addLine", line: blankLine() })}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-graphite-700 bg-graphite-850 px-3 text-[13px] text-graphite-100 hover:border-graphite-600"
              >
                <Plus size={15} /> Blank line
              </button>
            </div>
          )}

          {/* Section toggles */}
          {!readOnly && (
            <div className="mt-6">
              <p className="mb-2 text-[11px] uppercase tracking-wider text-graphite-500">Sections</p>
              <div className="flex flex-wrap gap-4">
                {(["bankDetails", "terms", "signature"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2 text-[13px] text-graphite-300">
                    <input
                      type="checkbox"
                      checked={state.sectionConfig[k] ?? (k !== "signature")}
                      onChange={(e) => dispatch({ type: "setSection", key: k, value: e.target.checked })}
                    />
                    {k === "bankDetails" ? "Bank details" : k === "terms" ? "Terms" : "Signature"}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Totals */}
          <div className="mt-6 ml-auto w-64 text-[13px]">
            <div className="flex justify-between py-1 text-graphite-400">
              <span>Subtotal</span>
              <span className="num text-graphite-100">{formatMUR(totals.subtotalCents)}</span>
            </div>
            <div className="flex justify-between py-1 text-graphite-400">
              <span>VAT (15%)</span>
              <span className="num text-graphite-100">{formatMUR(totals.vatCents)}</span>
            </div>
            <div className="mt-1 flex justify-between rounded-md bg-graphite-850 px-3 py-2 font-semibold">
              <span className="text-graphite-100">Total (MUR)</span>
              <span className="num text-teal">{formatMUR(totals.totalCents)}</span>
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="min-h-0 overflow-hidden bg-graphite-950">
          <iframe title="Preview" srcDoc={previewHtml} className="h-full w-full border-0" />
        </div>
      </div>
    </div>
  );
}

function LineRow({
  line,
  readOnly,
  dispatch,
}: {
  line: BuilderLine;
  readOnly: boolean;
  dispatch: React.Dispatch<import("./state").BuilderAction>;
}) {
  const amount = computeLineTotals({ qty: line.qty, unitCents: line.unitCents, discountPct: line.discountPct, vatRatePct: line.vatRatePct }).exclCents;
  return (
    <tr className="border-t border-graphite-700 align-top">
      <td className="px-2 py-1.5">
        <input
          className={`${input} w-full`}
          defaultValue={line.title}
          readOnly={readOnly}
          placeholder="Item title"
          onBlur={(e) => dispatch({ type: "patchLine", key: line.key, patch: { title: e.target.value } })}
        />
        <textarea
          className={`${input} mt-1 h-auto min-h-8 w-full resize-y py-1`}
          defaultValue={line.description}
          readOnly={readOnly}
          placeholder="Optional detail…"
          rows={line.description ? 2 : 1}
          onBlur={(e) => dispatch({ type: "patchLine", key: line.key, patch: { description: e.target.value } })}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          className={`${input} w-full text-right`}
          defaultValue={line.qty}
          readOnly={readOnly}
          inputMode="decimal"
          onBlur={(e) => dispatch({ type: "patchLine", key: line.key, patch: { qty: Math.max(0.001, Number(e.target.value) || 1) } })}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          className={`${input} w-full text-right`}
          defaultValue={(line.unitCents / 100).toFixed(2)}
          readOnly={readOnly}
          inputMode="decimal"
          onBlur={(e) => {
            const cents = parseMoneyInput(e.target.value);
            dispatch({ type: "patchLine", key: line.key, patch: { unitCents: cents ?? 0 } });
          }}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          className={`${input} w-full text-right`}
          defaultValue={line.discountPct}
          readOnly={readOnly}
          inputMode="decimal"
          onBlur={(e) =>
            dispatch({ type: "patchLine", key: line.key, patch: { discountPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } })
          }
        />
      </td>
      <td className="num px-2 py-1.5 text-right text-graphite-100">{formatMUR(amount)}</td>
      <td className="px-1 py-1.5">
        {!readOnly && (
          <button
            onClick={() => dispatch({ type: "removeLine", key: line.key })}
            className="grid size-7 place-items-center rounded text-graphite-500 hover:bg-graphite-800 hover:text-danger"
            title="Remove line"
          >
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}
