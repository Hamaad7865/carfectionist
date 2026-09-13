import { notFound } from "next/navigation";
import { getBuilderContext, getDraft } from "@/lib/supabase/queries/builder";
import { DocumentBuilder } from "@/features/documents/builder/DocumentBuilder";
import { newKey, type BuilderCar, type BuilderState } from "@/features/documents/builder/state";

export default async function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ctx, draft] = await Promise.all([getBuilderContext(), getDraft(id)]);
  if (!draft) notFound();

  // The cars this draft covers, in the order their charges appear — so a tablet
  // multi-car quotation reopened here keeps its sections.
  const seen: string[] = [];
  for (const l of draft.lines) {
    if (l.vehicleId && !seen.includes(l.vehicleId)) seen.push(l.vehicleId);
  }
  const cars: BuilderCar[] = seen.map((vid) => {
    const v = ctx.vehicles.find((x) => x.id === vid);
    return v
      ? { id: vid, plate: v.plate, label: [v.make, v.model].filter(Boolean).join(" ") || "Vehicle" }
      : { id: vid, plate: "", label: "Vehicle" };
  });

  const initial: BuilderState = {
    docId: draft.docId,
    docType: draft.docType,
    status: draft.status,
    number: draft.number,
    issueDate: draft.issueDate,
    customerId: draft.customerId,
    revision: draft.revision,
    lines: draft.lines.map((l) => ({ key: newKey(), ...l })),
    cars,
    activeCarId: cars[0]?.id ?? null,
    docDiscountKind: draft.docDiscountKind,
    docDiscountValue: draft.docDiscountValue,
    docDiscountReason: draft.docDiscountReason,
    sectionConfig: draft.sectionConfig,
    customFields: draft.customFields,
    comment: draft.comment,
    dirty: false,
    save: "idle",
    saveError: null,
  };

  return <DocumentBuilder key={id} ctx={ctx} initial={initial} />;
}
