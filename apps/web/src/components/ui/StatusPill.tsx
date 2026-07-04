const STYLES: Record<string, string> = {
  draft: "bg-graphite-800 text-graphite-300 ring-graphite-600",
  issued: "bg-cyan-iris/10 text-cyan-iris ring-cyan-iris/30",
  accepted: "bg-teal/10 text-teal ring-teal/30",
  partly_paid: "bg-warning/10 text-warning ring-warning/30",
  paid: "bg-success/10 text-success ring-success/30",
  void: "bg-danger/10 text-danger ring-danger/30",
  declined: "bg-danger/10 text-danger ring-danger/30",
  expired: "bg-graphite-800 text-graphite-400 ring-graphite-600",
};

export function StatusPill({ status }: { status: string }) {
  const cls = STYLES[status] ?? STYLES.draft;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
