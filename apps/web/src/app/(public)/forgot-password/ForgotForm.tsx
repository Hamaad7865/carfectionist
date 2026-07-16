"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type ForgotState } from "./actions";
import { btn } from "@/components/ui/button";

const initial: ForgotState = {};

const input =
  "h-11 w-full rounded-[10px] border border-line-2 bg-sub px-3 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-brand";

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial);

  // Only shown once the email has actually gone out, so it can name the address
  // it went to — the hedged "if that address has an account…" is gone, along with
  // the wait it caused after a typo.
  if (state.sent) {
    return (
      <div className="mt-7">
        <div className="rounded-[10px] border border-[rgba(13,167,124,.3)] bg-[rgba(13,167,124,.08)] px-4 py-3 text-sm text-mint">
          Sent. Check <span className="font-semibold">{state.sentTo}</span> for a link to set a new password.
        </div>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          The link works once and expires in about an hour. Check spam if it hasn&apos;t arrived in a couple of minutes.
        </p>
        <Link href="/login" className={btn("ghost", "lg", "mt-5 w-full")}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="mt-7 space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold tracking-wide text-muted">Email</span>
        <input name="email" type="email" autoComplete="email" required autoFocus className={input} placeholder="you@carfectionist.mu" />
      </label>

      {state.error && (
        <p className="rounded-[10px] border border-[rgba(214,59,80,.3)] bg-[rgba(214,59,80,.08)] px-3 py-2 text-xs text-rose">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={btn("primary", "lg", "w-full")}
      >
        {pending ? "Sending…" : "Send me a link"}
      </button>

      <Link href="/login" className="block text-center text-xs font-semibold text-link hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
