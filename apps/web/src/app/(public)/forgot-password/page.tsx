import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { Brand } from "@/components/shell/Brand";
import { ForgotForm } from "./ForgotForm";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const [ctx, sp] = await Promise.all([getSessionContext(), searchParams]);
  if (ctx) redirect("/dashboard"); // already signed in — nothing to reset your way back into

  return (
    <div className="relative grid min-h-dvh place-items-center px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(720px 420px at 50% 0%, rgba(43,140,255,.10), transparent 70%)" }}
      />
      <div className="relative w-full max-w-sm">
        <div className="rounded-[18px] border border-line bg-card p-8" style={{ boxShadow: "0 30px 80px rgba(15,23,32,.12)" }}>
          <Brand />
          <h1 className="mt-7 font-display text-xl font-extrabold text-ink-strong">Forgot your password?</h1>
          <p className="mt-1 text-sm text-muted">Enter your email and we&apos;ll send you a link to set a new one.</p>
          {sp.expired === "1" && (
            <p className="mt-4 rounded-[10px] border border-[rgba(245,166,35,.35)] bg-[rgba(245,166,35,.1)] px-3 py-2 text-xs text-amber-ink">
              That link has expired or was already used. Ask for a new one below.
            </p>
          )}
          <ForgotForm />
        </div>
        <p className="mt-5 text-center text-xs text-faint">Carfectionist · Mauritius · under Haz Software</p>
      </div>
    </div>
  );
}
