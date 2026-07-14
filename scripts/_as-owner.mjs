// Run a query AS the owner (RLS + app.current_tenant_id resolve):
//   node scripts/_as-owner.mjs "select ..."
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

const sql = process.argv[2];
const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh
requireEnv("SUPABASE_DB_URL", DB_URL);

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
await c.query("select set_config('request.jwt.claims', $1, false)", [
  JSON.stringify({ sub: OWNER, role: "authenticated" }),
]);
const { rows } = await c.query(sql);
console.log(JSON.stringify(rows, null, 2));
await c.end();
