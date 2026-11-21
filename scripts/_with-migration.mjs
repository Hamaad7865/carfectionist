// Preload for regression runs: `node --import ./scripts/_with-migration.mjs scripts/<verify>.mjs`.
// WITH_MIGRATION=<file> → the file is executed right after the script's own BEGIN, so the script's
// checks run against the migration inside its rolled-back transaction. SANDBOX=1 → the live owner's
// id is swapped for the TEST Sandbox owner's, so nothing is issued on the live shop.
import fs from "node:fs";
import pg from "pg";

const sql = process.env.WITH_MIGRATION ? fs.readFileSync(process.env.WITH_MIGRATION, "utf8") : null;
const LIVE_OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b";
const SANDBOX_OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const swap = (v) => (process.env.SANDBOX && typeof v === "string" ? v.split(LIVE_OWNER).join(SANDBOX_OWNER) : v);
const orig = pg.Client.prototype.query;
pg.Client.prototype.query = function (text, params, cb) {
  if (typeof text === "string") text = swap(text);
  else if (text && typeof text.text === "string") text = { ...text, text: swap(text.text), values: text.values?.map(swap) };
  if (Array.isArray(params)) params = params.map(swap);
  const isBegin = typeof text === "string" && /^\s*begin\s*;?\s*$/i.test(text);
  const p = orig.call(this, text, params, cb);
  if (isBegin && sql && p && typeof p.then === "function") return p.then(async (r) => { await orig.call(this, sql); return r; });
  return p;
};
