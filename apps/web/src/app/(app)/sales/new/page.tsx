import { getBuilderContext } from "@/lib/supabase/queries/builder";
import { DocumentBuilder } from "@/features/documents/builder/DocumentBuilder";
import type { BuilderState } from "@/features/documents/builder/state";

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const ctx = await getBuilderContext();
  const docType = type === "invoice" ? "invoice" : "quote";

  const initial: BuilderState = {
    docId: null,
    docType,
    status: "draft",
    number: null,
    customerId: null,
    revision: 0,
    lines: [],
    sectionConfig: ctx.templateConfig,
    dirty: false,
    save: "idle",
    saveError: null,
  };

  return <DocumentBuilder ctx={ctx} initial={initial} />;
}
