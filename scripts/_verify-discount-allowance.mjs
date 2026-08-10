// Rolled-back verification for the discount-allowance rules.
//
// The owner's rules: a service takes no discount, a carwash takes up to 5% and only
// with a reason, and the whole-document discount cannot go past the sum of what the
// lines allow. Runs as `authenticated` impersonating the owner, then ROLLS BACK.
import pg from "pg";
import { DB_URL } from "./_env.mjs";

const AUTH = "0eb870dc-ef5b-400a-8744-859c999a1b1b"; // Anesh (owner auth uid)

let failures = 0;
const check = (label, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${got}${ok ? "" : ` (want ${want})`}`);
};

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();
try {
  await c.query("begin");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: AUTH, role: "authenticated" }),
  ]);

  const tenant = (await c.query("select app.current_tenant_id() as t")).rows[0].t;

  console.log("▸ a product states how it may be discounted");
  const cols = (await c.query(
    `select column_name from information_schema.columns
      where table_schema='public' and table_name='products' and column_name='discount_policy'`,
  )).rowCount;
  check("products.discount_policy exists", cols, 1);

  const dflt = (await c.query(
    `select column_default from information_schema.columns
      where table_schema='public' and table_name='products' and column_name='discount_policy'`,
  )).rows[0]?.column_default ?? "";
  check("it defaults to 'inherit'", dflt.startsWith("'inherit'"), true);

  let refused = "no";
  try {
    await c.query("savepoint s1");
    await c.query(
      "insert into public.products (tenant_id, name, kind, discount_policy) values ($1,'probe','service','nonsense')",
      [tenant],
    );
  } catch { refused = "yes"; }
  await c.query("rollback to savepoint s1");
  check("a nonsense policy is refused", refused, "yes");
} finally {
  await c.query("rollback");
  await c.end();
}

console.log(failures === 0 ? "\nALL GOOD — nothing persisted (rolled back)." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
