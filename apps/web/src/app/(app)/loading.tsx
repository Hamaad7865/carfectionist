// Shown the instant a navigation starts, while the page's data is still being
// fetched. Without this the browser sits on the OLD page with no feedback until
// the server answers, which reads as "the app is slow" even when it isn't.
//
// Deliberately a calm skeleton of the usual shape (header + rows), not a
// spinner: it tells you the page is coming and roughly what's coming.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4 p-5" aria-busy="true" aria-label="Loading">
      <div className="flex items-center justify-between gap-3">
        <div className="h-6 w-48 animate-pulse rounded-[7px] bg-line-2" />
        <div className="h-9 w-36 animate-pulse rounded-[10px] bg-line-2" />
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line bg-card">
        <div className="flex gap-3 border-b border-line bg-band px-5 py-3">
          {[120, 90, 70, 80, 60, 70].map((w, i) => (
            <div key={i} className="h-3 animate-pulse rounded-[4px] bg-line-2" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, r) => (
          <div key={r} className="flex items-center gap-3 border-b border-line-2 px-5 py-3.5 last:border-0">
            {[120, 90, 70, 80, 60, 70].map((w, i) => (
              <div
                key={i}
                className="h-3.5 animate-pulse rounded-[4px] bg-line-2"
                // stagger so it reads as a wave rather than a strobe
                style={{ width: w, opacity: 1 - r * 0.07, animationDelay: `${(r * 6 + i) * 25}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
