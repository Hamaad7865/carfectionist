import { waFormatToHtml } from "./render";

// The signature element: a real WhatsApp outgoing bubble on the app's wallpaper
// so the owner sees the marketing text exactly as the customer will. Purely
// presentational — takes already-rendered text.
export function WaBubble({ text, time = "14:32" }: { text: string; time?: string }) {
  return (
    <div
      className="rounded-[14px] p-4"
      style={{ background: "#e5ddd5", backgroundImage: "radial-gradient(rgba(255,255,255,0.35) 1px, transparent 0)", backgroundSize: "14px 14px" }}
    >
      <div className="ml-auto max-w-[85%]">
        <div className="relative rounded-[9px] rounded-tr-[2px] bg-[#dcf8c6] px-2.5 py-1.5 shadow-[0_1px_0.5px_rgba(0,0,0,0.13)]">
          <div
            className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.35] text-[#111b21]"
            dangerouslySetInnerHTML={{ __html: text.trim() ? waFormatToHtml(text) : '<span style="color:#8696a0">Your message preview…</span>' }}
          />
          <div className="mt-0.5 flex items-center justify-end gap-1">
            <span className="text-[10.5px] text-[#667781]">{time}</span>
            <svg width="15" height="11" viewBox="0 0 16 11" fill="none" className="translate-y-[0.5px]">
              <path d="M11.07.65a.5.5 0 0 1 .06.7l-6 7a.5.5 0 0 1-.74.03L1.6 5.6a.5.5 0 1 1 .7-.72l2.4 2.35L10.37.7a.5.5 0 0 1 .7-.05Z" fill="#53bdeb" />
              <path d="M15.07.65a.5.5 0 0 1 .06.7l-6 7a.5.5 0 0 1-.36.17.5.5 0 0 1-.32-.1l.72-.85 5.16-6.02a.5.5 0 0 1 .7-.05Z" fill="#53bdeb" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
