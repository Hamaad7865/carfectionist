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
    // Amend mode only for quotes: revise reopens them in place (same row, same
    // number). Issued invoices stay read-only — the fiscal lock never moved.
    amending: draft.docType === "quote" && draft.status !== "draft",
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

  return (
    <div>
      {/* In-place revise (20260910000110/130): an issued/accepted quote edits here on
          its own row and number — no fork. Saving keeps the signature, booking and
          number: the same agreement with updated figures (the edit is audited). */}
      {draft.status !== "draft" && draft.number && (
        <p className="mx-auto max-w-5xl px-4 pt-4 text-[12.5px] text-muted sm:px-6">
          Revising {draft.docType === "quote" ? "quotation" : "document"} {draft.number} — same quote, same number, same signature. Saving keeps everything it had.
        </p>
      )}
      <DocumentBuilder key={id} ctx={ctx} initial={initial} />
    </div>
  );
}
