import { Brand } from "@/components/shell/Brand";
import { PublicEnquiryForm } from "./PublicEnquiryForm";

export default function EnquiryPage() {
  return (
    <div className="relative grid min-h-dvh place-items-center px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(720px 420px at 50% 0%, rgba(43,140,255,.10), transparent 70%)" }}
      />
      <div className="relative w-full max-w-md">
        <div className="rounded-[18px] border border-line bg-card p-8" style={{ boxShadow: "0 30px 80px rgba(15,23,32,.12)" }}>
          <Brand subtitle="DETAILING STUDIO" />
          <h1 className="mt-7 font-display text-xl font-extrabold text-ink-strong">Book a service</h1>
          <p className="mt-1 text-sm text-muted">Tell us what you need and we&apos;ll get back to you with a quote.</p>
          <PublicEnquiryForm />
        </div>
        <p className="mt-5 text-center text-xs text-faint">Carfectionist · Mauritius</p>
      </div>
    </div>
  );
}
