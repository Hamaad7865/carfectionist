// Create (or top up) the HAZ DEMO tenant — an invented company to show prospects.
//
//   node scripts/setup-demo.mjs                 # create tenant, catalogue, customers, login
//   node scripts/setup-demo.mjs --history       # …and ring up sample quotes, bills and payments
//   node scripts/setup-demo.mjs --history --more  # add another batch to a tenant that already has some
//   node scripts/setup-demo.mjs --password X    # choose the owner's web password (else generated)
//
// Everything is scoped to DEMO_TENANT and nothing is copied from the live shop.
// The company is flagged is_sandbox, so e-mail/WhatsApp sends are redirected to
// sandbox_send_to and it can never carry a BRN/VAT number (a CHECK enforces that).
//
// Staff PINs are deliberately NOT created: the tablet's pos-auth roster is not
// tenant-scoped, so a PIN user here would show up on the real shop's login screen.
//
// Documents are issued through the real RPCs (save_draft → issue_document →
// record_payment) as the demo owner, so numbering, stock and totals are the
// database's own. History is added only to an empty tenant unless --more is given.
//
// There is NO reset script on purpose: payments, stock_movements and audit_events
// are append-only by trigger (the database invariants), and a wipe would have to
// switch those triggers off on tables the live shop shares. To start a demo over,
// point DEMO_TENANT in _demo.mjs at a fresh uuid and run setup again.
import pg from "pg";
import { randomBytes } from "node:crypto";
import { DB_URL, SUPABASE_URL, SERVICE_ROLE_KEY, requireEnv } from "./_env.mjs";
import { DEMO_TENANT, DEMO_EMAIL } from "./_demo.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
requireEnv("SUPABASE_URL", SUPABASE_URL);
requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

const HISTORY = process.argv.includes("--history");
const pwArg = process.argv.indexOf("--password");
const PASSWORD = pwArg > -1 ? process.argv[pwArg + 1] : `Demo-${randomBytes(4).toString("hex")}`;
const DISPLAY = "Demo Owner";
const SEND_TO = "boodoo.sheik786@gmail.com";

const H = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
const admin = (path, opts = {}) => fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, { ...opts, headers: H });

// ── invented catalogue: [name, kind, category, price ex-VAT, cost, opening stock] ──
const SERVICES = [
  ["Exterior Wash", "service", "Car Wash", 350],
  ["Full Wash & Vacuum", "service", "Car Wash", 600],
  ["Engine Bay Clean", "service", "Car Wash", 900],
  ["Interior Deep Clean", "service", "Detailing", 2800],
  ["Leather Seat Treatment", "service", "Detailing", 2200],
  ["Headlight Restoration", "service", "Detailing", 1500],
  ["Machine Polish (1-step)", "service", "Detailing", 4500],
  ["Paint Correction (2-step)", "service", "Detailing", 9500],
  ["Ceramic Coating — 2 year", "service", "Protection", 18000],
  ["Ceramic Coating — 5 year", "service", "Protection", 32000],
  ["Paint Protection Film (bonnet)", "service", "Protection", 14000],
  ["Window Tint — Front Pair", "service", "Protection", 3800],
];
const PRODUCTS = [
  ["Microfibre Towel 40x40", "product", "Accessories", 180, 80, 120],
  ["Wash Mitt — Chenille", "product", "Accessories", 260, 110, 60],
  ["Foam Applicator Pad", "product", "Accessories", 90, 35, 150],
  ["Tyre Dressing 500ml", "product", "Car Care", 420, 190, 48],
  ["Glass Cleaner 500ml", "product", "Car Care", 310, 130, 60],
  ["Car Shampoo 1L", "product", "Car Care", 480, 210, 54],
  ["Interior Cleaner 500ml", "product", "Car Care", 390, 170, 40],
  ["Leather Conditioner 250ml", "product", "Car Care", 780, 340, 30],
  ["Quick Detailer Spray 500ml", "product", "Car Care", 560, 240, 45],
  ["Carnauba Paste Wax 200g", "product", "Car Care", 1150, 520, 25],
  ["Ceramic Spray Sealant 250ml", "product", "Car Care", 1650, 760, 22],
  ["Clay Bar Kit", "product", "Car Care", 950, 420, 18],
  ["Air Freshener — New Car", "product", "Fragrance", 150, 55, 200],
  ["Car Cologne 100ml", "product", "Fragrance", 690, 280, 40],
  ["Dashcam 1080p", "product", "Electronics", 4900, 2600, 12],
  ["Phone Holder — Vent Mount", "product", "Electronics", 480, 190, 35],
  ["USB Car Charger 36W", "product", "Electronics", 390, 150, 50],
  ["Seat Cover Set (Black)", "product", "Accessories", 5200, 2700, 8],
  ["Floor Mats — Universal", "product", "Accessories", 1900, 900, 20],
  ["Steering Wheel Cover", "product", "Accessories", 650, 260, 25],
  ["LED Headlight Bulb Pair H7", "product", "Electronics", 2400, 1100, 14],
  ["Polishing Compound 500g", "product", "Car Care", 1350, 600, 16],
];

const CUSTOMERS = [
  ["Rajesh Beeharry", "5712 3401", "rajesh.b@example.test", [["1234 AB 21", "Toyota", "Corolla", 2019, "White"]]],
  ["Anita Ramdin", "5798 8812", "anita.r@example.test", [["2210 CD 22", "Honda", "Fit", 2021, "Silver"]]],
  ["Kevin Lagesse", "5744 1090", "kevin.l@example.test", [["3340 EF 20", "BMW", "320i", 2020, "Black"]]],
  ["Marie-Claire Dubois", "5755 6643", "mc.dubois@example.test", [["4415 GH 19", "Suzuki", "Swift", 2018, "Red"]]],
  ["Imran Joomun", "5766 2278", "imran.j@example.test", [["5521 JK 23", "Mercedes", "C200", 2023, "Grey"]]],
  ["Priya Gopaul", "5788 9034", "priya.g@example.test", [["6630 LM 22", "Nissan", "Qashqai", 2022, "Blue"]]],
  ["Sébastien Hardy", "5731 4455", "seb.h@example.test", [["7742 NP 21", "Toyota", "Hilux", 2021, "White"]]],
  ["Nadia Soobratty", "5722 7766", "nadia.s@example.test", [["8853 QR 20", "Hyundai", "Tucson", 2020, "Black"]]],
  ["Blue Lagoon Hotel (fleet)", "230 5555", "fleet@bluelagoon.example.test", [["9964 ST 22", "Toyota", "HiAce", 2022, "White"], ["1075 UV 21", "Kia", "Carnival", 2021, "Silver"]], true],
  ["Coastal Rentals Ltd", "230 6677", "ops@coastalrentals.example.test", [["2186 WX 23", "Suzuki", "Alto", 2023, "Red"], ["3297 YZ 23", "Suzuki", "Alto", 2023, "White"], ["4308 AB 23", "Kia", "Picanto", 2023, "Blue"]], true],
];

// small deterministic PRNG so a re-run on a wiped tenant produces the same look
let seed = 20260111;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

// ── 1. the tenant, its stock room, catalogue, customers ─────────────────────
let owner = null;
try {
  await c.query("begin");

  await c.query(
    `insert into public.business_settings
       (id, legal_name, trading_name, country, vat_rate, prices_vat_exclusive, email, phone, address,
        quote_prefix, quote_next_number, invoice_prefix, invoice_next_number,
        credit_note_prefix, credit_note_next_number, z_next_number,
        receipt_header_text, receipt_footer_text, is_sandbox, sandbox_send_to)
     values ($1, 'HAZ DEMO — SAMPLE COMPANY', 'HAZ Demo Auto Care', 'MU', 15, true,
             'hello@demo.hazsoftware.test', '230 5000 0000', 'Royal Road, Port Louis, Mauritius',
             'DQ-', 1, 'DINV-', 1, 'DCN-', 1, 1,
             'HAZ Demo Auto Care', 'Demo data — not a real business. Thank you!', true, $2)
     on conflict (id) do update set
       legal_name = excluded.legal_name, trading_name = excluded.trading_name, is_sandbox = true,
       sandbox_send_to = excluded.sandbox_send_to`,
    [DEMO_TENANT, SEND_TO],
  );
  console.log(`▸ company: HAZ Demo Auto Care — sends redirected to ${SEND_TO}`);

  const shop = (await c.query(
    `select id from public.stock_locations where tenant_id=$1 and name='Shop'`, [DEMO_TENANT])).rows[0]?.id
    ?? (await c.query(
      `insert into public.stock_locations (tenant_id, name, is_default, is_sales_floor) values ($1,'Shop',true,true) returning id`,
      [DEMO_TENANT])).rows[0].id;
  const warehouse = (await c.query(
    `select id from public.stock_locations where tenant_id=$1 and name='Warehouse'`, [DEMO_TENANT])).rows[0]?.id
    ?? (await c.query(
      `insert into public.stock_locations (tenant_id, name, is_default, is_sales_floor) values ($1,'Warehouse',false,false) returning id`,
      [DEMO_TENANT])).rows[0].id;

  let made = 0;
  for (const [name, kind, category, price, cost = 0, stock = 0] of [...SERVICES, ...PRODUCTS]) {
    const exists = (await c.query(`select id from public.products where tenant_id=$1 and name=$2`, [DEMO_TENANT, name])).rows[0];
    if (exists) continue;
    const p = (await c.query(
      `insert into public.products (tenant_id, name, kind, unit, selling_price, cost_price, vat_rate, is_stocked, category, low_stock_threshold)
       values ($1,$2,$3,$4,$5,$6,15,$7,$8,$9) returning id`,
      [DEMO_TENANT, name, kind, kind === "service" ? "service" : "piece", price, cost, kind === "product", category,
        kind === "product" ? 10 : null],
    )).rows[0];
    made++;
    if (kind === "product" && stock > 0) {
      // event-sourced stock: INSERT-only. Most on the shop floor, some in the warehouse.
      const floor = Math.ceil(stock * 0.6);
      for (const [loc, qty] of [[shop, floor], [warehouse, stock - floor]]) {
        if (qty <= 0) continue;
        await c.query(
          `insert into public.stock_movements (tenant_id, product_id, location_id, qty, unit_cost, ref_type, note)
           values ($1,$2,$3,$4,$5,'adjustment','Opening stock (demo)')`,
          [DEMO_TENANT, p.id, loc, qty, cost],
        );
      }
    }
  }
  console.log(`▸ catalogue: ${made} added (${SERVICES.length} services, ${PRODUCTS.length} products)`);

  let custs = 0;
  for (const [name, phone, email, vehicles, isCompany] of CUSTOMERS) {
    let cu = (await c.query(`select id from public.customers where tenant_id=$1 and name=$2`, [DEMO_TENANT, name])).rows[0];
    if (!cu) {
      cu = (await c.query(
        `insert into public.customers (tenant_id, name, phone, email, is_company) values ($1,$2,$3,$4,$5) returning id`,
        [DEMO_TENANT, name, phone, email, !!isCompany])).rows[0];
      custs++;
      for (const [plate, make, model, year, color] of vehicles) {
        await c.query(
          `insert into public.vehicles (tenant_id, customer_id, plate, make, model, year, color) values ($1,$2,$3,$4,$5,$6,$7)`,
          [DEMO_TENANT, cu.id, plate, make, model, year, color]);
      }
    }
  }
  console.log(`▸ customers: ${custs} added with their vehicles`);
  await c.query("commit");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("✗ failed, nothing kept:", e.message);
  await c.end();
  process.exit(1);
}

// ── 2. the login (GoTrue lives outside our schema) ──────────────────────────
let authId = (await (await admin(`/users?filter=${encodeURIComponent(DEMO_EMAIL)}`)).json().catch(() => null))
  ?.users?.find((u) => u.email === DEMO_EMAIL)?.id ?? null;
let freshLogin = false;
if (!authId) {
  const made = await (await admin("/users", {
    method: "POST",
    body: JSON.stringify({ email: DEMO_EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { display_name: DISPLAY, role: "owner" } }),
  })).json();
  authId = made?.id ?? null;
  freshLogin = !!authId;
}
if (!authId) { console.error("✗ could not create the demo auth user"); await c.end(); process.exit(1); }
owner = (await c.query(`select id from public.app_users where tenant_id=$1 and auth_user_id=$2`, [DEMO_TENANT, authId])).rows[0]?.id;
if (!owner) {
  owner = (await c.query(
    `insert into public.app_users (tenant_id, auth_user_id, display_name, role, is_active) values ($1,$2,$3,'owner',true) returning id`,
    [DEMO_TENANT, authId, DISPLAY])).rows[0].id;
}
console.log(freshLogin ? `▸ login created: ${DEMO_EMAIL}  (password printed below)` : `▸ login already exists: ${DEMO_EMAIL} — password unchanged`);

// ── 3. sample trading history, rung through the real RPCs ───────────────────
if (HISTORY) {
  const have = (await c.query(`select count(*)::int n from public.documents where tenant_id=$1`, [DEMO_TENANT])).rows[0].n;
  if (have > 0 && !process.argv.includes("--more")) {
    console.log(`▸ history: skipped — the demo already has ${have} documents (pass --more to add another batch)`);
  } else {
    const asOwner = async () => {
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: authId, role: "authenticated" })]);
    };
    const prods = (await c.query(
      `select id, name, kind, selling_price from public.products where tenant_id=$1 and is_active`, [DEMO_TENANT])).rows;
    const services = prods.filter((p) => p.kind === "service");
    const goods = prods.filter((p) => p.kind === "product");
    const custRows = (await c.query(
      `select c.id, v.id vehicle_id from public.customers c left join public.vehicles v on v.customer_id=c.id where c.tenant_id=$1`,
      [DEMO_TENANT])).rows;

    const line = (p, qty, i) => ({
      product_id: p.id, title: p.name, description: null, qty, unit_price: Number(p.selling_price),
      discount_pct: 0, discount_kind: "percent", discount_amount: 0, vat_rate: 15, sort_order: i, line_kind: null,
    });
    const basket = () => {
      const lines = [];
      if (rnd() < 0.55) lines.push(line(pick(services.slice(0, 8)), 1, 0));
      const extra = lines.length ? (rnd() < 0.4 ? 1 : 0) : 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < extra; i++) lines.push(line(pick(goods), 1 + Math.floor(rnd() * 2), lines.length));
      return lines;
    };
    const draft = async (docType, cu, lines) => (await c.query(
      "select * from public.save_draft($1::jsonb, $2::jsonb, null)",
      [JSON.stringify({ doc_type: docType, customer_id: cu.id, vehicle_id: cu.vehicle_id ?? null }), JSON.stringify(lines)])).rows[0];
    const issue = async (id) => (await c.query("select * from public.issue_document($1::uuid, null, null, null)", [id])).rows[0];

    const batch = Date.now().toString(36);
    let invoices = 0, quotes = 0, jobs = 0, skipped = 0;
    try {
      await c.query("begin");
      await asOwner();
      const till = (await c.query("select * from public.back_office_till()")).rows[0];

      // 28 paid bills, mixed methods
      for (let n = 0; n < 28; n++) {
        await c.query("savepoint s");
        try {
          const cu = pick(custRows);
          const inv = await issue((await draft("invoice", cu, basket())).id);
          const total = Number(inv.total_incl);
          const m = rnd();
          if (m < 0.42) await c.query("select * from public.record_payment($1::uuid,'cash'::payment_method,$2,$2,null,$3::uuid,null,$4)", [inv.id, total, till.id, `demo-${batch}-${n}-cash`]);
          else if (m < 0.8) await c.query("select * from public.record_payment($1::uuid,'card'::payment_method,$2,null,$5,$3::uuid,null,$4)", [inv.id, total, till.id, `demo-${batch}-${n}-card`, `CARD-${1000 + n}`]);
          else if (m < 0.92) await c.query("select * from public.record_payment($1::uuid,'juice'::payment_method,$2,null,$5,$3::uuid,null,$4)", [inv.id, total, till.id, `demo-${batch}-${n}-juice`, `JUICE-${2000 + n}`]);
          else { // part-paid, to show an open balance
            await c.query("select * from public.record_payment($1::uuid,'cash'::payment_method,$2,$2,null,$3::uuid,null,$4)", [inv.id, Math.round(total / 2), till.id, `demo-${batch}-${n}-part`]);
          }
          await c.query("release savepoint s");
          invoices++;
        } catch (e) { await c.query("rollback to savepoint s"); skipped++; if (skipped < 3) console.log("  – bill skipped:", e.message.split("\n")[0]); }
      }

      // a few unpaid invoices (accounts receivable) and quotes in different states
      for (let n = 0; n < 4; n++) {
        await c.query("savepoint s");
        try { await issue((await draft("invoice", pick(custRows), basket())).id); await c.query("release savepoint s"); invoices++; }
        catch (e) { await c.query("rollback to savepoint s"); skipped++; }
      }
      for (let n = 0; n < 5; n++) {
        await c.query("savepoint s");
        try {
          const ls = [line(pick(services.slice(3)), 1, 0), line(pick(goods), 1, 1)];
          const q = await issue((await draft("quote", pick(custRows), ls)).id);
          await c.query("release savepoint s"); quotes++;
          if (n < 2) { // turn two quotes into jobs, the owner's quote → job flow
            await c.query("savepoint j");
            try { await c.query("select * from public.create_job_from_document($1::uuid)", [q.id]); await c.query("release savepoint j"); jobs++; }
            catch (e) { await c.query("rollback to savepoint j"); console.log("  – job from quote skipped:", e.message.split("\n")[0]); }
          }
        } catch (e) { await c.query("rollback to savepoint s"); skipped++; }
      }
      await c.query("commit");
    } catch (e) {
      await c.query("rollback").catch(() => {});
      console.error("✗ history failed, nothing kept:", e.message);
      await c.end();
      process.exit(1);
    }
    console.log(`▸ history: ${invoices} invoices, ${quotes} quotes, ${jobs} jobs (${skipped} skipped)`);
  }
}

await c.end();
console.log(`
Demo ready.
  web login : ${DEMO_EMAIL}${freshLogin ? `  /  ${PASSWORD}` : "  (existing password)"}
  tenant    : ${DEMO_TENANT}
Start over with a clean demo: change DEMO_TENANT in scripts/_demo.mjs and re-run setup.`);
