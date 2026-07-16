// Export every catalogue item that has no usable price, as a spreadsheet the
// owner can fill in and send back.
//
//   node scripts/export-unpriced.mjs
//
// Includes stock counts on purpose: "34 units in the warehouse" tells the owner
// which of these actually matter, and "0 everywhere" tells him what to ignore.
// Zero-priced items would ring up FREE at the till, so this is the list that
// decides whether the catalogue is safe to sell from.
//
// Writes a real .xlsx with no dependency (a zip of XML — same approach as the
// app's lib/xlsx.ts, which is proven against a third-party reader).
import pg from "pg";
import fs from "node:fs";
import { DB_URL } from "./_env.mjs";

const OUT = "C:\\Users\\sheik\\Downloads\\carfectionist-items-to-price.xlsx";
const enc = new TextEncoder();

/* ── minimal xlsx writer ─────────────────────────────────────────────────── */
const colRef = (i) => { let s = ""; for (let n = i + 1; n > 0; ) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safe = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s); // formula injection

function sheetXml(rows) {
  const body = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      if (v === null || v === undefined || v === "") return "";
      const ref = `${colRef(c)}${r + 1}`;
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(safe(String(v)))}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="52"/><col min="2" max="2" width="10"/><col min="3" max="3" width="24"/><col min="4" max="5" width="11"/><col min="6" max="6" width="14"/><col min="7" max="7" width="18"/></cols><sheetData>${body}</sheetData></worksheet>`;
}
let TBL = null;
const crc32 = (d) => { if (!TBL) { TBL = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TBL[i] = c >>> 0; } } let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = TBL[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const chunks = []; const entries = []; let off = 0;
  const u16 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255]);
  const u32 = (n) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  const push = (a) => { chunks.push(a); off += a.length; };
  for (const f of files) {
    const nb = enc.encode(f.name), crc = crc32(f.data);
    entries.push({ ...f, crc, off, nb });
    push(u32(0x04034b50)); push(u16(20)); push(u16(0)); push(u16(0)); push(u16(0)); push(u16(0));
    push(u32(crc)); push(u32(f.data.length)); push(u32(f.data.length)); push(u16(nb.length)); push(u16(0));
    push(nb); push(f.data);
  }
  const cd = off;
  for (const e of entries) {
    push(u32(0x02014b50)); push(u16(20)); push(u16(20)); push(u16(0)); push(u16(0)); push(u16(0)); push(u16(0));
    push(u32(e.crc)); push(u32(e.data.length)); push(u32(e.data.length));
    push(u16(e.nb.length)); push(u16(0)); push(u16(0)); push(u16(0)); push(u16(0)); push(u32(0)); push(u32(e.off)); push(e.nb);
  }
  const cdEnd = off;
  push(u32(0x06054b50)); push(u16(0)); push(u16(0)); push(u16(entries.length)); push(u16(entries.length));
  push(u32(cdEnd - cd)); push(u32(cd)); push(u16(0));
  const out = new Uint8Array(off); let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
const buildXlsx = (name, rows) => zip([
  { name: "[Content_Types].xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`) },
  { name: "_rels/.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
  { name: "xl/workbook.xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(name).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
  { name: "xl/_rels/workbook.xml.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
  { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(rows)) },
]);

/* ── the data ────────────────────────────────────────────────────────────── */
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
const { rows } = await c.query(`
  select p.name, p.kind::text, coalesce(p.category,'—') category, p.selling_price::numeric price,
         coalesce(sum(s.qty_on_hand) filter (where l.name='Shop'), 0)::numeric shop,
         coalesce(sum(s.qty_on_hand) filter (where l.name='Warehouse'), 0)::numeric warehouse
  from products p
  left join stock_on_hand s on s.product_id = p.id
  left join stock_locations l on l.id = s.location_id
  where p.is_active and (p.selling_price = 0 or p.selling_price >= 999999)
  group by p.id, p.name, p.kind, p.category, p.selling_price
  order by (coalesce(sum(s.qty_on_hand),0)) desc, p.kind, p.name`);
await c.end();

const sheet = [
  ["Carfectionist — items that need a price", null, null, null, null, null, null],
  ["These cannot be sold correctly until priced: a 0 rings up FREE at the till, and 999,999 is a placeholder.", null, null, null, null, null, null],
  ["Fill in the PRICE column (VAT-inclusive, as you quote it) and send this file back.", null, null, null, null, null, null],
  [],
  ["Item", "Type", "Category", "In shop", "In warehouse", "Current price", "PRICE (fill in)"],
  ...rows.map((r) => [
    r.name,
    r.kind === "service" ? "Service" : "Product",
    r.category,
    Number(r.shop),
    Number(r.warehouse),
    Number(r.price) >= 999999 ? "999,999 (placeholder)" : "none",
    null, // ← the owner fills this
  ]),
];

fs.writeFileSync(OUT, buildXlsx("Items to price", sheet));
const withStock = rows.filter((r) => Number(r.shop) + Number(r.warehouse) > 0).length;
console.log(`${rows.length} items need a price (${rows.filter((r) => r.kind === "service").length} services, ${rows.filter((r) => r.kind === "product").length} products)`);
console.log(`${withStock} of them are actually in stock — those matter most`);
console.log("→", OUT);
