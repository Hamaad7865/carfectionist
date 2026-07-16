"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Megaphone, ChevronRight } from "lucide-react";
import { CampaignWizard } from "./CampaignWizard";
import type { CampaignRow, WaTemplateRow, AudienceContact } from "@/lib/supabase/queries/marketing";
import { btn } from "@/components/ui/button";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Ready to send", cls: "bg-band text-body" },
  sending: { label: "Sending…", cls: "bg-[rgba(43,140,255,0.14)] text-link" },
  done: { label: "Sent", cls: "bg-[rgba(13,167,124,0.14)] text-mint" },
  failed: { label: "Completed with errors", cls: "bg-[rgba(245,166,35,0.16)] text-amber-ink" },
  archived: { label: "Archived", cls: "bg-sub text-faint" },
};

export function CampaignsPanel({ campaigns, templates, audience }: { campaigns: CampaignRow[]; templates: WaTemplateRow[]; audience: AudienceContact[] }) {
  const [wizard, setWizard] = useState(false);
  const approved = templates.filter((t) => t.status === "approved");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-[12.5px] text-muted">{campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}</div>
        <button
          onClick={() => setWizard(true)}
          disabled={approved.length === 0}
          title={approved.length === 0 ? "Approve a template first" : undefined}
          className={btn("primary")}
        >
          <Plus size={15} /> New campaign
        </button>
      </div>

      {approved.length === 0 && (
        <div className="rounded-[12px] border border-line bg-[rgba(245,166,35,0.06)] px-4 py-3 text-[12.5px] text-amber-ink">
          You need at least one WhatsApp-approved template before you can send a campaign. Create one in the <span className="font-bold">Templates</span> tab and submit it for approval.
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="rounded-[15px] border border-dashed border-line-2 px-5 py-16 text-center">
          <Megaphone size={26} className="mx-auto text-faint" />
          <p className="mt-2 text-[13px] text-faint">No campaigns yet. Once you have an approved template, create a campaign to reach your contacts.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {campaigns.map((c) => {
            const st = STATUS[c.status] ?? STATUS.draft;
            const pct = c.total > 0 ? Math.round((c.sent / c.total) * 100) : 0;
            return (
              <Link key={c.id} href={`/marketing/${c.id}`} className="group rounded-[13px] border border-line bg-card p-4 transition-colors hover:border-line-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-bold text-ink">{c.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-muted">
                      <span className="num">{c.templateName}</span>
                      <span className="text-faint">·</span>
                      <span>{c.createdAt}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="num text-[13px] font-bold text-ink">{c.sent}/{c.total}</div>
                      <div className="text-[10.5px] text-faint">delivered{c.failed > 0 ? ` · ${c.failed} failed` : ""}</div>
                    </div>
                    <ChevronRight size={17} className="text-faint transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
                {(c.status === "sending" || c.status === "done" || c.status === "failed") && c.total > 0 && (
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-band">
                    <div className="h-full rounded-full bg-mint transition-all" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {wizard && <CampaignWizard templates={approved} audience={audience} onClose={() => setWizard(false)} />}
    </div>
  );
}
