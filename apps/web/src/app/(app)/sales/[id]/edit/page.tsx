import { notFound } from "next/navigation";
import { getBuilderContext, getDraft } from "@/lib/supabase/queries/builder";
import { DocumentBuilder } from "@/features/documents/builder/DocumentBuilder";
import { newKey, type BuilderState } from "@/features/documents/builder/state";

export default async function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ctx, draft] = await Promise.all([getBuilderContext(), getDraft(id)]);
  if (!draft) notFound();

  const initial: BuilderState = {
    docId: draft.docId,
    docType: draft.docType,
    status: draft.status,
    number: draft.number,
    customerId: draft.customerId,
    revision: draft.revision,
    lines: draft.lines.map((l) => ({ key: newKey(), ...l })),
    sectionConfig: draft.sectionConfig,
    customFields: draft.customFields,
    dirty: false,
    save: "idle",
    saveError: null,
  };

  return <DocumentBuilder ctx={ctx} initial={initial} />;
}
