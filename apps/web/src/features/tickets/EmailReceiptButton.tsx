"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Field, inputCls, FormError } from "@/components/ui/form";
import { sendReceiptEmailAction } from "./actions";
import { btn } from "@/components/ui/button";

/** "Email" on the ticket popup: sends the branded receipt mail with the
 *  hosted-ticket link. Prefills the customer's address when we have it. */
export function EmailReceiptButton({ docId, defaultEmail }: { docId: string; defaultEmail: string | null }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function send() {
    setError(null);
    setBusy(true);
    const r = await sendReceiptEmailAction({ docId, email: email.trim() });
    setBusy(false);
    if (r.ok) setSentTo(email.trim());
    else setError(r.error);
  }

  return (
    <>
      <button
        onClick={() => { setError(null); setSentTo(null); setOpen(true); }}
        className={btn("ghost", "lg")}
      >
        <Mail size={15} /> Email
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Email this ticket"
        subtitle="The customer gets a branded mail with the ticket details and a link to view it."
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className={btn("quiet", "lg")}>
              {sentTo ? "Done" : "Cancel"}
            </button>
            {!sentTo && (
              <button onClick={send} disabled={busy} className={btn("primary", "lg", "gap-2 px-5")}>
                <Mail size={15} /> {busy ? "Sending…" : "Send"}
              </button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <FormError error={error} />
          {sentTo ? (
            <p className="rounded-[10px] border border-[rgba(13,167,124,0.3)] bg-[rgba(13,167,124,0.07)] px-3 py-2.5 text-[13px] text-body">
              Sent — the ticket is on its way to <span className="font-bold">{sentTo}</span>.
            </p>
          ) : (
            <Field label="Send to">
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="customer@email.com" autoFocus />
            </Field>
          )}
        </div>
      </Modal>
    </>
  );
}
