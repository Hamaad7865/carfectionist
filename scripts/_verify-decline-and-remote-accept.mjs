import { readFileSync } from "node:fs";
import pg from "pg";
import { DB_URL } from "./_env.mjs";
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");
  await c.query(readFileSync("supabase/migrations/20260804000050_a_customer_can_say_no.sql", "utf8"));
  console.log("✓ migration applies");
  // The shop closed the day. Reopen it INSIDE this transaction so issue_document runs;
  // the rollback puts it straight back.
  await c.query("update public.trading_days set status='open' where business_date = app.mu_today()");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: "0eb870dc-ef5b-400a-8744-859c999a1b1b", role: "authenticated" })]);
  const tenant = (await c.query("select app.current_tenant_id() t")).rows[0].t;
  const cust = (await c.query("select id from public.customers where tenant_id=$1 limit 1",[tenant])).rows[0].id;
  const prod = (await c.query("select id, selling_price from public.products where tenant_id=$1 limit 1",[tenant])).rows[0];
  const doc = { id:null, doc_type:"quote", customer_id:cust, vehicle_id:null, template_id:null, template_overrides:{}, valid_until:null, due_date:null, origin:"standalone", discount_kind:null, discount_value:0 };
  const lines = [{ product_id:prod.id, title:"X", description:null, qty:1, unit_price:Number(prod.selling_price), discount_pct:0, discount_kind:"percent", discount_amount:0, vat_rate:15, sort_order:0 }];
  const q = (await c.query("select * from public.save_draft($1::jsonb,$2::jsonb,null)",[JSON.stringify(doc),JSON.stringify(lines)])).rows[0];
  const check=(l,g,w)=>console.log(`  ${String(g)===String(w)?"✓":"✗"} ${l}: got ${g}${String(g)===String(w)?"":` (want ${w})`}`);

  try { await c.query("savepoint s"); await c.query("select public.decline_quote($1::uuid,null)",[q.id]); check("a draft is refused","allowed","refused"); }
  catch(e){ await c.query("rollback to savepoint s"); check("a draft is refused", /never sent/.test(e.message), "true"); }

  const sent = (await c.query("select * from public.issue_document($1::uuid,null,$2,null)",[q.id,`quote-send:${q.id}`])).rows[0];
  check("sent quote is issued", sent.status, "issued");
  const d = (await c.query("select * from public.decline_quote($1::uuid,$2)",[q.id,"  Too expensive  "])).rows[0];
  check("status becomes declined", d.status, "declined");
  check("reason is trimmed and kept", d.declined_reason, "Too expensive");
  check("declined_at stamped", d.declined_at != null, "true");
  const again = (await c.query("select * from public.decline_quote($1::uuid,null)",[q.id])).rows[0];
  check("a second tap is idempotent", again.status, "declined");
  check("the replay does not wipe the reason", again.declined_reason, "Too expensive");
  try { await c.query("savepoint s2"); await c.query("select * from public.convert_quote_to_invoice($1::uuid)",[q.id]); check("a declined quote is not billable","allowed","refused"); }
  catch(e){ await c.query("rollback to savepoint s2"); check("a declined quote is not billable", /cannot invoice/.test(e.message), "true"); }

  console.log("\n▸ accepting with no signature — the remote yes");
  const q2 = (await c.query("select * from public.save_draft($1::jsonb,$2::jsonb,null)",[JSON.stringify(doc),JSON.stringify(lines)])).rows[0];
  await c.query("select public.issue_document($1::uuid,null,$2,null)",[q2.id,`quote-send:${q2.id}`]);
  const a = (await c.query("select * from public.accept_quote($1::uuid,$2::jsonb)",[q2.id, JSON.stringify({ via:"whatsapp", name:"Yashveer Bagwan" })])).rows[0];
  check("accepted with no pad", a.status, "accepted");
  check("the channel is on the record", a.accepted_signature?.via, "whatsapp");
  check("who agreed is on the record", a.accepted_signature?.name, "Yashveer Bagwan");
  check("stamped with a time", a.accepted_signature?.at != null, "true");
  check("no signature image, and that is fine", a.accepted_signature?.path ?? "none", "none");
} catch(e){ console.error("✗ FAILED:", e.message); process.exitCode=1; }
finally { await c.query("rollback"); await c.end(); console.log("\nrolled back — nothing persisted"); }
