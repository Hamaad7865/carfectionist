const STYLES: Record<string, string> = {
  draft: "bg-[rgba(15,23,32,0.06)] text-muted",
  issued: "bg-[rgba(43,140,255,0.12)] text-link",
  accepted: "bg-[rgba(13,167,124,0.12)] text-mint",
  partly_paid: "bg-[rgba(245,166,35,0.16)] text-amber-ink",
  paid: "bg-[rgba(13,167,124,0.14)] text-mint",
  void: "bg-[rgba(214,59,80,0.12)] text-rose",
  declined: "bg-[rgba(214,59,80,0.12)] text-rose",
  expired: "bg-[rgba(15,23,32,0.06)] text-muted",
};

export function StatusPill({ status }: { status: string }) {
  const cls = STYLES[status] ?? STYLES.draft;
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-[7px] px-2.5 py-1 text-[11px] font-semibold capitalize ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
