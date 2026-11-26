import { describe, expect, it } from "vitest";
import {
  appointmentDisplayNotes,
  legacyAppointmentNotes,
  missingAppointmentAlignmentColumns,
  parseAppointmentAlignment,
} from "./alignment";

describe("appointment alignment compatibility", () => {
  it("round-trips Android marker values without exposing the marker as a note", () => {
    const notes = legacyAppointmentNotes("Pulls left", {
      alignedOn: "2026-06-24",
      alignedAtKm: 84_500,
      nextAtKm: 89_500,
    });

    expect(parseAppointmentAlignment(notes)).toEqual({
      alignedOn: "2026-06-24",
      alignedAtKm: 84_500,
      nextAtKm: 89_500,
    });
    expect(appointmentDisplayNotes(notes)).toBe("Pulls left");
  });

  it("only falls back for a missing alignment column", () => {
    expect(
      missingAppointmentAlignmentColumns({
        message: "column appointments.aligned_on does not exist",
      }),
    ).toBe(true);
    expect(
      missingAppointmentAlignmentColumns({
        message: "next_at_km must be greater than aligned_at_km",
      }),
    ).toBe(false);
  });
});
