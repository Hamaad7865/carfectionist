// Rolled-back proof that a job's bill can be raised as a DRAFT and issued at the till
// when the customer pays — the order 0807d9e+ relies on. Runs on the SANDBOX tenant.
import pg from "pg";
import { DB_URL } from "./_env.mjs";
import { SANDBOX_TENANT } from "./_sandbox.mjs";
const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
let fail = 0;
const check = (l, g, w) => { const ok = String(g) === String(w); if (!ok) fail++; console.log(`  ${ok ? "✓" : "✗"} ${l}: got ${g}${ok ? "" : ` (want ${w})`}`); };
try {
  await c.query("begin");
  const au = (await c.query("select auth_user_id from public.app_users where tenant_id=$1 limit 1",[SANDBOX_TENANT])).rows[0].auth_user_id;
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:au,role:"authenticated"})]);

  const cust = (await c.query("select id from public.customers where tenant_id=$1 limit 1",[SANDBOX_TENANT])).rows[0].id;
  const prod = (await c.query("select id, selling_price from public.products where tenant_id=$1 and is_stocked limit 1",[SANDBOX_TENANT])).rows[0];
  const doc = { id:null, doc_type:"quote", customer_id:cust, vehicle_id:null, template_id:null, template_overrides:{}, valid_until:null, due_date:null, origin:"standalone", discount_kind:null, discount_value:0 };
  const line = { product_id:prod.id, title:"Service", description:null, qty:1, unit_price:Number(prod.selling_price), discount_pct:0, discount_kind:"percent", discount_amount:0, vat_rate:15, sort_order:0, line_kind:null };

  console.log("▸ a quote, agreed");
  const q = (await c.query("select * from public.save_draft($1::jsonb,$2::jsonb,null)",[JSON.stringify(doc),JSON.stringify([line])])).rows[0];
  await c.query("select public.issue_document($1::uuid,null,$2,null)",[q.id,`quote-send:${q.id}`]);
  await c.query("select public.accept_quote($1::uuid,$2::jsonb)",[q.id,JSON.stringify({via:"counter"})]);

  console.log("▸ the car is ready — the bill is RAISED, not issued");
  const inv = (await c.query("select * from public.convert_quote_to_invoice($1::uuid)",[q.id])).rows[0];
  check("bill exists", inv.id != null, "true");
  check("and it is still a draft", inv.status, "draft");
  check("with no number yet", inv.number, "null");

  console.log("▸ the counter adds what they picked up on the way out");
  const both = [line, { ...line, product_id:null, title:"Bottle of sealant", unit_price:500, sort_order:1, line_kind:"product" }];
  const invDoc = { id: inv.id, doc_type:"invoice", customer_id:cust, vehicle_id:null, template_id:null, template_overrides:{}, valid_until:null, due_date:null, origin:"standalone", discount_kind:null, discount_value:0 };
  const grown = (await c.query("select * from public.save_draft($1::jsonb,$2::jsonb,null)",[JSON.stringify(invDoc),JSON.stringify(both)])).rows[0];
  check("the extra line went on", (await c.query("select count(*)::int n from public.document_lines where document_id=$1",[inv.id])).rows[0].n, 2);
  check("total grew", Number(grown.total_incl) > Number(inv.total_incl), "true");

  console.log("▸ they pay — the bill is issued AT THE TILL, then settled");
  const dev = (await c.query("select * from public.register_device('TAB-SBX','probe','1.0',true)")).rows[0];
  const sess = (await c.query("select id from public.open_cash_session('TAB-SBX', 0)")).rows[0].id;
  const issued = (await c.query("select * from public.issue_document($1::uuid,null,$2,$3::uuid)",[inv.id,`pay:${inv.id}:issue`,sess])).rows[0];
  check("it takes its number now", issued.number != null, "true");
  check("and reads issued", issued.status, "issued");
  check("stamped with THIS till", issued.cash_session_id, sess);
  const mv = (await c.query("select count(*)::int n from public.stock_movements where ref_id=$1",[inv.id])).rows[0].n;
  check("stock left the shelf on issue", mv > 0, "true");
  const pay = (await c.query("select * from public.record_payment($1::uuid,'cash',$2,null,null,$3::uuid,null,$4)",[inv.id, grown.total_incl, sess, `pay:${inv.id}`])).rows[0];
  check("payment recorded", pay.id != null, "true");
  const done = (await c.query("select status, amount_paid from public.documents where id=$1",[inv.id])).rows[0];
  check("bill reads paid", done.status, "paid");
  console.log("▸ replaying the issue (a lost response) must not mint a second number");
  const again = (await c.query("select * from public.issue_document($1::uuid,null,$2,$3::uuid)",[inv.id,`pay:${inv.id}:issue`,sess])).rows[0];
  check("same number on replay", again.number, issued.number);
} catch (e) { console.error("✗ FAILED:", e.message); fail++; }
finally { await c.query("rollback"); await c.end(); }
console.log(fail === 0 ? "\nALL GOOD — rolled back." : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
