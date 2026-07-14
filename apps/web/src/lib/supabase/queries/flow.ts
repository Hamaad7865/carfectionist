import { createClient } from "@/lib/supabase/server";
import { muDateTime } from "@/lib/mu-date";

// ─── The car's lifecycle, as the owner describes it ──────────────────────────
// Intake → Quote → Client signs → Job → Invoice. One resolver walks the chain
// from ANY anchor (a document or a job) via the real links: documents.intake,
// jobs.source_quote_id, documents.job_id — so every page can show the same
// five steps and where this car currently stands.

export interface FlowStep {
  key: "intake" | "quote" | "sign" | "job" | "invoice" | "certificate";
  label: string;
  state: "done" | "current" | "todo" | "declined";
  at: string | null;     // MU display timestamp
  detail: string | null; // e.g. "3 marks · 2 photos", "Signed — Anesh", plate
  href: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function getDealFlow(input: { documentId?: string; jobId?: string }): Promise<FlowStep[] | null> {
  const sb = await createClient();

  const DOC_COLS = "id, doc_type, status, number, created_at, issued_at, intake, job_id, source_document_id, accepted_signature, vehicle_id, amount_paid, total_incl";
  let anchorDoc: any = null;
  let job: any = null;

  if (input.documentId) {
    const { data } = await sb.from("documents").select(DOC_COLS).eq("id", input.documentId).maybeSingle();
    anchorDoc = data;
    if (!anchorDoc) return null;
  }

  const JOB_COLS = "id, status, created_at, scheduled_at, started_at, ready_at, delivered_at, source_quote_id, damage_markers, vehicle_id";
  if (input.jobId) {
    const { data } = await sb.from("jobs").select(JOB_COLS).eq("id", input.jobId).maybeSingle();
    job = data;
    if (!job) return null;
  }

  // Resolve the JOB from a document anchor.
  if (!job && anchorDoc) {
    if (anchorDoc.job_id) {
      const { data } = await sb.from("jobs").select(JOB_COLS).eq("id", anchorDoc.job_id).maybeSingle();
      job = data;
    } else if (anchorDoc.doc_type === "quote") {
      const { data } = await sb.from("jobs").select(JOB_COLS).eq("source_quote_id", anchorDoc.id).maybeSingle();
      job = data;
    }
  }

  // Resolve the QUOTE.
  let quote: any = anchorDoc?.doc_type === "quote" ? anchorDoc : null;
  if (!quote) {
    const quoteId =
      job?.source_quote_id ??
      (anchorDoc?.doc_type === "invoice" && anchorDoc.source_document_id ? anchorDoc.source_document_id : null);
    if (quoteId) {
      const { data } = await sb.from("documents").select(DOC_COLS).eq("id", quoteId).maybeSingle();
      if (data && (data as any).doc_type === "quote") quote = data;
    }
  }

  // Resolve the INVOICE (latest live one on the job, or the converted one).
  let invoice: any = anchorDoc?.doc_type === "invoice" ? anchorDoc : null;
  if (!invoice && job) {
    const { data } = await sb
      .from("documents")
      .select(DOC_COLS)
      .eq("job_id", job.id)
      .eq("doc_type", "invoice")
      .neq("status", "void")
      .order("created_at", { ascending: false })
      .limit(1);
    invoice = (data ?? [])[0] ?? null;
  }
  if (!invoice && quote) {
    const { data } = await sb
      .from("documents")
      .select(DOC_COLS)
      .eq("source_document_id", quote.id)
      .eq("doc_type", "invoice")
      .neq("status", "void")
      .order("created_at", { ascending: false })
      .limit(1);
    invoice = (data ?? [])[0] ?? null;
  }

  // Certificate — for ceramic work the journey ends here, not at the invoice.
  // certificates.job_id → jobs is a single FK (no embed ambiguity).
  let cert: any = null;
  if (job) {
    const { data } = await sb
      .from("certificates")
      .select("id, number, applied_at, expires_at")
      .eq("job_id", job.id)
      .order("applied_at", { ascending: false })
      .limit(1);
    cert = (data ?? [])[0] ?? null;
  }

  // Plate — the car this whole flow is about.
  const vehicleId = job?.vehicle_id ?? quote?.vehicle_id ?? invoice?.vehicle_id ?? null;
  let plate: string | null = null;
  if (vehicleId) {
    const { data } = await sb.from("vehicles").select("plate").eq("id", vehicleId).maybeSingle();
    plate = (data as any)?.plate ?? null;
  }

  // ── Assemble the five steps ────────────────────────────────────────────────
  const intakeObj = quote?.intake ?? null;
  const markerCount = Array.isArray(intakeObj?.markers) ? intakeObj.markers.length : 0;
  const photoCount = Array.isArray(intakeObj?.photos) ? intakeObj.photos.length : 0;
  const jobMarkers = Array.isArray(job?.damage_markers) ? job.damage_markers.length : 0;
  const intakeDone = !!intakeObj || jobMarkers > 0;

  const sig = quote?.accepted_signature ?? null;
  const quoteAccepted = quote?.status === "accepted" || !!job; // a job implies acceptance
  // declined AND expired are equally terminal - the DB refuses to bill either.
  const quoteDeclined = quote?.status === "declined" || quote?.status === "expired";
  const deadLabel = quote?.status === "expired" ? "Expired" : "Declined";

  const invoicePaid = invoice ? Number(invoice.amount_paid) >= Number(invoice.total_incl) && Number(invoice.total_incl) > 0 : false;

  const steps: FlowStep[] = [
    {
      key: "intake",
      label: "Intake",
      state: intakeDone ? "done" : "todo",
      at: intakeDone && quote ? muDateTime(quote.created_at) : null,
      detail: intakeDone
        ? intakeObj
          ? `${markerCount} mark${markerCount === 1 ? "" : "s"} · ${photoCount} photo${photoCount === 1 ? "" : "s"}`
          : `${jobMarkers} mark${jobMarkers === 1 ? "" : "s"}`
        : "Walk-in / no intake",
      href: quote && intakeObj ? `/sales/${quote.id}` : null,
    },
    {
      key: "quote",
      label: "Quote",
      state: quote ? "done" : "todo",
      at: quote ? muDateTime(quote.issued_at ?? quote.created_at) : null,
      detail: quote ? (quote.number ?? "Draft") : null,
      href: quote ? `/sales/${quote.id}` : null,
    },
    {
      key: "sign",
      label: "Client signs",
      state: quoteDeclined ? "declined" : sig || quoteAccepted ? "done" : "todo",
      at: sig?.at ? muDateTime(sig.at) : null,
      detail: quoteDeclined
        ? deadLabel
        : sig
          ? `Signed${sig.name ? ` — ${sig.name}` : ""}`
          : quoteAccepted
            ? "Accepted (no signature)"
            : quote?.status === "issued"
              ? "Awaiting client"
              : null,
      href: quote ? `/sales/${quote.id}` : null,
    },
    {
      key: "job",
      label: "Job",
      // Only a delivered job is "done"; scheduled/in-progress/ready = work underway = "current".
      state: job ? (job.status === "delivered" ? "done" : job.status === "cancelled" ? "declined" : "current") : "todo",
      at: job ? muDateTime(job.delivered_at ?? job.ready_at ?? job.started_at ?? job.created_at) : null,
      detail: job
        ? [
            { scheduled: "Scheduled", in_progress: "In progress", ready: "Ready", delivered: "Delivered", cancelled: "Cancelled" }[job.status as string] ?? job.status,
            plate,
          ].filter(Boolean).join(" · ")
        : plate,
      href: job ? `/jobs/${job.id}` : null,
    },
    {
      key: "invoice",
      label: "Invoice",
      state: invoice ? "done" : "todo",
      at: invoice ? muDateTime(invoice.issued_at ?? invoice.created_at) : null,
      detail: invoice ? [invoice.number ?? "Draft", invoicePaid ? "Paid" : invoice.number ? "Awaiting payment" : null].filter(Boolean).join(" · ") : null,
      href: invoice ? `/sales/${invoice.id}` : null,
    },
  ];

  // A certificate extends the journey to six steps — but only when one exists
  // (most work isn't ceramic; a permanent empty sixth step would be noise).
  if (cert) {
    steps.push({
      key: "certificate",
      label: "Certificate",
      state: "done",
      at: cert.applied_at ?? null,
      detail: [cert.number, cert.expires_at ? `valid to ${cert.expires_at}` : null].filter(Boolean).join(" · "),
      href: `/certificates`,
    });
  }

  // Mark where the car stands now: an active job already carries "current"; else
  // the first todo becomes current — but NOT when the quote was declined (a dead
  // deal has no "now", the declined step is terminal).
  // ...and NOT when an invoice already exists: a finished standalone sale must
  // not render "Next step: Intake" for steps that never applied to it.
  if (!quoteDeclined && !invoice && !steps.some((s) => s.state === "current")) {
    const firstTodo = steps.find((s) => s.state === "todo");
    if (firstTodo) firstTodo.state = "current";
  }

  return steps;
}
