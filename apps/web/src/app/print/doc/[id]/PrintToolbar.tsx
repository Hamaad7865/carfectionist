"use client";

import { useEffect } from "react";

/** Opens the browser's native print dialog (Windows print / Save as PDF) once
 *  the banner images + fonts are ready, with a visible fallback button. Hidden
 *  from the printout itself via the page's @media print rules. */
export function PrintToolbar() {
  useEffect(() => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      try {
        window.print();
      } catch {
        /* ignore */
      }
    };
    const imgs = Array.from(document.images);
    const waits: Promise<unknown>[] = imgs
      .filter((img) => !img.complete)
      .map(
        (img) =>
          new Promise((res) => {
            img.addEventListener("load", res, { once: true });
            img.addEventListener("error", res, { once: true });
          }),
      );
    if (document.fonts?.ready) waits.push(document.fonts.ready);
    Promise.all(waits).then(() => setTimeout(go, 150));
    const fallback = setTimeout(go, 2500); // print even if an asset stalls
    return () => clearTimeout(fallback);
  }, []);

  return (
    <div
      className="print-toolbar"
      style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", gap: 8, justifyContent: "center", padding: "10px 0 16px" }}
    >
      <button
        onClick={() => window.print()}
        style={{ height: 38, padding: "0 18px", borderRadius: 10, border: "none", background: "#0f1316", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
      >
        Print / Save as PDF
      </button>
      <button
        onClick={() => window.close()}
        style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "1px solid #cfd7de", background: "#fff", color: "#3d4a59", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
      >
        Close
      </button>
    </div>
  );
}
