import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Carfectionist",
  description: "How Carfectionist collects, uses and protects customer information.",
};

const UPDATED = "14 July 2026";

function H({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-9 mb-2.5 scroll-mt-24 font-display text-[18px] font-extrabold tracking-tight text-ink-strong">
      {children}
    </h2>
  );
}

export default function PrivacyPage() {
  return (
    <article className="flex flex-col text-[15px] leading-[1.65] text-body">
      <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-link">Legal</p>
      <h1 className="mt-1.5 font-display text-[30px] font-extrabold leading-tight tracking-tight text-ink-strong">
        Privacy Policy
      </h1>
      <p className="mt-1.5 text-[13px] text-muted">Last updated {UPDATED}</p>

      <p className="mt-6">
        This policy explains what Carfectionist does with your information when you bring a vehicle to the studio, ask us for a
        quotation, or message us. It is written to be read, not to be survived.
      </p>

      <H>Who is responsible for your information</H>
      <p>
        <strong className="font-semibold text-ink">Diamondbrite Reunion (Mauritius) Ltd</strong>, trading as{" "}
        <strong className="font-semibold text-ink">Carfectionist</strong> (BRN C22190760, VAT VAT28070619), of Helvetia, 80840 Moka,
        Mauritius, is the data controller. We are governed by the Mauritius Data Protection Act 2017.
      </p>
      <p className="mt-3">
        Contact us about anything on this page at{" "}
        <a href="mailto:carfectionist@gmail.com" className="font-semibold text-link hover:underline">carfectionist@gmail.com</a>{" "}
        or +230 5258 8854.
      </p>

      <H>What we collect</H>
      <ul className="mt-1 flex list-disc flex-col gap-2 pl-5">
        <li><strong className="font-semibold text-ink">You</strong> — your name, phone number, email address and postal address; and for company customers, the business name, BRN and VAT number.</li>
        <li><strong className="font-semibold text-ink">Your vehicle</strong> — registration plate, make, model, year, colour and chassis number.</li>
        <li><strong className="font-semibold text-ink">Photographs of your vehicle</strong>, taken when you drop it off and again when the work is finished, together with any marks of existing damage our staff record on a diagram. This is the condition record that protects both of us.</li>
        <li><strong className="font-semibold text-ink">Your signature</strong>, if you accept a quotation on the studio tablet.</li>
        <li><strong className="font-semibold text-ink">Your transactions</strong> — quotations, invoices, credit notes and payments, including the payment method and reference.</li>
        <li><strong className="font-semibold text-ink">Messages between us</strong> — WhatsApp and email conversations with the studio, including any photos or documents you send us.</li>
        <li><strong className="font-semibold text-ink">Your marketing preference</strong> — whether you have asked us to stop sending offers.</li>
      </ul>
      <p className="mt-3">
        We do not collect payment card numbers. Card payments are taken on a separate terminal; we only record that a card was used
        and the terminal&apos;s reference.
      </p>

      <H>Why we hold it, and on what basis</H>
      <ul className="mt-1 flex list-disc flex-col gap-2 pl-5">
        <li><strong className="font-semibold text-ink">To do the work you asked for</strong> — quoting, booking, detailing your vehicle, invoicing and taking payment. This is necessary to perform our contract with you.</li>
        <li><strong className="font-semibold text-ink">To meet our legal duties</strong> — invoices, credit notes and payment records are fiscal documents we are required to keep and to make available to the Mauritius Revenue Authority.</li>
        <li><strong className="font-semibold text-ink">To protect both parties</strong> — condition photographs and damage markers are kept as evidence of the state of your vehicle when it arrived and when it left. This is our legitimate interest, and yours.</li>
        <li><strong className="font-semibold text-ink">To answer you</strong> — when you message the studio, we keep the conversation so whoever is on shift can pick it up.</li>
        <li><strong className="font-semibold text-ink">To send you offers</strong> — only with your consent, which you can withdraw at any time (see below).</li>
      </ul>

      <H id="whatsapp">WhatsApp</H>
      <p>
        We use the WhatsApp Business Platform, operated by Meta, to send quotations and invoices, to answer your messages, and — if you
        have not opted out — to send occasional offers.
      </p>
      <p className="mt-3">
        When you message us on WhatsApp, or we message you, Meta processes that message in order to deliver it, under its own terms and
        privacy policy. We store the conversation in our system so that the studio has a record of what was agreed.
      </p>
      <p className="mt-3">
        <strong className="font-semibold text-ink">To stop marketing messages</strong>, reply <strong className="font-semibold text-ink">STOP</strong> to any
        message from us, or tell any member of staff. We will not send you offers again. You will still receive the quotations and
        invoices you asked for, because those are part of the work you commissioned.
      </p>

      <H>Who else sees it</H>
      <p>We do not sell your information, and we do not share it for anyone else&apos;s advertising. We use these service providers to run the studio&apos;s systems:</p>
      <ul className="mt-2.5 flex list-disc flex-col gap-2 pl-5">
        <li><strong className="font-semibold text-ink">Supabase</strong> — stores the database and the vehicle photographs.</li>
        <li><strong className="font-semibold text-ink">Cloudflare</strong> — runs the application and sends our emails.</li>
        <li><strong className="font-semibold text-ink">Meta Platforms</strong> — delivers our WhatsApp messages.</li>
      </ul>
      <p className="mt-3">
        Each of them acts on our instructions. We will also disclose information where the law requires it — for example, to the Mauritius
        Revenue Authority, or to a court.
      </p>

      <H>How long we keep it</H>
      <p>
        Invoices, credit notes and payment records are kept for as long as Mauritian tax law requires us to keep them. Quotations,
        job records, condition photographs and message history are kept while you remain a customer and for a reasonable period
        afterwards, so that we can honour warranties and answer questions about past work. When a record is no longer needed for either
        purpose, we delete it.
      </p>

      <H>Keeping it safe</H>
      <p>
        Everything travels over an encrypted connection. Photographs are held in private storage that cannot be browsed from the open
        internet. Access inside the studio is limited by role — a detailer sees the job in front of them, not the accounts. Fiscal
        documents cannot be altered once issued, and every correction is recorded as a separate, traceable entry.
      </p>

      <H id="your-rights">Your rights</H>
      <p>Under the Data Protection Act 2017 you may ask us to:</p>
      <ul className="mt-2.5 flex list-disc flex-col gap-2 pl-5">
        <li>show you the information we hold about you;</li>
        <li>correct anything that is wrong;</li>
        <li>delete information we no longer have a reason to keep;</li>
        <li>stop or limit how we use it, including stopping marketing;</li>
        <li>hand you a copy in a portable form.</li>
      </ul>
      <p className="mt-3">
        Write to <a href="mailto:carfectionist@gmail.com" className="font-semibold text-link hover:underline">carfectionist@gmail.com</a>. We will
        answer within one month. If you are not satisfied, you may complain to the{" "}
        <strong className="font-semibold text-ink">Data Protection Office of Mauritius</strong>.
      </p>

      <H id="data-deletion">Deleting your data</H>
      <div className="mt-1 rounded-[13px] border border-line bg-card p-5">
        <p className="text-[14.5px]">
          To have your information deleted, email{" "}
          <a href="mailto:carfectionist@gmail.com" className="font-semibold text-link hover:underline">carfectionist@gmail.com</a> from the
          address we hold for you, or call +230 5258 8854, with the subject{" "}
          <strong className="font-semibold text-ink">&ldquo;Delete my data&rdquo;</strong>. Tell us your name and your vehicle&apos;s registration
          number so we can find you.
        </p>
        <p className="mt-3 text-[14.5px]">
          We will delete your contact details, your vehicle records, your photographs and your message history within{" "}
          <strong className="font-semibold text-ink">30 days</strong>, and confirm when it is done.
        </p>
        <p className="mt-3 text-[13.5px] text-muted">
          One exception, and we are obliged to be straight with you about it: invoices and payment records are fiscal documents. Mauritian
          tax law requires us to retain them, so those we cannot delete on request. They are locked, used for nothing but accounting, and
          removed once the retention period expires.
        </p>
      </div>

      <H>Changes</H>
      <p>
        If we change how we use your information, we will update this page and change the date at the top. The current version is always
        the one published here.
      </p>
    </article>
  );
}
