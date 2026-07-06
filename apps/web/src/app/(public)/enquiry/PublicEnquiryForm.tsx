"use client";

import { useState } from "react";
import { submitEnquiryAction } from "@/features/enquiries/actions";

const input =
  "h-11 w-full rounded-[10px] border border-line-2 bg-sub px-3 text-sm text-ink outline-none placeholder:text-faint focus:border-brand";
const lbl = "mb-1.5 block text-xs font-bold tracking-wide text-muted";

export function PublicEnquiryForm() {
  const [f, setF] = useState({ name: "", phone: "", email: "", vehicleInfo: "", message: "", company: "" });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    setError(null);
    if (!f.name.trim()) return setError("Please enter your name.");
    setBusy(true);
    const r = await submitEnquiryAction(f);
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(r.error);
  }

  if (done) {
    return (
      <div className="mt-7 rounded-[12px] border border-[rgba(13,167,124,0.3)] bg-[rgba(13,167,124,0.08)] p-5 text-center">
        <div className="font-display text-[16px] font-extrabold text-ink-strong">Thank you!</div>
        <p className="mt-1 text-sm text-muted">We&apos;ve received your enquiry and will be in touch shortly.</p>
      </div>
    );
  }

  return (
    <div className="mt-7 space-y-4">
      {/* Honeypot — hidden from humans, catches form-filling bots. */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={f.company}
        onChange={set("company")}
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
      />
      <label className="block">
        <span className={lbl}>Full name *</span>
        <input className={input} value={f.name} onChange={set("name")} placeholder="Your name" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={lbl}>Phone</span>
          <input className={input} value={f.phone} onChange={set("phone")} placeholder="+230 …" />
        </label>
        <label className="block">
          <span className={lbl}>Email</span>
          <input className={input} value={f.email} onChange={set("email")} placeholder="you@example.mu" />
        </label>
      </div>
      <label className="block">
        <span className={lbl}>Vehicle (make / model / plate)</span>
        <input className={input} value={f.vehicleInfo} onChange={set("vehicleInfo")} placeholder="e.g. BMW 3 Series · 1234 AB 26" />
      </label>
      <label className="block">
        <span className={lbl}>What do you need?</span>
        <textarea className={`${input} h-24 py-2.5`} value={f.message} onChange={set("message")} placeholder="Tell us about the service you're after…" />
      </label>

      {error && <p className="rounded-[10px] border border-[rgba(214,59,80,0.3)] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-xs text-rose">{error}</p>}

      <button onClick={submit} disabled={busy} className="grad-brand shadow-brand flex h-11 w-full items-center justify-center rounded-[10px] font-bold text-white disabled:opacity-60">
        {busy ? "Sending…" : "Send enquiry"}
      </button>
    </div>
  );
}
