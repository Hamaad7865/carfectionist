import { getCloudflareContext } from "@opennextjs/cloudflare";
import { formatMUR } from "@/lib/money";

// Outbound email via the Cloudflare Email Sending BINDING (no API key; the
// wrangler.jsonc `send_email` binding + a one-time domain enable in the
// dashboard). Transactional only — receipts, not marketing.

const FROM = { email: "receipts@app-carfectionist.com", name: "Carfectionist" };
const FROM_DOCS = { email: "documents@app-carfectionist.com", name: "Carfectionist" };

export interface EmailAttachment {
  filename: string;
  content: string; // base64
  contentType: string;
}

type SendResult = { ok: true } | { ok: false; error: string };

// One binding-facing sender. The Email Sending binding takes the STRUCTURED
// object form ({to, from, subject, text, html, attachments}) — verified live:
// `raw` MIME is ignored ("text or html must have content") and importing
// cloudflare:email breaks the OpenNext deploy bundle, so neither is used here.
async function bindingSend(msg: {
  to: string;
  from: { email: string; name: string };
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}): Promise<SendResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = getCloudflareContext().env as any;
  if (!env?.EMAIL?.send) {
    return { ok: false, error: "Email sending isn't configured on this deployment yet (enable Email Sending for app-carfectionist.com in the Cloudflare dashboard)." };
  }
  // The binding takes the structured form ({to, from, subject, text, html,
  // attachments}) — `raw` is ignored ("text or html must have content") and the
  // attachment type field is named `mimeType` (its validation error literally
  // says "Invalid `mimeType` given" when absent). Field names aren't formally
  // documented, so on an attachment-shape rejection we retry with `type`, and
  // finally send WITHOUT the attachment — the body always carries the tokenized
  // download button, so the customer still gets the document.
  const base = {
    to: msg.to,
    from: { email: msg.from.email, name: msg.from.name },
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  };
  const shapes: Record<string, unknown>[] = msg.attachments?.length
    ? [
        { ...base, attachments: msg.attachments.map((a) => ({ filename: a.filename, mimeType: a.contentType, content: a.content })) },
        { ...base, attachments: msg.attachments.map((a) => ({ filename: a.filename, type: a.contentType, content: a.content })) },
        base,
      ]
    : [base];
  let lastErr = "send failed";
  for (const shape of shapes) {
    try {
      await env.EMAIL.send(shape);
      return { ok: true };
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return { ok: false, error: lastErr };
}

export interface ReceiptEmailInput {
  to: string;
  number: string;
  dateLabel: string;
  totalCents: number;
  link: string; // public /t/[token] URL
  studioName: string;
}

/** Branded "your sale ticket" email (the owner's Cashmag reference: thank-you,
 *  reference/date/total, one button to the hosted ticket). */
export async function sendReceiptEmail(i: ReceiptEmailInput): Promise<SendResult> {
  const total = formatMUR(i.totalCents);
  const subject = `Your ticket at ${i.studioName} — ${i.number}`;
  const text =
    `Thank you for your purchase at ${i.studioName}.\n\n` +
    `Reference: ${i.number}\nDate: ${i.dateLabel}\nTotal: ${total}\n\n` +
    `View your ticket: ${i.link}\n`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:28px 16px">
    <div style="background:#ffffff;border-radius:14px;padding:32px 28px;border:1px solid #e4e8ee">
      <div style="text-align:center;font-size:20px;font-weight:800;letter-spacing:0.04em;color:#141b22">${i.studioName.toUpperCase()}</div>
      <div style="text-align:center;font-size:16px;font-weight:700;color:#2b6cb0;margin-top:10px">Your sale ticket</div>
      <p style="text-align:center;font-size:13px;color:#5b6572;line-height:1.6;margin:14px 0 22px">
        Thank you for your purchase. Your transaction details are below.
      </p>
      <table style="width:100%;font-size:13.5px;color:#1c2733;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#5b6572">Reference</td><td style="padding:6px 0;text-align:right;font-weight:700">${i.number}</td></tr>
        <tr><td style="padding:6px 0;color:#5b6572">Date</td><td style="padding:6px 0;text-align:right">${i.dateLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#5b6572">Total</td><td style="padding:6px 0;text-align:right;font-weight:800;color:#0d8a5f">${total}</td></tr>
      </table>
      <div style="text-align:center;margin-top:26px">
        <a href="${i.link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:10px">
          View my ticket
        </a>
      </div>
    </div>
    <p style="text-align:center;font-size:11px;color:#98a2b0;margin-top:14px">
      Sent by ${i.studioName} · Mauritius. This is a transactional receipt for your purchase.
    </p>
  </div>
</body></html>`;

  return bindingSend({ to: i.to, from: FROM, subject, html, text });
}

export interface DocumentEmailInput {
  to: string;
  docKind: string; // "quotation" | "invoice" | "credit note"
  number: string;
  customerName: string;
  totalCents: number;
  accepted: boolean; // signed on the tablet → say so in the mail
  pdfBase64: string;
  downloadLink: string; // public tokenized PDF URL (backup to the attachment)
  studioName: string;
}

/** Branded "here is your quotation/invoice" email with the PDF attached. */
export async function sendDocumentEmail(i: DocumentEmailInput): Promise<SendResult> {
  const total = formatMUR(i.totalCents);
  const kindCap = i.docKind.charAt(0).toUpperCase() + i.docKind.slice(1);
  const subject = `${kindCap} ${i.number} from ${i.studioName}`;
  const acceptedLine = i.accepted ? `This ${i.docKind} was accepted and signed in the studio.` : "";
  const text =
    `Dear ${i.customerName},\n\n` +
    `Please find attached your ${i.docKind} ${i.number} from ${i.studioName}. Total: ${total}.\n` +
    (acceptedLine ? `${acceptedLine}\n` : "") +
    `\nIf the attachment doesn't open, you can also download it here: ${i.downloadLink}\n\n` +
    `Thank you,\n${i.studioName}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:28px 16px">
    <div style="background:#ffffff;border-radius:14px;padding:32px 28px;border:1px solid #e4e8ee">
      <div style="text-align:center;font-size:20px;font-weight:800;letter-spacing:0.04em;color:#141b22">${i.studioName.toUpperCase()}</div>
      <div style="text-align:center;font-size:16px;font-weight:700;color:#2b6cb0;margin-top:10px">Your ${i.docKind}</div>
      <p style="text-align:center;font-size:13px;color:#5b6572;line-height:1.6;margin:14px 0 22px">
        Dear ${i.customerName}, your ${i.docKind} is attached to this email.${acceptedLine ? `<br/>${acceptedLine}` : ""}
      </p>
      <table style="width:100%;font-size:13.5px;color:#1c2733;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#5b6572">Reference</td><td style="padding:6px 0;text-align:right;font-weight:700">${i.number}</td></tr>
        <tr><td style="padding:6px 0;color:#5b6572">Total</td><td style="padding:6px 0;text-align:right;font-weight:800;color:#0d8a5f">${total}</td></tr>
      </table>
      <div style="text-align:center;margin-top:26px">
        <a href="${i.downloadLink}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:10px">
          Download ${i.docKind}
        </a>
      </div>
    </div>
    <p style="text-align:center;font-size:11px;color:#98a2b0;margin-top:14px">
      Sent by ${i.studioName} · Mauritius.
    </p>
  </div>
</body></html>`;

  return bindingSend({
    to: i.to,
    from: FROM_DOCS,
    subject,
    html,
    text,
    attachments: [{ filename: `${i.number}.pdf`, content: i.pdfBase64, contentType: "application/pdf" }],
  });
}
