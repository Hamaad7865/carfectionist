"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type LoginState } from "./actions";
import { btn } from "@/components/ui/button";

const initial: LoginState = {};

const input =
  "h-11 w-full rounded-[10px] border border-line-2 bg-sub px-3 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-brand";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);

  return (
    <form action={action} className="mt-7 space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold tracking-wide text-muted">Email</span>
        <input name="email" type="email" autoComplete="email" required className={input} placeholder="you@carfectionist.mu" />
      </label>

      <label className="block">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-xs font-bold tracking-wide text-muted">Password</span>
          <Link href="/forgot-password" className="text-xs font-semibold text-link hover:underline">
            Forgot?
          </Link>
        </div>
        <input name="password" type="password" autoComplete="current-password" required className={input} placeholder="••••••••••" />
      </label>

      {state.error && (
        <p className="rounded-[10px] border border-[rgba(214,59,80,.3)] bg-[rgba(214,59,80,.08)] px-3 py-2 text-xs text-rose">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={btn("primary", "lg", "w-full")}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
