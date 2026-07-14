import Link from "next/link";

// Public, unauthenticated pages. Meta requires a reachable Privacy Policy URL
// before an app can be published, and publishing is what makes WhatsApp deliver
// real customer messages to us rather than test pings.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-ground">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/" className="font-display text-[17px] font-extrabold tracking-tight text-ink-strong">
            Carfectionist
          </Link>
          <nav className="flex gap-4 text-[13px] font-semibold text-muted">
            <Link href="/legal/privacy" className="hover:text-link">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-link">Terms</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10 sm:py-14">{children}</main>

      <footer className="border-t border-line px-5 py-8 text-center text-[12.5px] text-faint">
        Diamondbrite Reunion (Mauritius) Ltd, trading as Carfectionist · BRN C22190760 · Helvetia, 80840 Moka, Mauritius
      </footer>
    </div>
  );
}
