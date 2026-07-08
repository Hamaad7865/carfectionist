"use client";

/** View-first receipt toolbar: opening the page shows the receipt (so it can be
 *  checked on screen); Print opens the browser dialog to send it to the thermal
 *  POS printer. Hidden from the printout via the page's @media print rules. */
export function ReceiptToolbar() {
  return (
    <div
      className="print-toolbar"
      style={{ position: "sticky", top: 0, zIndex: 10, display: "flex", gap: 8, justifyContent: "center", padding: "10px 0 16px" }}
    >
      <button
        onClick={() => window.print()}
        style={{ height: 38, padding: "0 18px", borderRadius: 10, border: "none", background: "#0f1316", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
      >
        Print receipt
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
