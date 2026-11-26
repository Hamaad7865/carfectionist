const ALIGNMENT_MARKER =
  /^\[tc-alignment:v1\|(\d{4}-\d{2}-\d{2})\|(\d+)\|(\d+)]$/m;

export interface AppointmentAlignment {
  alignedOn: string | null;
  alignedAtKm: number | null;
  nextAtKm: number | null;
}

export function parseAppointmentAlignment(notes: string | null | undefined): AppointmentAlignment {
  const match = ALIGNMENT_MARKER.exec(notes ?? "");
  return {
    alignedOn: match?.[1] ?? null,
    alignedAtKm: match?.[2] ? Number(match[2]) : null,
    nextAtKm: match?.[3] ? Number(match[3]) : null,
  };
}

export function appointmentDisplayNotes(notes: string | null | undefined): string | null {
  const clean = (notes ?? "").replace(ALIGNMENT_MARKER, "").trim();
  return clean || null;
}

export function legacyAppointmentNotes(
  notes: string | null | undefined,
  alignment: AppointmentAlignment,
): string | null {
  const marker =
    alignment.alignedOn &&
    alignment.alignedAtKm != null &&
    alignment.nextAtKm != null
      ? `[tc-alignment:v1|${alignment.alignedOn}|${alignment.alignedAtKm}|${alignment.nextAtKm}]`
      : null;
  const value = [appointmentDisplayNotes(notes), marker].filter(Boolean).join("\n");
  return value || null;
}

export function missingAppointmentAlignmentColumns(error: { message?: string } | null | undefined): boolean {
  const message = error?.message ?? "";
  const missing =
    /schema cache|does not exist|could not find/i.test(message);
  return missing && /aligned_on|aligned_at_km|next_at_km/i.test(message);
}
