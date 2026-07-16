"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { updateTemplateAction } from "./actions";
import { BrandImageField } from "./BrandImageField";
import type { TemplateData } from "@/lib/supabase/queries/templates";

const field =
  "h-9 w-full rounded-[10px] border border-line-2 bg-sub px-2.5 text-[13px] text-ink outline-none focus:border-brand";
const lbl = "mb-1 block text-[11px] font-bold uppercase tracking-wider text-faint";

// The artwork a document falls back to when a slot is left blank. Mirrors the
// constants in components/pdf/DocumentA4.tsx, so the preview here shows what
// would actually print rather than an empty box.
const DEFAULTS = {
  header: "/brand/covered-by-diamonds.png",
  footer: "/brand/diamondbrite-forever.png",
  logo: "/brand/diamondbrite-logo.png",
};

export function TemplateEditor({
  template,
  tenantId,
  previews,
}: {
  template: TemplateData;
  tenantId: string;
  /** Signed URLs for artwork already uploaded — the bucket is private. */
  previews: { header: string | null; footer: string | null; logo: string | null };
}) {
  const router = useRouter();
  const [name, setName] = useState(template.name);
  const [terms, setTerms] = useState<string[]>(template.terms.length ? template.terms : [""]);
  const [customFields, setCustomFields] = useState<{ label: string; value: string }[]>(template.customFields);
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
      customFields: customFields.filter((f) => f.label.trim().length > 0),
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

  const toggle = (text: string, value: boolean, set: (v: boolean) => void) => (
    <button onClick={() => set(!value)} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-card px-3 py-2.5 text-left">
      <span className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors" style={{ background: value ? "#2b8cff" : "#c9d2dc" }}>
        <span className="absolute top-0.5 size-[18px] rounded-full bg-white transition-all" style={{ left: value ? "18px" : "2px" }} />
      </span>
      <span className="text-[12.5px] font-semibold text-body">{text}</span>
    </button>
  );

  return (
    <div className="space-y-6 rounded-[15px] border border-line bg-card p-6">
      <label className="block">
        <span className={lbl}>Template name</span>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">Default sections</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {toggle("Bank details", showBankDetails, setShowBankDetails)}
          {toggle("Terms", showTerms, setShowTerms)}
          {toggle("Signature line", showSignature, setShowSignature)}
        </div>
        <p className="mt-2 text-[11px] text-muted">On invoices, the legal identity, VAT breakdown and total-in-words are always shown (fiscal lock).</p>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">Terms &amp; conditions</p>
        <div className="space-y-2">
          {terms.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="num w-5 text-right text-faint">{i + 1}.</span>
              <input className={field} value={t} onChange={(e) => setTerms(terms.map((x, j) => (j === i ? e.target.value : x)))} />
              <button onClick={() => setTerms(terms.filter((_, j) => j !== i))} className="grid size-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-sub hover:text-rose">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={() => setTerms([...terms, ""])} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line-2 bg-sub px-2.5 text-[12px] font-semibold text-body">
          <Plus size={14} /> Add term
        </button>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-faint">Reusable custom fields</p>
        <p className="mb-2 text-[11px] text-muted">Define a field once here; it becomes a one-click button in the document builder. Give a default value for constants (e.g. Warranty), or leave blank to fill in per document (e.g. PO Number).</p>
        <div className="space-y-2">
          {customFields.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={`${field} sm:w-[38%]`}
                value={f.label}
                onChange={(e) => setCustomFields(customFields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="Label — e.g. PO Number"
              />
              <input
                className={field}
                value={f.value}
                onChange={(e) => setCustomFields(customFields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                placeholder="Default value (optional)"
              />
              <button onClick={() => setCustomFields(customFields.filter((_, j) => j !== i))} className="grid size-8 shrink-0 place-items-center rounded-lg text-faint hover:bg-sub hover:text-rose">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={() => setCustomFields([...customFields, { label: "", value: "" }])} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line-2 bg-sub px-2.5 text-[12px] font-semibold text-body">
          <Plus size={14} /> Add custom field
        </button>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-faint">Letterhead artwork</p>
        <p className="mb-3 text-[11px] text-muted">
          What prints at the top and bottom of every quote and invoice. Upload your own to replace the built-in Diamondbrite artwork — PNG, JPEG, WEBP or SVG, up to 5 MB. Changes apply once you save.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <BrandImageField
            label="Header banner"
            hint="Full width, across the top"
            tenantId={tenantId}
            value={headerBannerPath}
            previewUrl={previews.header}
            defaultPreview={DEFAULTS.header}
            onChange={setHeader}
          />
          <BrandImageField
            label="Footer banner"
            hint="Full width, across the bottom"
            tenantId={tenantId}
            value={footerBannerPath}
            previewUrl={previews.footer}
            defaultPreview={DEFAULTS.footer}
            onChange={setFooter}
          />
          <BrandImageField
            label="Logo"
            hint="Top right, beside the title"
            tenantId={tenantId}
            value={logoPath}
            previewUrl={previews.logo}
            defaultPreview={DEFAULTS.logo}
            onChange={setLogo}
            aspect="aspect-[6/1]"
          />
        </div>
      </div>

      {error && <p className="text-[12px] text-rose">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={state === "saving"} className="grad-brand shadow-brand inline-flex h-9 items-center justify-center rounded-[10px] px-4 text-[13px] font-bold text-white disabled:opacity-60">
          {state === "saving" ? "Saving…" : "Save template"}
        </button>
        {state === "saved" && <span className="text-[12px] font-semibold text-mint">Saved · default for quotes &amp; invoices</span>}
      </div>
    </div>
  );
}
