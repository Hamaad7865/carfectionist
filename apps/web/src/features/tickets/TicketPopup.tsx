"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Printer, ExternalLink } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ReceiptCard } from "@/components/pdf/ReceiptCard";
import type { ReceiptData } from "@/lib/supabase/queries/receipt";
import type { ReactNode } from "react";

/** The Cashmag-style ticket popup: the receipt card + Print (A4 ticket) —
 *  opened by ?t=<id> on the tickets view, closed by dropping the param. */
export function TicketPopup({ r, docId, emailSlot }: { r: ReceiptData; docId: string; emailSlot?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function close() {
    const p = new URLSearchParams(sp.toString());
    p.delete("t");
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }

  return (
    <Modal
      open
      onClose={close}
      title={`Ticket ${r.number ?? ""}`}
      subtitle={`${r.dateLabel}${r.customerName ? ` · ${r.customerName}` : ""}`}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href={`/sales/${docId}`} className="mr-auto inline-flex h-10 items-center gap-1.5 rounded-[11px] px-3 text-[12.5px] font-semibold text-muted hover:text-body">
            <ExternalLink size={14} /> Open sale
          </Link>
          {emailSlot}
          <a
            href={`/print/ticket/${docId}`}
            target="_blank"
            rel="noreferrer"
            className="grad-brand shadow-brand inline-flex h-10 items-center gap-2 rounded-[11px] px-5 text-[13px] font-bold text-white"
          >
            <Printer size={15} /> Print
          </a>
        </div>
      }
    >
      <div className="mx-auto w-[300px] overflow-hidden rounded-[10px] border border-line">
        <ReceiptCard r={r} />
      </div>
    </Modal>
  );
}
