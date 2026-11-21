// Phase D, on real data: a two-company checkout on the TEST Sandbox (a second, non-VAT company
// created for the run), then checks what each bill's fiscal snapshot says and who can read the
// issuing company the paper prints from. ROLLS BACK — nothing is kept. Read-only on the live shop.
//   node --env-file=C:/Projects/Carfection/.env scripts/_verify-issuer-snapshot.mjs
import pg from "pg";

const SANDBOX = "22222222-2222-4222-8222-000000000002";
const SANDBOX_OWNER = "b729191b-1159-4d46-88c7-3c9aceb5e664";
const TYRE_PRODUCT = "87530748-1b27-459a-9f20-ec7cf3e28e7f";
const SERVICE_PRODUCT = "948e53f4-54ba-4f11-80c1-7059b3735604";
const CAR_OWNER = "3668d8c3-75cc-402e-8fa5-143460857959";
const LIVE = "11111111-1111-4111-8111-000000000001";

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${JSON.stringify(got)}${ok ? "" : `  (want ${JSON.stringify(want)})`}`);
};
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await c.connect();
const q = async (text, params) => (await c.query(text, params)).rows;
const one = async (text, params) => (await c.query(text, params)).rows[0];
const as = async (authUid) => {
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: authUid, role: "authenticated" })]);
};
const asAdmin = () => c.query("reset role");
const line = (productId, title, price, extra = {}) => ({
  product_id: productId, vehicle_id: null, title, description: null, description_richtext: null, unit_label: null,
  qty: 1, unit_price: price, discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15,
  sort_order: 0, line_kind: null, price_includes_vat: false, ...extra,
});

try {
  await c.query("begin");
  await c.query("set local lock_timeout = '5s'");

  // ── the live shop, read-only: every bill names a company it can read ─────────────────────
  console.log("Carfectionist (read-only):");
  const live = await one(
    `select count(*) filter (where d.legal_entity_id is null) no_company,
            count(*) filter (where d.legal_entity_id is not null and le.id is null) unreadable,
            count(distinct d.legal_entity_id) companies
       from documents d left join legal_entities le on le.id = d.legal_entity_id and le.tenant_id = d.tenant_id
      where d.tenant_id = $1`, [LIVE]);
  check("bills naming a company that does not exist in the shop", live.unreadable, 0);
  check("…one company only", `${live.companies <= 1}`, "true");
  console.log(`    (${live.no_company} older bills name no company — they print the shop's settings, as before)`);

  // ── the sandbox becomes a two-company shop ─────────────────────────────────────────────────
  const tyre = await one("select id, legal_name, brn, vat_number from legal_entities where tenant_id = $1 and is_default", [SANDBOX]);
  const svc = (await one(
    `insert into legal_entities (tenant_id, legal_name, trading_name, brn, vat_registered, vat_number, vat_rate, quote_prefix, invoice_prefix, credit_note_prefix, sort_order)
     values ($1, 'TEST Wheel Services Ltd', 'TEST Wheel Services', 'C99999999', false, null, 0, 'TESTWQ-', 'TESTWS-', 'TESTWCN-', 1) returning id`, [SANDBOX])).id;
  await c.query("update products set legal_entity_id = $1 where id = $2", [svc, SERVICE_PRODUCT]);
  await c.query("update trading_days set status = 'open' where tenant_id = $1 and business_date = app.mu_today() and status = 'closed'", [SANDBOX]);
  await c.query("update cash_sessions set status = 'closed', closed_at = now() where tenant_id = $1 and status = 'open'", [SANDBOX]);
  await as(SANDBOX_OWNER);
  const till = (await one("select (public.back_office_till()).id")).id;
  const d = { id: null, doc_type: "invoice", customer_id: CAR_OWNER, vehicle_id: null, template_id: null, template_overrides: {},
    valid_until: null, due_date: null, origin: "standalone", discount_kind: null, discount_value: 0, discount_reason: null };
  const draft = (await one("select (public.save_draft($1::jsonb, $2::jsonb, null)).id", [JSON.stringify(d), JSON.stringify([
    line(TYRE_PRODUCT, "Tyre 205/55R16", 2000, { qty: 2 }), line(SERVICE_PRODUCT, "Wheel alignment", 1300, { sort_order: 1 })])])).id;
  const inv = await q(
    `select id, number, legal_entity_id, issued_legal_name, issued_brn, issued_vat_number, vat_total
       from public.issue_checkout($1, null, 'vis:1', $2, null)`, [draft, till]);
  await asAdmin();

  console.log("\nWhat each bill's fiscal snapshot says:");
  const [t, s] = inv;
  check("tyre bill: the tyre company's legal name, BRN and VAT number",
    `${t.issued_legal_name} | ${t.issued_brn} | ${t.issued_vat_number}`, `${tyre.legal_name} | ${tyre.brn} | ${tyre.vat_number}`);
  check("service bill: the service company's legal name and BRN, no VAT number",
    `${s.issued_legal_name} | ${s.issued_brn} | ${s.issued_vat_number}`, "TEST Wheel Services Ltd | C99999999 | null");
  check("service bill: no VAT", s.vat_total, "0.00");

  console.log("\nWho can read the service company (the paper prints from it):");
  const staff = await q(
    `select au.auth_user_id uid, au.role from app_users au
      where au.tenant_id = $1 and au.auth_user_id is not null and au.is_active order by au.role`, [SANDBOX]);
  const tried = new Set();
  for (const u of staff) {
    if (tried.has(u.uid)) continue;
    tried.add(u.uid);
    await c.query("savepoint r");
    await as(u.uid);
    const n = (await one("select count(*) n from legal_entities where id = $1", [svc])).n;
    await c.query("rollback to savepoint r");
    check(`  ${u.role}`, n, 1);
  }
  // The read rule is by shop, not by role — proved on the live shop's own logins (read-only).
  const liveStaff = await q(
    `select au.auth_user_id uid, au.role from app_users au
      where au.tenant_id = $1 and au.auth_user_id is not null and au.is_active`, [LIVE]);
  let liveOk = 0;
  for (const u of liveStaff) {
    await c.query("savepoint r");
    await as(u.uid);
    liveOk += Number((await one("select count(*) n from legal_entities where is_default")).n) === 1 ? 1 : 0;
    await c.query("rollback to savepoint r");
  }
  check(`every live staff login (${[...new Set(liveStaff.map((u) => u.role))].sort().join(", ")}) reads its company`, `${liveOk}/${liveStaff.length}`, `${liveStaff.length}/${liveStaff.length}`);
  await c.query("savepoint r");
  await c.query("set local role anon");
  let anon;
  try { anon = (await one("select count(*) n from legal_entities")).n; } catch (e) { anon = `refused (${e.message.split("\n")[0]})`; }
  await c.query("rollback to savepoint r");
  console.log(`    anonymous visitors: ${anon} — the public receipt link reads with the server key instead`);
  await c.query("savepoint r");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: "0eb870dc-ef5b-400a-8744-859c999a1b1b", role: "authenticated" })]);
  check("Carfectionist's owner cannot see the sandbox's companies", (await one("select count(*) n from legal_entities where id = $1", [svc])).n, 0);
  await c.query("rollback to savepoint r");
} catch (e) {
  failures++;
  console.log(`✗ aborted: ${e.message}`);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(failures ? `\n${failures} FAILED` : "\nALL GOOD (rolled back — nothing kept)");
  process.exitCode = failures ? 1 : 0;
}
