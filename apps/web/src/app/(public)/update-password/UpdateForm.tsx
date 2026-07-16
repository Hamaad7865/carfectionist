"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { updateMyPassword, type UpdateState } from "./actions";
import { btn } from "@/components/ui/button";

const initial: UpdateState = {};

const input =
  "h-11 w-full rounded-[10px] border border-line-2 bg-sub px-3 pr-10 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-brand";

export function UpdateForm() {
  const [state, action, pending] = useActionState(updateMyPassword, initial);
  const [show, setShow] = useState(false);

  return (
    <form action={action} className="mt-7 space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-bold tracking-wide text-muted">New password</span>
        <div className="relative">
          <input
            name="password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            autoFocus
            className={input}
            placeholder="At least 8 characters"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-[7px] text-faint hover:bg-sub hover:text-body"
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-bold tracking-wide text-muted">Confirm password</span>
        <input name="confirm" type={show ? "text" : "password"} autoComplete="new-password" required minLength={8} className={input} placeholder="Type it again" />
      </label>

      {state.error && (
        <p className="rounded-[10px] border border-[rgba(214,59,80,.3)] bg-[rgba(214,59,80,.08)] px-3 py-2 text-xs text-rose">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={btn("primary", "lg", "w-full")}
      >
        {pending ? "Saving…" : "Save password and sign in"}
      </button>
    </form>
  );
}
