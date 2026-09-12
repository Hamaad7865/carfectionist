import { notFound } from "next/navigation";
import { getJob } from "@/lib/supabase/queries/jobs";
import { getDealFlow } from "@/lib/supabase/queries/flow";
import { FlowStepper } from "@/components/flow/FlowStepper";
import { JobCard } from "@/features/jobs/JobCard";
import { SupersededBillNotice } from "@/features/documents/SupersededBillNotice";
import { UndoHandoverButton } from "@/features/documents/HandOverButton";
import { formatMUR } from "@/lib/money";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, flow] = await Promise.all([getJob(id), getDealFlow({ jobId: id })]);
  if (!data) notFound();
  // A delivered job still showing a balance went out ON ACCOUNT (a paid delivery
  // leaves nothing owed) — the handover area lives inside JobCard, which only
  // renders it pre-delivery, so the undo control sits here, directly under it.
  const onAccountBills =
    data.job.status === "delivered"
      ? data.job.documents.filter((d) => d.docType === "invoice" && d.outstandingCents > 0)
      : [];
  const onAccountCents = onAccountBills.reduce((s, d) => s + d.outstandingCents, 0);
  return (
    <>
      {flow && (
        <div className="px-4 pt-4 sm:px-6 sm:pt-6">
          <FlowStepper steps={flow} />
        </div>
      )}
      {/* A bill from the quotation this job's quote replaced. It belongs to no job,
          so nothing else on this screen has ever mentioned it — while the customer
          is billed for the same work twice. */}
      {data.job.supersededBills.length > 0 && (
        <div className="px-4 sm:px-6">
          <SupersededBillNotice bills={data.job.supersededBills} />
        </div>
      )}
      <JobCard job={data.job} refData={data.ref} />
      {onAccountBills.length > 0 && (
        <div className="mx-auto max-w-3xl p-4 pt-0 sm:p-6 sm:pt-0">
          <div className="flex flex-col items-start gap-2 rounded-[15px] border border-line bg-card p-4">
            <p className="text-[12.5px] text-muted">
              Handed over on account with {formatMUR(onAccountCents)} still owed — undoing puts the car back to Ready; the balance stays on the bill.
            </p>
            {onAccountBills.map((d) => (
              <UndoHandoverButton key={d.id} invoiceId={d.id} number={d.number} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
