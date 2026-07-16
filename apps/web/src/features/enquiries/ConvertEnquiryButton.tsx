"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { convertEnquiryAction } from "./actions";
import { btnBase } from "@/components/ui/button";

export function ConvertEnquiryButton({ enquiryId, converted }: { enquiryId: string; converted: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (converted) return <span className="text-[11px] font-bold text-mint">Converted ✓</span>;

  async function go() {
    setBusy(true);
    const r = await convertEnquiryAction(enquiryId);
    setBusy(false);
    if (r.ok) router.push(`/contacts?c=${r.customerId}`);
  }

  return (
    <button
      onClick={go}
      disabled={busy}
      className={btnBase("md", "border border-[rgba(43,140,255,0.4)] bg-[rgba(43,140,255,0.1)] font-bold text-[#2f78de]")}
    >
      {busy ? "…" : "Convert →"}
    </button>
  );
}
