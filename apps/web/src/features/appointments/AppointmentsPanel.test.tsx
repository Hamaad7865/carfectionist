import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppointmentsData } from "@/lib/supabase/queries/appointments";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./actions", () => ({
  createAppointmentAction: vi.fn(),
  setAppointmentStatusAction: vi.fn(),
  convertAppointmentToJobAction: vi.fn(),
}));

import { AppointmentsPanel } from "./AppointmentsPanel";

const data: AppointmentsData = {
  appointments: [],
  customers: [],
  technicians: [],
  workPlaces: [
    { id: "place-1", name: "Prayag Tyre Center & SpareParts" },
    { id: "place-2", name: "Tyre bay" },
  ],
  isTyreShop: true,
};

describe("AppointmentsPanel", () => {
  it("uses only the current tenant's managed places of work", () => {
    const html = renderToStaticMarkup(<AppointmentsPanel data={data} />);

    expect(html).toContain("Prayag Tyre Center &amp; SpareParts");
    expect(html).toContain("Tyre bay");
    expect(html).not.toContain("Detailing studio");
    expect(html).not.toContain("Car wash");
  });

  it("uses the same tyre alignment follow-up fields as the tablet", () => {
    const html = renderToStaticMarkup(<AppointmentsPanel data={data} />);

    expect(html).toContain("Alignment follow-up");
    expect(html).toContain("Aligned on");
    expect(html).toContain("Aligned at");
    expect(html).toContain("Next at");
    expect(html).toContain("Wheel alignment");
  });
});
