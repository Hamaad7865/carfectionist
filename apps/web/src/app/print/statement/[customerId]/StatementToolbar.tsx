"use client";

// A "View" surface, not a "Print" one — so, unlike the document print page, it
// does NOT auto-open the print dialog. The owner reads the statement instantly,
// then prints or saves a PDF only if they want to. Hidden from the printout.
export function StatementToolbar() {
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
