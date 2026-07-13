// Rolled-back verification for the WhatsApp marketing schema
// (20260713000001_wa_campaigns.sql). Applies the migration INSIDE a transaction,
// exercises owner writes + manager RLS denial + the guards, then ROLLS BACK —
// nothing persists. Run before the real apply to prove the migration is sound.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);

const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner auth uid)

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};
const asOwner = (c) => c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: OWNER, role: "authenticated" })]);

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260713000001_wa_campaigns.sql"), "utf8");
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");
  console.log("▸ apply migration inside the transaction");
  await c.query(migration);
  check("wa_opt_out defaults false", (await c.query("select wa_opt_out from customers limit 1")).rows[0]?.wa_opt_out, "false");

  // Find a manager to prove RLS denies non-owners.
  const mgr = (await c.query("select auth_user_id from app_users where role='manager' and is_active limit 1")).rows[0]?.auth_user_id;

  await c.query("set local role authenticated");
  await asOwner(c);
  const tenant = (await c.query("select app.current_tenant_id() t")).rows[0].t;

  console.log("▸ owner creates a template + campaign + recipients");
  const tpl = await c.query(
    "insert into wa_templates (tenant_id, name, language, body, variable_count, status) values ($1,'verify_promo','en','Hi {{1}}!',1,'approved') returning id",
    [tenant],
  );
  check("template inserted", tpl.rows.length, 1);
  const cust = await c.query("select id, name from customers limit 2");
  const camp = await c.query(
    "insert into campaigns (tenant_id, name, wa_template_id, variable_map, status) values ($1,'Verify blast',$2,'{\"1\":\"first_name\"}','draft') returning id",
    [tenant, tpl.rows[0].id],
  );
  check("campaign inserted", camp.rows.length, 1);
  await c.query(
    "insert into campaign_recipients (tenant_id, campaign_id, customer_id, phone_e164, variables, status) values ($1,$2,$3,'23052588854','[\"Anesh\"]','pending')",
    [tenant, camp.rows[0].id, cust.rows[0].id],
  );
  check("recipient inserted", (await c.query("select count(*)::int n from campaign_recipients")).rows[0].n, 1);

  console.log("▸ duplicate (campaign, customer) rejected");
  try {
    await c.query("savepoint d1");
    await c.query(
      "insert into campaign_recipients (tenant_id, campaign_id, customer_id, phone_e164, variables) values ($1,$2,$3,'23052588854','[]')",
      [tenant, camp.rows[0].id, cust.rows[0].id],
    );
    check("dupe recipient rejected", "allowed", "rejected");
  } catch { await c.query("rollback to savepoint d1"); check("dupe recipient rejected", "rejected", "rejected"); }

  console.log("▸ cascade: deleting the draft campaign removes its recipients");
  await c.query("savepoint casc");
  await c.query("delete from campaigns where id=$1", [camp.rows[0].id]);
  check("recipients gone with campaign", (await c.query("select count(*)::int n from campaign_recipients")).rows[0].n, 0);
  await c.query("rollback to savepoint casc");

  if (mgr) {
    console.log("▸ manager cannot read templates/campaigns (RLS owner-only)");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: mgr, role: "authenticated" })]);
    check("manager sees 0 templates", (await c.query("select count(*)::int n from wa_templates")).rows[0].n, 0);
    check("manager sees 0 campaigns", (await c.query("select count(*)::int n from campaigns")).rows[0].n, 0);
    try {
      await c.query("savepoint m1");
      await c.query("insert into wa_templates (tenant_id, name, language, body) values ($1,'mgr_sneak','en','x')", [tenant]);
      check("manager insert denied", "allowed", "denied");
    } catch { await c.query("rollback to savepoint m1"); check("manager insert denied", "denied", "denied"); }
  } else {
    console.log("  (no manager found to test RLS denial — skipped)");
  }
} catch (e) {
  failures++;
  console.error("✗ error:", e.message);
} finally {
  await c.query("rollback"); // nothing persists
  await c.end();
}
console.log(failures === 0 ? "\n✓ all checks passed (rolled back)" : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
