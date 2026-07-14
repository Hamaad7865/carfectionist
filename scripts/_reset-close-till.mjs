// One-off: closes the real open till before the full data reset, so today's real
// trading gets a proper Z-report on the books first. Counted = the system's own
// expected figure (nobody can walk to the physical drawer from here) — flagged
// explicitly in the note, never mistaken for a verified cash count.
//   node scripts/_reset-close-till.mjs
import pg from "pg";
import fs from "node:fs";
import { DB_URL, requireEnv } from "./_env.mjs";

const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh
requireEnv("SUPABASE_DB_URL", DB_URL);

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
await c.query("select set_config('request.jwt.claims', $1, false)", [
  JSON.stringify({ sub: OWNER, role: "authenticated" }),
]);

// Dump the already-closed Z (this script's first run closed it; a composite-type
// parsing bug meant we never printed it — this just re-reads it, nothing re-runs).
const { rows } = await c.query(
  "select number, scope, totals from z_reports order by closed_at desc limit 1",
);
const z = rows[0];
const outPath = `C:/Users/sheik/AppData/Local/Temp/claude/C--Projects-Carfection/d96d55a3-5671-45f1-8640-34dc81910f59/scratchpad/${z.number}.json`;
fs.writeFileSync(outPath, JSON.stringify(z.totals, null, 2));
console.log(z.number, "->", outPath);
console.log(JSON.stringify(z.totals, null, 2));

await c.end();
