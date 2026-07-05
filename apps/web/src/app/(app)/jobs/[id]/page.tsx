import { notFound } from "next/navigation";
import { getJob } from "@/lib/supabase/queries/jobs";
import { JobCard } from "@/features/jobs/JobCard";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getJob(id);
  if (!data) notFound();
  return <JobCard job={data.job} refData={data.ref} />;
}
