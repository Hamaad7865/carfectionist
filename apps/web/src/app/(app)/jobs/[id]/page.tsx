import { notFound } from "next/navigation";
import { getJob } from "@/lib/supabase/queries/jobs";
import { getDealFlow } from "@/lib/supabase/queries/flow";
import { FlowStepper } from "@/components/flow/FlowStepper";
import { JobCard } from "@/features/jobs/JobCard";

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
      <JobCard job={data.job} refData={data.ref} />
    </>
  );
}
