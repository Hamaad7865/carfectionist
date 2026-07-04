import { Brand } from "@/components/shell/Brand";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="relative grid min-h-dvh place-items-center px-4">
      <div className="teal-glow pointer-events-none absolute inset-0" />
      <div className="relative w-full max-w-sm">
        <div className="edge-hi rounded-2xl border border-graphite-700 bg-graphite-900 p-8">
          <Brand />
          <h1 className="mt-7 font-display text-xl font-semibold text-graphite-100">Sign in</h1>
          <p className="mt-1 text-sm text-graphite-500">
            Detailing studio management — back office.
          </p>
          <LoginForm />
        </div>
        <p className="mt-5 text-center text-xs text-graphite-600">
          Carfectionist · Mauritius · under Haz Software
        </p>
      </div>
    </div>
  );
}
