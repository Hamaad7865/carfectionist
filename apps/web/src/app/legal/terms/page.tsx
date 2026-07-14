import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Carfectionist",
  description: "The terms on which Carfectionist provides detailing services and messages customers.",
};

const UPDATED = "14 July 2026";

function H({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-9 mb-2.5 font-display text-[18px] font-extrabold tracking-tight text-ink-strong">{children}</h2>
  );
}

export default function TermsPage() {
  return (
    <article className="flex flex-col text-[15px] leading-[1.65] text-body">
      <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-link">Legal</p>
      <h1 className="mt-1.5 font-display text-[30px] font-extrabold leading-tight tracking-tight text-ink-strong">
        Terms of Service
      </h1>
      <p className="mt-1.5 text-[13px] text-muted">Last updated {UPDATED}</p>

      <p className="mt-6">
        These terms apply when you have work done at Carfectionist, operated by Diamondbrite Reunion (Mauritius) Ltd (BRN C22190760) of
        Helvetia, 80840 Moka, Mauritius.
      </p>

      <H>Quotations</H>
      <p>
        A quotation is valid for the period stated on it. It is an offer, not a booking — the work is agreed once you accept the
        quotation, in the studio or by signing it on our tablet. Prices are in Mauritian rupees and include VAT at the prevailing rate
        unless the quotation says otherwise.
      </p>

      <H>Your vehicle</H>
      <p>
        We photograph your vehicle when it arrives and record any existing damage, and we photograph it again when the work is complete.
        Those photographs are the agreed record of its condition. Please raise anything you disagree with before you leave the vehicle
        with us.
      </p>
      <p className="mt-3">
        Please remove valuables and personal belongings. We cannot accept responsibility for items left in a vehicle.
      </p>

      <H>Payment</H>
      <p>
        Invoices are due on the terms shown on the invoice. We accept cash, card, Juice and bank transfer. An invoice, once issued, is a
        fiscal document: it cannot be altered. If something is wrong, we correct it by issuing a credit note, so that the record stays
        honest and traceable.
      </p>

      <H>Messages we send you</H>
      <p>
        We use WhatsApp and email to send you quotations, invoices and updates about your vehicle. These are part of the service you have
        asked for.
      </p>
      <p className="mt-3">
        We may also send you occasional offers. You can stop these at any time by replying{" "}
        <strong className="font-semibold text-ink">STOP</strong> to any message, or by telling any member of staff — see our{" "}
        <a href="/legal/privacy" className="font-semibold text-link hover:underline">Privacy Policy</a>. Stopping offers does not stop the
        quotations and invoices for work you have commissioned.
      </p>

      <H>Warranties</H>
      <p>
        Protective treatments carry the warranty period stated on the certificate we issue for that treatment, and are subject to the
        maintenance schedule set out on it. Failing to follow that schedule may end the warranty.
      </p>

      <H>Liability</H>
      <p>
        We carry out our work with reasonable skill and care. Nothing in these terms limits any liability that cannot lawfully be limited.
        Beyond that, our liability for any single job is limited to the amount you paid for it.
      </p>

      <H>Governing law</H>
      <p>These terms are governed by the laws of Mauritius, and the courts of Mauritius have jurisdiction.</p>

      <H>Contact</H>
      <p>
        <a href="mailto:carfectionist@gmail.com" className="font-semibold text-link hover:underline">carfectionist@gmail.com</a> · +230 5258 8854
      </p>
    </article>
  );
}
