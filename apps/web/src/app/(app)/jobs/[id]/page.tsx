import { notFound } from "next/navigation";
import { getJob } from "@/lib/supabase/queries/jobs";
import { getDealFlow } from "@/lib/supabase/queries/flow";
import { FlowStepper } from "@/components/flow/FlowStepper";
import { JobCard } from "@/features/jobs/JobCard";
import { SupersededBillNotice } from "@/features/documents/SupersededBillNotice";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, flow] = await Promise.all([getJob(id), getDealFlow({ jobId: id })]);
  if (!data) notFound();
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
    </>
  );
}
