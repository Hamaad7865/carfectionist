import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./appointment-settings-actions", () => ({
  saveAppointmentReminderAction: vi.fn(),
  saveWorkPlaceAction: vi.fn(),
  deleteWorkPlaceAction: vi.fn(),
}));

import { AppointmentSettingsPanel } from "./AppointmentSettingsPanel";

describe("AppointmentSettingsPanel", () => {
  it("shows tenant-owned work places and the reminder window", () => {
    const html = renderToStaticMarkup(
      <AppointmentSettingsPanel
        settings={{
          reminderDays: 5,
          workPlaces: [
            { id: "place-1", name: "Prayag Tyre Center & SpareParts" },
            { id: "place-2", name: "Tyre bay" },
          ],
        }}
        canManage
      />,
    );

    expect(html).toContain("Prayag Tyre Center &amp; SpareParts");
    expect(html).toContain("Tyre bay");
    expect(html).toContain('value="5"');
    expect(html).toContain("Add place");
    expect(html).not.toContain("Car wash");
  });
});
