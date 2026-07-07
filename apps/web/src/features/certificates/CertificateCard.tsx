"use client";

import { Check, Printer } from "lucide-react";
import type { CertificateRow } from "@/lib/supabase/queries/certificates";

const AC = "#0FBFA6";
const BLUE = "#3E8BFF";
const PURPLE = "#7C5CE8";
const AC_SOFT = "rgba(15,191,166,.14)";
const AC_LINE = "rgba(15,191,166,.45)";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;

function dstr(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ font: "700 9.5px system-ui", letterSpacing: "1.4px", color: "#8494A3", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ font: "600 15.5px system-ui", color: "#17202A" }}>{children}</div>
    </div>
  );
}

export function CertificateCard({ cert, studioName, showPrint = true }: { cert: CertificateRow; studioName: string; showPrint?: boolean }) {
  const term = cert.warrantyMonths % 12 === 0 ? `${cert.warrantyMonths / 12} year${cert.warrantyMonths === 12 ? "" : "s"}` : `${cert.warrantyMonths} months`;

  const applied = Date.parse(cert.appliedAt);
  const until = Date.parse(cert.expiresAt);
  const now = Date.now();
  const schedule: { label: string; date: string; past: boolean; isDue: boolean }[] = [];
  let t = applied + 182.5 * DAY;
  let n = 1;
  let markedDue = false;
  while (t < until && n <= 5) {
    const past = t <= now;
    const isDue = !past && !markedDue;
    if (isDue) markedDue = true;
    schedule.push({ label: `Maintenance wash ${n}`, date: dstr(new Date(t).toISOString().slice(0, 10)), past, isDue });
    t += 182.5 * DAY;
    n++;
  }

  return (
    <div style={{ background: `linear-gradient(135deg, ${AC}, ${BLUE}, ${PURPLE})`, padding: 1.5, borderRadius: 20 }}>
      <div style={{ background: "#fff", borderRadius: 18.5, padding: "22px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ display: "grid", placeItems: "center", width: 52, height: 52, borderRadius: "50%", background: `linear-gradient(135deg, ${AC}, ${BLUE})`, color: "#fff", boxShadow: `0 6px 24px ${AC_SOFT}` }}>
            <Check size={24} strokeWidth={3} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ font: "800 20px var(--font-display, system-ui)", letterSpacing: "1.6px", textTransform: "uppercase", color: "#17202A", lineHeight: 1.1 }}>
              Certificate of ceramic protection
            </div>
            <div style={{ font: "500 12px system-ui", color: "#8494A3", marginTop: 2 }}>{studioName} · Grand Baie · Mauritius</div>
          </div>
          <span style={{ font: "600 13px ui-monospace, monospace", color: "#5B6B7A" }}>{cert.number}</span>
        </div>
        <div style={{ height: 1, background: "rgba(15,26,36,.10)" }} />

        {/* fields */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "11px 20px" }}>
          <Field label="Vehicle">{cert.vehicle}</Field>
          <Field label="Registration">
            <span style={{ display: "inline-block", background: "#F0C542", color: "#151208", borderRadius: 5, padding: "1px 7px", font: "600 13px ui-monospace, monospace" }}>{cert.plate ?? "—"}</span>
          </Field>
          <Field label="Owner">{cert.customerName}</Field>
          <Field label="Colour">{cert.colour ?? "—"}</Field>
          <Field label="Product applied">{cert.productName ?? "Ceramic protection"}</Field>
          <Field label="Applied by">{[cert.appliedBy, dstr(cert.appliedAt)].filter(Boolean).join(" · ")}</Field>
        </div>

        {/* warranty box */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: AC_SOFT, border: `1px solid ${AC_LINE}`, borderRadius: 14, padding: "13px 17px" }}>
          <div>
            <div style={{ font: "700 9.5px system-ui", letterSpacing: "1.4px", color: "#8494A3", textTransform: "uppercase" }}>Warranty valid until</div>
            <div style={{ font: "800 30px var(--font-display, system-ui)", color: AC, lineHeight: 1.1 }}>{dstr(cert.expiresAt)}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ font: "700 9.5px system-ui", letterSpacing: "1.4px", color: "#8494A3", textTransform: "uppercase" }}>Term</div>
            <div style={{ font: "800 22px var(--font-display, system-ui)", color: "#17202A" }}>{term}</div>
          </div>
        </div>

        {/* maintenance schedule */}
        {schedule.length > 0 && (
          <div>
            <div style={{ font: "700 9.5px system-ui", letterSpacing: "1.4px", color: "#8494A3", textTransform: "uppercase", marginBottom: 8 }}>Maintenance schedule — every 6 months</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {schedule.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: "50%",
                      background: s.past ? "#1FA361" : s.isDue ? AC : "transparent",
                      border: `1.5px solid ${s.past ? "#1FA361" : s.isDue ? AC : "rgba(15,26,36,.18)"}`,
                      color: "#fff", font: "700 11px system-ui",
                    }}
                  >
                    {s.past ? "✓" : ""}
                  </span>
                  <span style={{ flex: 1, font: `${s.isDue ? 700 : 500} 13px system-ui`, color: s.past ? "#8494A3" : s.isDue ? "#17202A" : "#5B6B7A" }}>{s.label}</span>
                  <span style={{ font: "500 12.5px ui-monospace, monospace", color: "#5B6B7A" }}>{s.date}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 2 }}>
          <p style={{ flex: 1, font: "500 11.5px system-ui", color: "#8494A3", lineHeight: 1.5 }}>
            Warranty requires a Ceramic Maintenance Wash every 6 months at an approved studio.
            {cert.jobRef ? ` Issued against ${cert.jobRef}.` : ""}
          </p>
          {showPrint && (
            <a
              href={`/print/certificate/${cert.id}`}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 16px", borderRadius: 11, border: "1px solid rgba(15,26,36,.18)", color: "#5B6B7A", font: "700 13px system-ui", textDecoration: "none" }}
            >
              <Printer size={15} /> Print
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
