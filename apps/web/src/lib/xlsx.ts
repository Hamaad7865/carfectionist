// A minimal .xlsx writer — no dependency, no Node built-ins, so it runs on
// workerd. An xlsx is a ZIP of XML parts; we store entries uncompressed (method
// 0), which Excel/Sheets/LibreOffice all accept, and write strings inline so
// there's no shared-string table to keep in sync.
//
// Deliberately small: one sheet, strings and numbers. That's all a report needs.

export type Cell = string | number | null;

const enc = new TextEncoder();

/** Excel column ref: 0→A, 25→Z, 26→AA … */
export function colRef(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; ) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A cell starting with = + - @ is executed by Excel — neutralise it (OWASP). */
function safeText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function sheetXml(rows: Cell[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          if (v === null || v === "") return "";
          const ref = `${colRef(c)}${r + 1}`;
          if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(safeText(String(v)))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const WB_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
const workbookXml = (name: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(name).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

// ── ZIP (stored, no compression) ─────────────────────────────────────────────
let CRC_TABLE: Uint32Array | null = null;
function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}
function crc32(data: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Entry { name: string; data: Uint8Array; crc: number; offset: number }

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const entries: Entry[] = [];
  let offset = 0;

  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  const push = (a: Uint8Array) => { chunks.push(a); offset += a.length; };

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    entries.push({ name: f.name, data: f.data, crc, offset });
    push(u32(0x04034b50));          // local file header
    push(u16(20)); push(u16(0)); push(u16(0)); // version, flags, method 0 (stored)
    push(u16(0)); push(u16(0));     // time, date
    push(u32(crc)); push(u32(f.data.length)); push(u32(f.data.length));
    push(u16(nameBytes.length)); push(u16(0));
    push(nameBytes);
    push(f.data);
  }

  const cdStart = offset;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    push(u32(0x02014b50));          // central directory header
    push(u16(20)); push(u16(20)); push(u16(0)); push(u16(0));
    push(u16(0)); push(u16(0));
    push(u32(e.crc)); push(u32(e.data.length)); push(u32(e.data.length));
    push(u16(nameBytes.length)); push(u16(0)); push(u16(0));
    push(u16(0)); push(u16(0)); push(u32(0));
    push(u32(e.offset));
    push(nameBytes);
  }
  const cdEnd = offset;

  push(u32(0x06054b50));            // end of central directory
  push(u16(0)); push(u16(0));
  push(u16(entries.length)); push(u16(entries.length));
  push(u32(cdEnd - cdStart)); push(u32(cdStart)); push(u16(0));

  const out = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** One sheet of rows → a real .xlsx byte stream. */
export function buildXlsx(sheetName: string, rows: Cell[][]): Uint8Array {
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml(sheetName)) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WB_RELS) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(rows)) },
  ]);
}
