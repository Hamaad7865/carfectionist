import { notFound } from "next/navigation";
import { getDocumentProps } from "@/lib/supabase/queries/render";
import { DocumentA4 } from "@/components/pdf/DocumentA4";

// Standalone print view (outside the app shell) — the exact markup the PDF
// renders. Session-authed via the proxy; RLS scopes the query to the tenant.
export default async function PrintDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const props = await getDocumentProps(id);
  if (!props) notFound();

  return (
    <div style={{ background: "#e9edf0", minHeight: "100vh", padding: "16px" }}>
      <DocumentA4 {...props} />
    </div>
  );
}
