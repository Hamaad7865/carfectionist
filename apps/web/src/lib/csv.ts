// Tiny RFC-4180 CSV helpers — no dependency. Used for the import/export feature.

export interface CsvColumn {
  key: string;
  header: string;
}

function esc(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Neutralize spreadsheet formula injection (leading = + - @ is evaluated).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → CSV text. Leads with a BOM so Excel opens UTF-8 correctly. */
export function toCsv(rows: Record<string, unknown>[], columns: CsvColumn[]): string {
  const head = columns.map((c) => esc(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(",")).join("\r\n");
  return "﻿" + head + "\r\n" + body + "\r\n";
}

/** CSV text → array of objects keyed by the (normalized) header row. Handles a
 *  BOM, quoted fields with embedded delimiters/newlines, and auto-detects comma
 *  vs semicolon (common in French/Excel exports). Header keys are lower-cased and
 *  trimmed so "Selling Price" and "selling_price" both map predictably. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Delimiter: whichever of , or ; appears more in the first line.
  const firstLine = text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length);
  const delim = (firstLine.split(";").length > firstLine.split(",").length) ? ";" : ",";

  const records: string[][] = [];
  let row: string[] = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); records.push(row); row = []; cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else cur += ch;
    }
  }
  if (cur !== "" || row.length) { row.push(cur); records.push(row); }

  const rawHeaders = (records.shift() ?? []).map((h) => h.trim());
  const keys = rawHeaders.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const rows = records
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const o: Record<string, string> = {};
      keys.forEach((k, i) => { o[k] = (r[i] ?? "").trim(); });
      return o;
    });
  return { headers: rawHeaders, rows };
}
