// Run a SQL file against the hosted DB and report the result. Intended for files that
// end by raising an exception so the whole batch rolls back (dry runs).
import fs from "node:fs";
import pg from "pg";
const sql = fs.readFileSync(process.argv[2], "utf8");
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try { await c.query(sql); console.log("NO EXCEPTION — batch committed!"); }
catch (e) { console.log(e.message); }
finally { await c.end(); }
