// Proves the Major DB fixes: M2 dead-job skip, M4 car reconcile, M6 void/decline
// wide guards, M15 deliver-prefers-settled. Each scenario runs in a savepoint
// and ROLLS BACK — nothing survives.
//   node scripts/_verify-major-fixes.mjs
import pg from "pg";
import { DB_URL, requireEnv } from "./_env.mjs";

const OWNER = "0eb870dc-ef5b-400a-8744-859c999a1b1b";
requireEnv("SUPABASE_DB_URL", DB_URL);

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
await c.query("begin");

const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };
let probe = 0;
async function refusal(sql, params) {
  const sp = `probe${++probe}`;
  await c.query(`savepoint ${sp}`);
  try {
    const r = await c.query(sql, params);
    await c.query(`release savepoint ${sp}`);
    return { refused: false, rows: r.rows };
  } catch (e) {
    await c.query(`rollback to savepoint ${sp}`);
    return { refused: true, msg: e.message };
  }
}

try {
  await c.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: OWNER, role: "authenticated" }),
  ]);
  const q = async (sql, p) => (await c.query(sql, p)).rows;

  const ref = (await q(
    `select c.id as customer_id, v.id as vehicle_id, c.tenant_id from customers c
     join vehicles v on v.customer_id = c.id limit 1`))[0];
  const mkquote = async (price, vehicleId) => (await q(
    `select (save_draft(jsonb_build_object('doc_type','quote','customer_id',$1::text,'vehicle_id',$2::text),
       jsonb_build_array(jsonb_build_object('product_id', null, 'title','Major probe','qty',1,
         'unit_price',$3::numeric,'discount_pct',0,'vat_rate',15,'sort_order',0,
         'vehicle_id',$2::text)))).id as id`,
    [ref.customer_id, vehicleId ?? ref.vehicle_id, price]))[0].id;
  const issue = async (id) => q(
    'select public.issue_document(p_document_id => $1::uuid, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)',
    [id, 'mz:' + id]);

  // ── M2: cancelled job is not idempotency ──────────────────────────────
  {
    const qa = await mkquote(100);
    await c.query('select accept_quote($1::uuid, null)', [qa]);
    const ja = (await q('select (convert_quote_to_job($1::uuid, null, null, null)).id as id', [qa]))[0].id;
    await c.query('select cancel_job($1::uuid, $2, true, null)', [ja, 'probe cancel']);
    await c.query('select void_quote($1::uuid, $2)', [qa, 'probe void']);
    const r = await refusal('select (convert_quote_to_job($1::uuid, null, null, null)).id as id', [qa]);
    ok(r.refused, 'M2: converting a void quote over a cancelled job returned ' + JSON.stringify(r.rows));
    ok(r.refused && /void/i.test(r.msg), 'M2: refusal does not name the void quote: ' + r.msg);
  }

  console.log('SCN M2 done');
  // ── M4a: cars added later get jobs on re-accept ────────────────────────
  {
    const v2 = (await q(
      `insert into vehicles (tenant_id, customer_id, plate, make) values ($1, $2, 'PRB-001', 'Probe') returning id`,
      [ref.tenant_id, ref.customer_id]))[0].id;
    const v3 = (await q(
      `insert into vehicles (tenant_id, customer_id, plate, make) values ($1, $2, 'PRB-003', 'Probe') returning id`,
      [ref.tenant_id, ref.customer_id]))[0].id;
    const qb = await mkquote(200, ref.vehicle_id);
    await c.query('select accept_quote($1::uuid, null)', [qb]);
    await c.query('select public.convert_quote_to_jobs($1::uuid, null, null, null)', [qb]);
    const one = await q(
      `select count(*)::int as n from jobs where source_quote_id = $1::uuid and status <> 'cancelled'`, [qb]);
    ok(one[0].n === 1, 'M4a setup: expected 1 job, got ' + one[0].n);
    // Two more cars join the quote after acceptance (direct lines: the app
    // freezes accepted quotes, this is the shape a line-edit leaves behind).
    for (const [vid, title, ord] of [[v2, 'Second car', 1], [v3, 'Third car', 2]]) {
      await c.query(
        `insert into document_lines (tenant_id, document_id, title, qty, unit_price, discount_pct, vat_rate, sort_order, vehicle_id)
         values ((select tenant_id from documents where id = $1::uuid), $1::uuid, $2, 1, 300, 0, 15, $3, $4::uuid)`,
        [qb, title, ord, vid]);
    }
    const reac = await q(
      `select j.id from public.convert_quote_to_jobs($1::uuid, null, null, null) j order by j.created_at, j.id`, [qb]);
    ok(reac.length === 3, 'M4a: re-accept returned ' + reac.length + ' jobs, expected 3');
    const live = await q(
      `select v.plate from jobs j left join vehicles v on v.id = j.vehicle_id
        where j.source_quote_id = $1::uuid and j.status <> 'cancelled' order by v.plate`, [qb]);
    const plates = live.map((r) => r.plate).sort();
    ok(live.length === 3 && plates.includes('PRB-001') && plates.includes('PRB-003'),
      'M4a: new cars have no live jobs after re-accept: ' + JSON.stringify(live));
  }

  console.log('SCN M4a done');
  // ── M4b: stale car refuses instead of orphaning ───────────────────────
  {
    const v3 = (await q(
      `insert into vehicles (tenant_id, customer_id, plate, make) values ($1, $2, 'PRB-002', 'Probe') returning id`,
      [ref.tenant_id, ref.customer_id]))[0].id;
    const qc = await mkquote(200, ref.vehicle_id);
    await c.query(
      `insert into document_lines (tenant_id, document_id, title, qty, unit_price, discount_pct, vat_rate, sort_order, vehicle_id)
       values ((select tenant_id from documents where id = $1::uuid), $1::uuid, 'Second car', 1, 300, 0, 15, 1, $2::uuid)`,
      [qc, v3]);
    await c.query('select accept_quote($1::uuid, null)', [qc]);
    await c.query('select public.convert_quote_to_jobs($1::uuid, null, null, null)', [qc]);
    await c.query('delete from document_lines where document_id = $1::uuid and vehicle_id = $2::uuid', [qc, v3]);
    const r = await refusal('select public.convert_quote_to_jobs($1::uuid, null, null, null)', [qc]);
    ok(r.refused, 'M4b: re-accept with a removed car silently succeeded');
    ok(r.refused && /cancel/i.test(r.msg), 'M4b: refusal does not direct to cancel: ' + r.msg);
  }

  console.log('SCN M4b done');
  // ── M6a: draft bill never blocks a void ──────────────────────────────
  {
    const qd = await mkquote(400);
    await c.query('select accept_quote($1::uuid, null)', [qd]);
    await c.query('select (convert_quote_to_invoice($1::uuid)).id as id', [qd]); // draft, never issued
    const r = await refusal('select void_quote($1::uuid, $2)', [qd, 'probe']);
    ok(!r.refused, 'M6a: a mere draft bill still blocks void: ' + (r.refused ? r.msg : ''));
  }

  console.log('SCN M6a done');
  // ── M6b: live bills and live jobs still block a void (no regression) ──
  {
    const qe = await mkquote(500, ref.vehicle_id);
    await c.query('select accept_quote($1::uuid, null)', [qe]);
    const ie = (await q('select (convert_quote_to_invoice($1::uuid)).id as id', [qe]))[0].id;
    await issue(ie);
    const r1 = await refusal('select void_quote($1::uuid, $2)', [qe, 'probe']);
    ok(r1.refused, 'M6b: void slipped past a live source bill');
    ok(r1.refused && /credit-note/i.test(r1.msg), 'M6b: refusal names the wrong remedy: ' + r1.msg);
    // And a live job still blocks first, as before.
    const qe2 = await mkquote(501, ref.vehicle_id);
    await c.query('select accept_quote($1::uuid, null)', [qe2]);
    await c.query('select (convert_quote_to_job($1::uuid, null, null, null)).id as id', [qe2]);
    const r2 = await refusal('select void_quote($1::uuid, $2)', [qe2, 'probe']);
    ok(r2.refused && /cancel the job/i.test(r2.msg), 'M6b: live job no longer blocks void: ' + (r2.refused ? r2.msg : 'voided!'));
  }

  console.log('SCN M6b done');
  // ── M6c: draft bill never blocks a decline ───────────────────────────
  // (Built by hand, not convert: converting an issued quote accepts it as a
  // side effect, and only sent-not-agreed quotes can be declined.)
  {
    const qf = await mkquote(600, ref.vehicle_id);
    await c.query(
      'select public.issue_document(p_document_id => $1::uuid, p_stock_location_id => null, p_idempotency_key => $2, p_session_id => null)',
      [qf, 'mz:' + qf]);
    await c.query(
      `insert into documents (tenant_id, doc_type, status, customer_id, vehicle_id,
         source_document_id, total_incl, created_by)
       values ((select tenant_id from documents where id = $1::uuid), 'invoice', 'draft',
               (select customer_id from documents where id = $1::uuid),
               (select vehicle_id from documents where id = $1::uuid), $1::uuid, 500, null)`,
      [qf]);
    const r = await refusal('select decline_quote($1::uuid, $2)', [qf, 'probe']);
    ok(!r.refused, 'M6c: a mere draft bill still blocks decline: ' + (r.refused ? r.msg : ''));
  }

  console.log('SCN M6c done');
  // ── M15a: paid bill + older stray draft delivers ──────────────────────
  // A draft raised from the quote (counter, abandoned), then the revision
  // billed, issued and paid in full. The old lookup tripped on the older
  // draft; the new one prefers the settled bill.
  {
    const qg = await mkquote(700, ref.vehicle_id);
    await c.query('select accept_quote($1::uuid, null)', [qg]);
    const jg = (await q('select (convert_quote_to_job($1::uuid, null, null, null)).id as id', [qg]))[0].id;
    await c.query("update jobs set status = 'in_progress', started_at = now() where id = $1::uuid", [jg]);
    const d0 = (await q('select (convert_quote_to_invoice($1::uuid)).id as id', [qg]))[0].id;
    await c.query(
      `insert into document_jobs (tenant_id, document_id, job_id)
       values ((select tenant_id from documents where id = $1::uuid), $1::uuid, $2::uuid)
       on conflict do nothing`,
      [d0, jg]);
    const qg2 = (await q('select (revise_quote($1::uuid)).id as id', [qg]))[0].id;
    const ig = (await q('select (convert_quote_to_invoice($1::uuid)).id as id', [qg2]))[0].id;
    await issue(ig);
    await c.query(
      `insert into payments (tenant_id, document_id, method, amount, tendered, change_given)
       values ((select tenant_id from documents where id = $1::uuid), $1::uuid, 'cash',
               (select total_incl from documents where id = $1::uuid),
               (select total_incl from documents where id = $1::uuid), 0)`,
      [ig]);
    await c.query("update documents set status = 'paid', amount_paid = total_incl where id = $1::uuid", [ig]);
    await c.query("update jobs set status = 'ready', ready_at = now() where id = $1::uuid", [jg]);
    const r = await refusal('select deliver_paid_job($1::uuid)', [jg]);
    ok(!r.refused, 'M15a: paid bill + stray draft still refuses delivery: ' + (r.refused ? r.msg : ''));
    const st = (await q('select status from jobs where id = $1::uuid', [jg]))[0].status;
    ok(st === 'delivered', 'M15a: job is ' + st + ', not delivered');
  }

  console.log('SCN M15a done');
  // ── M15b: draft-only refuses naming the draft ────────────────────────
  {
    const qh = await mkquote(800);
    await c.query('select accept_quote($1::uuid, null)', [qh]);
    const jh = (await q('select (convert_quote_to_job($1::uuid, null, null, null)).id as id', [qh]))[0].id;
    await c.query('select (convert_quote_to_invoice($1::uuid)).id as id', [qh]); // draft only
    await c.query("update jobs set status = 'in_progress', started_at = now() where id = $1::uuid", [jh]);
    await c.query("update jobs set status = 'ready', ready_at = now() where id = $1::uuid", [jh]);
    const r = await refusal('select deliver_paid_job($1::uuid)', [jh]);
    ok(r.refused, 'M15b: draft-only job delivered');
    ok(r.refused && /draft/i.test(r.msg), 'M15b: refusal does not name the draft: ' + r.msg);
  }

  console.log('major DB fixes : ok');
  if (fail.length) {
    console.error(`\nFAIL (${fail.length}):`);
    for (const f of fail) console.error(' - ' + f);
    await c.query('rollback');
    process.exit(1);
  }
  await c.query('rollback');
  console.log('PASS — rolled back, nothing survives.');
} catch (e) {
  try { await c.query('rollback'); } catch { /* already out */ }
  console.error('VERIFY ERROR: ' + e.message);
  process.exit(1);
} finally {
  await c.end();
}
