"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initial: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);

  return (
    <form action={action} className="mt-7 space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium tracking-wide text-graphite-400">
          Email
        </span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="h-11 w-full rounded-md border border-graphite-700 bg-graphite-850 px-3 text-sm text-graphite-100 outline-none transition-colors placeholder:text-graphite-600 focus:border-teal"
          placeholder="you@carfectionist.mu"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium tracking-wide text-graphite-400">
          Password
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11 w-full rounded-md border border-graphite-700 bg-graphite-850 px-3 text-sm text-graphite-100 outline-none transition-colors placeholder:text-graphite-600 focus:border-teal"
          placeholder="••••••••••"
        />
      </label>

      {state.error && (
        <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="h-11 w-full rounded-md bg-teal font-semibold text-graphite-950 transition-colors hover:bg-teal-bright disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
