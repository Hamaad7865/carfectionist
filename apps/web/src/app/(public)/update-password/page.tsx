import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Brand } from "@/components/shell/Brand";
import { UpdateForm } from "./UpdateForm";

export const dynamic = "force-dynamic";

export default async function UpdatePasswordPage() {
  // Reached only with the session /auth/reset just minted. No session means the
  // link was never followed, or it lapsed — send them back for a fresh one
  // rather than showing a form that cannot save.
  const sb = await createClient();
  const { data } = await sb.auth.getUser();
  if (!data?.user) redirect("/forgot-password?expired=1");

  return (
    <div className="relative grid min-h-dvh place-items-center px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(720px 420px at 50% 0%, rgba(43,140,255,.10), transparent 70%)" }}
      />
      <div className="relative w-full max-w-sm">
        <div className="rounded-[18px] border border-line bg-card p-8" style={{ boxShadow: "0 30px 80px rgba(15,23,32,.12)" }}>
          <Brand />
          <h1 className="mt-7 font-display text-xl font-extrabold text-ink-strong">Choose a new password</h1>
          <p className="mt-1 text-sm text-muted">
            For <span className="font-semibold text-body">{data.user.email}</span>. You&apos;ll be signed in straight after.
          </p>
          <UpdateForm />
        </div>
        <p className="mt-5 text-center text-xs text-faint">Carfectionist · Mauritius · under Haz Software</p>
      </div>
    </div>
  );
}
