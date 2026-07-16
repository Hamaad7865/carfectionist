"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, X, Copy, Send, RefreshCw, MessageCircle, ExternalLink } from "lucide-react";
import type { WaSecretState, WaProbe } from "@/lib/whatsapp";
import type { WaTemplateRow } from "@/lib/supabase/queries/marketing";
import { sendTestMessageAction } from "./wa-actions";
import { btnBase } from "@/components/ui/button";

// A self-testing connection page: rather than trust that a value is present, it
// asks Meta who we are. Green here means the credentials genuinely work.

function Row({ ok, label, detail }: { ok: boolean; label: string; detail?: string | null }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-line-2 py-2.5 last:border-0">
      <span className={`mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full ${ok ? "bg-mint" : "bg-[rgba(214,59,80,0.12)]"}`}>
        {ok ? <Check size={12} strokeWidth={3.4} className="text-white" /> : <X size={11} strokeWidth={3.4} className="text-rose" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-semibold ${ok ? "text-ink" : "text-body"}`}>{label}</div>
        {detail && <div className={`mt-0.5 break-words text-[11.5px] ${ok ? "text-muted" : "text-rose"}`}>{detail}</div>}
      </div>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-faint">{label}</span>
      <div className="flex gap-2">
        <code className="num min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[9px] border border-line-2 bg-sub px-3 py-2 text-[12.5px] text-ink">{value}</code>
        <button
          onClick={async () => {
            try { await navigator.clipboard.writeText(value); } catch { /* clipboard blocked */ }
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
          className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-[9px] border border-line-2 bg-card px-3 text-[12px] font-bold text-body hover:border-brand"
        >
          {done ? <Check size={13} className="text-mint" /> : <Copy size={13} />} {done ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function WhatsAppPanel({
  secrets,
  probe,
  templates,
  webhookUrl,
  verifyToken,
}: {
  secrets: WaSecretState;
  probe: WaProbe | null;
  templates: WaTemplateRow[];
  webhookUrl: string;
  verifyToken: string | null;
}) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const live = !!probe?.phone.ok && !!probe?.waba.ok;
  const missing: string[] = [];
  if (!secrets.token) missing.push("WHATSAPP_TOKEN");
  if (!secrets.phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (!secrets.wabaId) missing.push("WHATSAPP_WABA_ID");
  if (!secrets.appSecret) missing.push("WHATSAPP_APP_SECRET");

  async function test() {
    setBusy(true);
    setResult(null);
    const r = await sendTestMessageAction(to);
    setBusy(false);
    setResult(r.ok ? { ok: true, msg: "Sent — check that phone. If it arrived, sending works end to end." } : { ok: false, msg: r.error });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* verdict */}
      <div className={`rounded-[15px] border p-5 ${live ? "border-[rgba(13,167,124,0.3)] bg-[rgba(13,167,124,0.05)]" : "border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.06)]"}`}>
        <div className="flex items-center gap-2.5">
          <span className={`grid size-9 place-items-center rounded-[10px] ${live ? "bg-mint text-white" : "bg-[rgba(245,166,35,0.18)] text-amber-ink"}`}>
            <MessageCircle size={18} />
          </span>
          <div>
            <div className={`font-display text-[16px] font-extrabold ${live ? "text-mint" : "text-amber-ink"}`}>
              {live ? "WhatsApp is connected" : "WhatsApp isn't connected yet"}
            </div>
            <div className="text-[12.5px] text-muted">
              {live
                ? `Sending as ${probe?.phone.name || "Carfectionist"} · ${probe?.phone.number ?? ""}`
                : missing.length > 0
                  ? `Missing in Cloudflare: ${missing.join(", ")}`
                  : "Credentials are set but Meta rejected them — see below."}
            </div>
          </div>
        </div>
      </div>

      {/* what Meta says about us */}
      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Live check against Meta</span>
          {live && probe?.phone.quality && (
            <span className="rounded-full bg-[rgba(13,167,124,0.12)] px-2 py-0.5 text-[10.5px] font-bold uppercase text-mint">
              Quality: {probe.phone.quality}
            </span>
          )}
        </div>
        <p className="mb-2 text-[12px] text-muted">Not just &ldquo;is a value present&rdquo; — this asks Meta whether the credentials actually work.</p>
        <Row ok={secrets.token} label="Access token" detail={secrets.token ? "Set" : "Not set — value 4 from the setup guide"} />
        <Row
          ok={!!probe?.phone.ok}
          label="Phone number"
          detail={probe?.phone.ok ? `${probe.phone.number} — ${probe.phone.name}` : probe?.phone.error ?? "Not checked"}
        />
        <Row
          ok={!!probe?.waba.ok}
          label="WhatsApp Business account"
          detail={probe?.waba.ok ? probe.waba.name : probe?.waba.error ?? "Not checked"}
        />
        <Row
          ok={secrets.appSecret}
          label="App secret — required to RECEIVE messages"
          detail={secrets.appSecret ? "Set — incoming replies are accepted" : "Not set: Meta's incoming messages are rejected and the inbox stays empty"}
        />
        <Row ok={secrets.verifyToken} label="Webhook verify token" detail={secrets.verifyToken ? "Set" : "Not set"} />
      </div>

      {/* webhook — the values to paste into Meta */}
      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Webhook — paste these into Meta</div>
        <p className="mb-3 text-[12px] text-muted">
          Developers portal → your app → <span className="font-semibold text-body">WhatsApp → Configuration → Webhook → Edit</span>. Then subscribe to the{" "}
          <span className="num font-bold text-body">messages</span> field — that single tick is what delivers customer replies to your inbox.
        </p>
        <div className="flex flex-col gap-3">
          <CopyField label="Callback URL" value={webhookUrl} />
          {verifyToken ? (
            <CopyField label="Verify token" value={verifyToken} />
          ) : (
            <p className="rounded-[9px] bg-[rgba(214,59,80,0.08)] px-3 py-2 text-[12.5px] text-rose">
              No verify token set on the server — the webhook cannot be verified until WHATSAPP_WEBHOOK_VERIFY_TOKEN exists.
            </p>
          )}
        </div>
      </div>

      {/* test send */}
      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Send a test message</div>
        <p className="mb-3 text-[12px] text-muted">
          Fires Meta&apos;s standard <span className="num font-semibold text-body">hello_world</span> template. If it arrives, the whole sending chain works — token,
          number, permissions and billing. On the free test number, the recipient must be allow-listed in Meta first.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="+230 5XXX XXXX"
            inputMode="tel"
            className="h-10 min-w-[200px] flex-1 rounded-[11px] border border-line-2 bg-sub px-3 text-[13px] text-ink outline-none focus:border-brand"
          />
          <button
            onClick={test}
            disabled={busy || !to.trim() || !live}
            title={!live ? "Connect WhatsApp first" : undefined}
            className={btnBase("lg", "gap-2 bg-[#25D366] font-bold text-[#06231A]")}
          >
            {busy ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />} {busy ? "Sending…" : "Send test"}
          </button>
        </div>
        {result && (
          <p className={`mt-3 rounded-[9px] px-3 py-2 text-[12.5px] ${result.ok ? "bg-[rgba(13,167,124,0.1)] font-semibold text-mint" : "bg-[rgba(214,59,80,0.08)] text-rose"}`}>
            {result.msg}
          </p>
        )}
      </div>

      {/* templates */}
      <div className="rounded-[15px] border border-line bg-card p-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Message templates</span>
          <Link href="/marketing?tab=templates" className="inline-flex items-center gap-1 text-[12px] font-bold text-link hover:underline">
            Manage <ExternalLink size={12} />
          </Link>
        </div>
        {templates.length === 0 ? (
          <p className="text-[12.5px] text-muted">
            None yet. The <span className="num font-semibold text-body">document_delivery</span> template creates itself the first time you WhatsApp a quote — expect
            &ldquo;submitted for approval&rdquo; on that first send; that&apos;s normal, not an error.
          </p>
        ) : (
          <div className="flex flex-col">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 border-b border-line-2 py-2 last:border-0">
                <span className="num truncate text-[12.5px] font-semibold text-ink">{t.name}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase ${
                    t.status === "approved" ? "bg-[rgba(13,167,124,0.12)] text-mint"
                    : t.status === "rejected" ? "bg-[rgba(214,59,80,0.1)] text-rose"
                    : "bg-[rgba(245,166,35,0.14)] text-amber-ink"
                  }`}
                >
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* where the secrets go */}
      <div className="rounded-[15px] border border-dashed border-line-2 p-5">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Where the four values go</div>
        <p className="text-[12.5px] text-muted">
          Cloudflare dashboard → <span className="font-semibold text-body">Compute → Workers → carfectionist → Settings → Variables and Secrets</span> → Add, type{" "}
          <span className="font-semibold text-body">Secret</span>. Names must match exactly (case-sensitive). They take effect on save — no redeploy needed. Reload this
          page and every line above should turn green.
        </p>
        <div className="mt-3 grid gap-1.5 text-[12px]">
          {[
            ["WHATSAPP_TOKEN", "Permanent System User token (never expires)"],
            ["WHATSAPP_PHONE_NUMBER_ID", "The long ID under the number, not the number"],
            ["WHATSAPP_WABA_ID", "WhatsApp Business Account ID"],
            ["WHATSAPP_APP_SECRET", "App → Settings → Basic — needed to receive"],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-wrap items-baseline gap-2">
              <code className="num rounded bg-sub px-1.5 py-0.5 font-bold text-ink">{k}</code>
              <span className="text-muted">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
