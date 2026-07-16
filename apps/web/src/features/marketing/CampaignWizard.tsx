"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ArrowRight, ArrowLeft, Users, Search, Send, AlertTriangle, Ban } from "lucide-react";
import { createCampaignAction } from "./actions";
import { renderVariables, renderBodyPreview } from "./render";
import { WaBubble } from "./WaBubble";
import { formatPhone } from "@/lib/phone";
import type { WaTemplateRow, AudienceContact } from "@/lib/supabase/queries/marketing";
import { btn } from "@/components/ui/button";

const field = "h-10 w-full rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand";
const VAR_SOURCES = [
  { value: "first_name", label: "First name" },
  { value: "name", label: "Full name" },
  { value: "static", label: "Fixed text…" },
];

type Filter = "all" | "individuals" | "companies";

export function CampaignWizard({ templates, audience, onClose }: { templates: WaTemplateRow[]; audience: AudienceContact[]; onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const template = templates.find((t) => t.id === templateId) ?? null;

  // Variable mapping: for each {{n}}, a source + (if static) the literal text.
  const [varSource, setVarSource] = useState<Record<number, string>>({});
  const [varStatic, setVarStatic] = useState<Record<number, string>>({});

  // Audience selection
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variableMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (let i = 1; i <= (template?.variableCount ?? 0); i++) {
      const src = varSource[i] ?? "first_name";
      m[String(i)] = src === "static" ? `static:${varStatic[i] ?? ""}` : src;
    }
    return m;
  }, [template, varSource, varStatic]);

  const sampleContact = audience.find((a) => a.phoneE164 && !a.optedOut) ?? audience[0] ?? { name: "Anesh Boodoo" } as AudienceContact;
  const previewText = template ? renderBodyPreview(template.body, renderVariables(variableMap, template.variableCount, { name: sampleContact.name })) : "";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return audience.filter((c) => {
      if (filter === "individuals" && c.isCompany) return false;
      if (filter === "companies" && !c.isCompany) return false;
      if (q && !c.name.toLowerCase().includes(q) && !(c.phoneRaw ?? "").includes(q)) return false;
      return true;
    });
  }, [audience, filter, search]);

  const reachable = filtered.filter((c) => c.phoneE164 && !c.optedOut);
  const selectedContacts = audience.filter((c) => selected.has(c.id));
  const selectedReachable = selectedContacts.filter((c) => c.phoneE164 && !c.optedOut);
  const selectedInvalid = selectedContacts.filter((c) => !c.phoneE164);
  const selectedOptedOut = selectedContacts.filter((c) => c.optedOut);

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAllReachable() {
    setSelected((prev) => { const n = new Set(prev); reachable.forEach((c) => n.add(c.id)); return n; });
  }
  function clearSelection() { setSelected(new Set()); }

  async function create() {
    if (!template) return;
    setBusy(true);
    setError(null);
    const r = await createCampaignAction({
      name: name.trim(),
      templateId,
      variableMap,
      audience: { filter, customerIds: [...selected] },
    });
    setBusy(false);
    if (r.ok) router.push(`/marketing/${r.id}`);
    else setError(r.error);
  }

  const canNext1 = name.trim() && template;
  const canNext2 = true; // variable mapping always has defaults
  const canCreate = selectedReachable.length > 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-[18px] border border-line bg-app" onClick={(e) => e.stopPropagation()}>
        {/* header + steps */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-[15px] font-bold text-ink-strong">New campaign</span>
            <div className="flex items-center gap-1">
              {[1, 2, 3].map((s) => (
                <span key={s} className={`h-1.5 rounded-full transition-all ${s === step ? "w-6 bg-brand" : s < step ? "w-3 bg-brand/50" : "w-3 bg-line-2"}`} />
              ))}
            </div>
          </div>
          <button onClick={onClose} className="grid size-8 place-items-center rounded-[9px] border border-line-2 bg-card text-muted hover:text-body"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Campaign name (internal)</span>
                <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="July ceramic promo" />
              </label>
              <div>
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">Approved template</span>
                <div className="mt-1.5 flex flex-col gap-2">
                  {templates.map((t) => (
                    <button key={t.id} onClick={() => setTemplateId(t.id)} className={`rounded-[12px] border px-3.5 py-3 text-left transition-colors ${templateId === t.id ? "border-brand bg-[rgba(43,140,255,0.05)]" : "border-line bg-card hover:border-line-2"}`}>
                      <div className="flex items-center gap-2">
                        <span className="num text-[13px] font-bold text-ink">{t.name}</span>
                        <span className="rounded-[6px] bg-sub px-1.5 py-0.5 text-[10px] font-bold uppercase text-faint">{t.language}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12px] leading-snug text-muted">{t.body}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && template && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
              <div className="flex flex-col gap-3">
                <div className="text-[12.5px] text-muted">Bind each variable to a contact field, or type fixed text everyone receives.</div>
                {template.variableCount === 0 ? (
                  <div className="rounded-[11px] border border-line bg-card px-3.5 py-3 text-[12.5px] text-muted">This template has no variables — everyone gets the same message.</div>
                ) : (
                  Array.from({ length: template.variableCount }, (_, i) => i + 1).map((n) => (
                    <div key={n} className="rounded-[11px] border border-line bg-card p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="num rounded-[6px] bg-band px-1.5 py-0.5 text-[11px] font-bold text-body">{`{{${n}}}`}</span>
                        <span className="text-[12px] text-faint">Variable {n}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {VAR_SOURCES.map((s) => (
                          <button key={s.value} onClick={() => setVarSource((p) => ({ ...p, [n]: s.value }))} className={`h-8 rounded-[9px] px-2.5 text-[12px] font-semibold ${(varSource[n] ?? "first_name") === s.value ? "grad-brand text-white" : "border border-line-2 bg-sub text-body"}`}>{s.label}</button>
                        ))}
                      </div>
                      {(varSource[n] ?? "first_name") === "static" && (
                        <input value={varStatic[n] ?? ""} onChange={(e) => setVarStatic((p) => ({ ...p, [n]: e.target.value }))} placeholder="e.g. 20%" className={`${field} mt-2`} />
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="lg:sticky lg:top-0">
                <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-faint">Preview</div>
                <WaBubble text={previewText} />
                <p className="mt-2 text-[11px] text-faint">Shown for {sampleContact.name}.</p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {(["all", "individuals", "companies"] as Filter[]).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={`h-8 rounded-[9px] px-3 text-[12.5px] font-semibold capitalize ${filter === f ? "grad-brand text-white" : "border border-line-2 bg-card text-body"}`}>{f}</button>
                ))}
                <div className="relative ml-auto">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or number" className="h-8 w-48 rounded-[9px] border border-line-2 bg-sub pl-8 pr-2.5 text-[12.5px] text-ink outline-none focus:border-brand" />
                </div>
              </div>

              <div className="flex items-center justify-between text-[12px]">
                <div className="flex items-center gap-2 text-muted">
                  <Users size={14} className="text-faint" />
                  <button onClick={selectAllReachable} className="font-semibold text-link hover:underline">Select all reachable ({reachable.length})</button>
                  {selected.size > 0 && <button onClick={clearSelection} className="text-faint hover:text-body">Clear</button>}
                </div>
                <span className="font-semibold text-body">{selectedReachable.length} selected</span>
              </div>

              <div className="max-h-[300px] overflow-y-auto rounded-[12px] border border-line bg-card">
                {filtered.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[12.5px] text-faint">No contacts match.</div>
                ) : filtered.map((c) => {
                  const disabled = !c.phoneE164 || c.optedOut;
                  const on = selected.has(c.id);
                  return (
                    <button key={c.id} onClick={() => !disabled && toggle(c.id)} disabled={disabled} className={`flex w-full items-center gap-3 border-b border-line px-3.5 py-2.5 text-left last:border-0 ${disabled ? "opacity-55" : on ? "bg-band" : "hover:bg-sub"}`}>
                      <span className={`grid size-5 shrink-0 place-items-center rounded-[6px] border-2 ${on ? "border-brand bg-brand" : "border-line-2"}`}>{on && <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">{c.name}{c.isCompany && <span className="ml-1.5 rounded-[5px] bg-sub px-1 py-0.5 text-[9.5px] font-bold uppercase text-faint">Co</span>}</span>
                        <span className="num block truncate text-[11.5px] text-muted">{c.phoneE164 ? formatPhone(c.phoneE164) : c.phoneRaw || "no number"}</span>
                      </span>
                      {c.optedOut && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose"><Ban size={12} /> opted out</span>}
                      {!c.phoneE164 && !c.optedOut && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-ink"><AlertTriangle size={12} /> no number</span>}
                    </button>
                  );
                })}
              </div>

              {(selectedInvalid.length > 0 || selectedOptedOut.length > 0) && (
                <p className="text-[11.5px] text-muted">
                  {selectedInvalid.length > 0 && `${selectedInvalid.length} without a valid number will be skipped. `}
                  {selectedOptedOut.length > 0 && `${selectedOptedOut.length} opted out and won't be messaged.`}
                </p>
              )}
              {error && <p className="rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">{error}</p>}
            </div>
          )}
        </div>

        {/* footer nav */}
        <div className="flex items-center justify-between border-t border-line px-5 py-3.5">
          {step > 1 ? (
            <button onClick={() => setStep(step - 1)} className={btn("ghost", "lg")}><ArrowLeft size={15} /> Back</button>
          ) : <span />}
          {step < 3 ? (
            <button onClick={() => setStep(step + 1)} disabled={step === 1 ? !canNext1 : !canNext2} className={btn("primary", "lg")}>Continue <ArrowRight size={15} /></button>
          ) : (
            <button onClick={create} disabled={busy || !canCreate} className={btn("primary", "lg", "gap-2 px-5")}>
              <Send size={15} /> {busy ? "Creating…" : `Create campaign · ${selectedReachable.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
