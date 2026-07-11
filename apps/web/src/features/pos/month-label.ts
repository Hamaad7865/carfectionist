// Plain shared module — NO "use client". Both the server page (Periods strip)
// and the ClosePeriodButton client component call this; exporting it from a
// client module would hand the server a client REFERENCE, and calling it
// crashes the whole page at render (this took /point-of-sale down in prod the
// moment the first month was closed).
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(period: string): string {
  const [y, m] = period.split("-");
  return `${MONTHS[Number(m) - 1] ?? period} ${y}`;
}
