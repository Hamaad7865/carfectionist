"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { updateTemplateAction } from "./actions";
import type { TemplateData } from "@/lib/supabase/queries/templates";

const field =
  "h-9 w-full rounded-md border border-graphite-700 bg-graphite-850 px-2.5 text-[13px] text-graphite-100 outline-none focus:border-teal";

export function TemplateEditor({ template }: { template: TemplateData }) {
  const router = useRouter();
  const [name, setName] = useState(template.name);
  const [terms, setTerms] = useState<string[]>(template.terms.length ? template.terms : [""]);
  const [showBankDetails, setShowBankDetails] = useState(template.showBankDetails);
  const [showTerms, setShowTerms] = useState(template.showTerms);
  const [showSignature, setShowSignature] = useState(template.showSignature);
  const [headerBannerPath, setHeader] = useState(template.headerBannerPath ?? "");
  const [footerBannerPath, setFooter] = useState(template.footerBannerPath ?? "");
  const [logoPath, setLogo] = useState(template.logoPath ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setState("saving");
    setError(null);
    const res = await updateTemplateAction({
      id: template.id,
      name,
      terms,
      showBankDetails,
      showTerms,
      showSignature,
      headerBannerPath: headerBannerPath || null,
      footerBannerPath: footerBannerPath || null,
      logoPath: logoPath || null,
    });
    if (res.ok) {
      setState("saved");
      router.refresh();
    } else {
      setState("error");
      setError(res.error);
    }
  }

  const toggle = (label: string, value: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-[13px] text-graphite-300">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <div className="space-y-6">
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-graphite-500">Template name</span>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <div>
        <p className="mb-2 text-[11px] uppercase tracking-wider text-graphite-500">Default sections</p>
        <div className="flex flex-wrap gap-4">
          {toggle("Bank details", showBankDetails, setShowBankDetails)}
          {toggle("Terms", showTerms, setShowTerms)}
          {toggle("Signature line", showSignature, setShowSignature)}
        </div>
        <p className="mt-2 text-[11px] text-graphite-500">
          On invoices, the legal identity, VAT breakdown and total-in-words are always shown (fiscal lock).
        </p>
      </div>

      <div>
        <p className="mb-2 text-[11px] uppercase tracking-wider text-graphite-500">Terms &amp; conditions</p>
        <div className="space-y-2">
          {terms.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="num w-5 text-right text-graphite-500">{i + 1}.</span>
              <input
                className={field}
                value={t}
                onChange={(e) => setTerms(terms.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <button
                onClick={() => setTerms(terms.filter((_, j) => j !== i))}
                className="grid size-8 shrink-0 place-items-center rounded text-graphite-500 hover:bg-graphite-800 hover:text-danger"
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setTerms([...terms, ""])}
          className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-graphite-700 bg-graphite-850 px-2.5 text-[12px] text-graphite-100 hover:border-graphite-600"
        >
          <Plus size={14} /> Add term
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-graphite-500">Header banner URL</span>
          <input className={field} value={headerBannerPath} onChange={(e) => setHeader(e.target.value)} placeholder="optional" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-graphite-500">Footer banner URL</span>
          <input className={field} value={footerBannerPath} onChange={(e) => setFooter(e.target.value)} placeholder="optional" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-graphite-500">Logo URL</span>
          <input className={field} value={logoPath} onChange={(e) => setLogo(e.target.value)} placeholder="optional" />
        </label>
      </div>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={state === "saving"}
          className="h-9 rounded-md bg-teal px-4 text-[13px] font-semibold text-graphite-950 hover:bg-teal-bright disabled:opacity-60"
        >
          {state === "saving" ? "Saving…" : "Save template"}
        </button>
        {state === "saved" && <span className="text-[12px] text-success">Saved · default for quotes &amp; invoices</span>}
      </div>
    </div>
  );
}
