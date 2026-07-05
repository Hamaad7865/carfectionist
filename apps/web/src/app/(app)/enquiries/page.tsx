import Link from "next/link";
import { Mail, ExternalLink } from "lucide-react";
import { getEnquiries } from "@/lib/supabase/queries/enquiries";
import { StatusPill } from "@/components/ui/StatusPill";
import { ConvertEnquiryButton } from "@/features/enquiries/ConvertEnquiryButton";

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p.length > 1 ? p[0][0] + p[1][0] : name.slice(0, 2)) || "?").toUpperCase();
}

const FORM_FIELDS = [
  { label: "Full name", required: true },
  { label: "Phone", required: true },
  { label: "Email", required: false },
  { label: "Vehicle (make / model / plate)", required: false },
  { label: "What do you need?", required: false },
];

export default async function EnquiriesPage() {
  const { rows, newCount } = await getEnquiries();

  return (
    <div className="grid grid-cols-1 items-start gap-4 p-6 lg:grid-cols-[1fr_400px]">
      {/* inbox */}
      <div className="overflow-hidden rounded-[15px] border border-line bg-card">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <span className="font-display text-[14px] font-bold text-ink">Enquiry inbox</span>
          <span className="rounded-lg bg-[rgba(43,140,255,0.14)] px-2.5 py-1 text-[11px] font-bold text-[#2f78de]">{newCount} new</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-16 text-center text-[13px] text-faint">
            No enquiries yet. Submissions to the public form land here.
          </div>
        ) : (
          rows.map((e) => (
            <div key={e.id} className="flex items-center gap-3.5 border-b border-line px-5 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-[11px] font-display text-[13px] font-extrabold text-[#3f5065]" style={{ background: "linear-gradient(140deg,#e5eaf1,#d2dae4)" }}>
                {initials(e.name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-bold text-ink">{e.name}</span>
                  <StatusPill status={e.status} />
                  <span className="text-[11px] text-faint">{e.createdAt.slice(0, 10)}</span>
                </div>
                <div className="mt-0.5 truncate text-[12.5px] text-[#5e6a77]">
                  {[e.vehicleInfo, e.message ? `“${e.message}”` : null].filter(Boolean).join(" · ") || e.phone || e.email || "—"}
                </div>
              </div>
              <ConvertEnquiryButton enquiryId={e.id} converted={!!e.convertedCustomerId} />
            </div>
          ))
        )}
      </div>

      {/* public form info */}
      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7e8894]">Public enquiry form</div>
        <a href="/enquiry" target="_blank" rel="noreferrer" className="mb-3.5 flex items-center gap-1.5 text-[12px] font-semibold text-link">
          Open the form <ExternalLink size={12} />
        </a>
        <div className="flex flex-col gap-2">
          {FORM_FIELDS.map((f) => (
            <div key={f.label} className="flex items-center gap-2.5 rounded-[10px] border border-line px-3 py-2.5">
              <Mail size={15} className="text-faint" />
              <span className="flex-1 text-[12.5px] font-semibold text-body">{f.label}</span>
              {f.required && <span className="text-[9px] font-bold text-amber-ink">REQUIRED</span>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-muted">
          Submissions insert straight into the inbox via a service-role write — no login needed for visitors.{" "}
          <Link href="/contacts" className="text-link">Convert</Link> turns an enquiry into a customer.
        </p>
      </div>
    </div>
  );
}
