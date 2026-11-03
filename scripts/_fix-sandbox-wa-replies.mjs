// One-off: bring back the customer WhatsApp replies the webhook filed under the TEST
// Sandbox between 6 Aug and 9 Oct 2026 (Mauritius time), when "the first business_settings row" (heap
// order) pointed at the sandbox. Fixed going forward by liveTenantId() (1ce464d).
//
// Every one of those phone numbers already has a thread in the live shop, and a thread
// is unique per (tenant, phone), so each reply is re-parented into the live thread
// rather than re-tenanted in place. The live thread then gets what ingestInbound would
// have done on arrival: unread +1 per reply, last_inbound_at / last_message_at moved
// up to the reply's own time if later, un-archived. The emptied sandbox threads are
// archived with unread 0 (not deleted). Attached media is COPIED to the live folder —
// the wa_media_read policy keys on the first path segment — and media_path rewritten;
// the sandbox originals are left in place. One audit_events row per reply records
// where it came from.
//
// Pinned by message id + (tenant, conversation) as found on 2026-11-04; the script
// refuses if the set of sandbox inbound replies is not exactly PINNED.
//
// Default is a DRY RUN: checks the media, runs the whole move inside BEGIN/ROLLBACK,
// prints what would change, persists nothing.
//
//   node scripts/_fix-sandbox-wa-replies.mjs            # dry run
//   node scripts/_fix-sandbox-wa-replies.mjs --apply    # copy media, then move (one transaction)
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { DB_URL, SUPABASE_URL, SERVICE_ROLE_KEY, requireEnv } from "./_env.mjs";

requireEnv("SUPABASE_DB_URL", DB_URL);
const APPLY = process.argv.includes("--apply");

const LIVE = "11111111-1111-4111-8111-000000000001";
const SANDBOX = "22222222-2222-4222-8222-000000000002";
const BUCKET = "wa-media";

// The 15 sandbox inbound replies (wa_messages.id), as found on 2026-11-04.
const PINNED = [
  "fa6c96e3-bead-40b4-acc5-b5e39e06420b", "604a0725-0a3e-430e-827f-c39852d1a412", "c4f8739f-e795-4f37-85db-2f18e4bdf100",
  "5cfc836f-87e6-450b-b656-7a1b158068d1", "6a6dacb8-68fb-40ce-ad58-2855d41aaa04", "6bcb56f8-5923-446a-9200-5c12bec0ddb1",
  "f4ecb4f2-66ad-4ff4-8833-33a396c866c4", "65e3a478-f01d-4019-a0dc-38a75607206a", "6d1dbee6-eae5-428b-b29d-b2f18c143331",
  "da9d20ef-15d9-452e-b3b6-c2ea0def77ad", "14c3cf05-b48e-4ef4-9286-1590b73b2bc8", "0c6c14e8-7ad3-42b5-af41-d6beb879fe10",
  "13a8362f-0359-4b4e-9e16-9609da95f447", "811a5d28-8f33-4669-91cf-455018430dbc", "7cb8c9a9-de43-4ea9-ab34-b9cdd6f85e4c",
];

const c = new pg.Client({ connectionString: DB_URL });
await c.connect();

const tail = (phone) => `…${String(phone).slice(-3)}`;
const day = (ts) => new Date(ts).toLocaleDateString("en-GB", { timeZone: "Indian/Mauritius", day: "numeric", month: "short" });

try {
  await c.query("begin");

  // ── what is there ────────────────────────────────────────────────────────────
  const { rows: msgs } = await c.query(
    `select m.id, m.conversation_id as from_conv, m.wa_message_id, m.media_path, m.created_at,
            s.phone_e164, s.unread as s_unread,
            l.id as to_conv, l.archived as l_archived, l.unread as l_unread
       from public.wa_messages m
       join public.wa_conversations s on s.id = m.conversation_id
       left join public.wa_conversations l on l.tenant_id = $1 and l.phone_e164 = s.phone_e164
      where m.tenant_id = $2 and m.direction = 'in'
      order by m.created_at
        for update of m, s`,
    [LIVE, SANDBOX],
  );

  console.log(`Sandbox inbound replies: ${msgs.length}`);
  for (const m of msgs) {
    console.log(`  ${m.id}  ${day(m.created_at).padEnd(7)} phone ${tail(m.phone_e164)}  → live thread ${m.to_conv ?? "NONE"}${m.l_archived ? " (archived)" : ""}${m.media_path ? "  +media" : ""}`);
  }

  if (PINNED.length === 0) {
    console.log("\nPINNED is empty — copy the ids above into PINNED and re-run.");
    throw new Error("not pinned");
  }
  const found = new Set(msgs.map((m) => m.id));
  const missing = PINNED.filter((id) => !found.has(id));
  const extra = [...found].filter((id) => !PINNED.includes(id));
  if (missing.length || extra.length) {
    throw new Error(`set changed since it was pinned — missing ${missing.join(",") || "none"}, new ${extra.join(",") || "none"}`);
  }

  const orphans = msgs.filter((m) => !m.to_conv);
  if (orphans.length) throw new Error(`${orphans.length} replies have no live thread for their phone — not handled by this script`);

  // A wamid the live shop already holds = Meta re-delivered it after a flip; moving it would collide.
  const { rows: dupes } = await c.query(
    `select wa_message_id from public.wa_messages where tenant_id = $1 and wa_message_id = any($2::text[])`,
    [LIVE, msgs.map((m) => m.wa_message_id).filter(Boolean)],
  );
  if (dupes.length) throw new Error(`${dupes.length} replies already exist in the live shop (same wamid) — not handled by this script`);

  // ── media: the sandbox original must exist; the live copy must not (or be the same size) ──
  const media = msgs.filter((m) => m.media_path).map((m) => {
    if (!m.media_path.startsWith(`${SANDBOX}/`)) throw new Error(`${m.id}: media_path outside the sandbox folder: ${m.media_path}`);
    return { id: m.id, from: m.media_path, to: `${LIVE}/${m.media_path.slice(SANDBOX.length + 1)}` };
  });
  const { rows: objs } = await c.query(
    `select name, (metadata->>'size')::bigint as size from storage.objects where bucket_id = $1 and name = any($2::text[])`,
    [BUCKET, media.flatMap((x) => [x.from, x.to])],
  );
  const size = new Map(objs.map((o) => [o.name, o.size]));
  for (const x of media) {
    if (!size.has(x.from)) throw new Error(`${x.id}: sandbox media object missing: ${x.from}`);
    console.log(`  media ${x.from.split("/").pop()} (${size.get(x.from)} bytes): ${size.has(x.to) ? "live copy already there" : "to copy"}`);
  }

  // ── copy media (apply only; storage is outside the transaction — a copy is harmless on its own) ──
  if (APPLY && media.some((x) => !size.has(x.to))) {
    requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    for (const x of media.filter((y) => !size.has(y.to))) {
      const { error } = await admin.storage.from(BUCKET).copy(x.from, x.to);
      if (error) throw new Error(`${x.id}: media copy failed: ${error.message}`);
    }
    const { rows: after } = await c.query(
      `select name, (metadata->>'size')::bigint as size from storage.objects where bucket_id = $1 and name = any($2::text[])`,
      [BUCKET, media.map((x) => x.to)],
    );
    const copied = new Map(after.map((o) => [o.name, o.size]));
    for (const x of media) {
      if (String(copied.get(x.to)) !== String(size.get(x.from))) throw new Error(`${x.id}: live copy missing or wrong size`);
    }
    console.log(`  copied ${media.length} media file(s) to the live folder`);
  }
  const mediaTo = new Map(media.map((x) => [x.id, x.to]));

  // ── move each reply into its live thread ─────────────────────────────────────
  for (const m of msgs) {
    const r = await c.query(
      `update public.wa_messages set tenant_id = $1, conversation_id = $2, media_path = coalesce($3, media_path)
        where id = $4 and tenant_id = $5 and conversation_id = $6 and direction = 'in'`,
      [LIVE, m.to_conv, mediaTo.get(m.id) ?? null, m.id, SANDBOX, m.from_conv],
    );
    if (r.rowCount !== 1) throw new Error(`${m.id}: expected to move 1 row, moved ${r.rowCount}`);
    await c.query(
      `insert into public.audit_events (tenant_id, actor_id, event_type, ref_type, ref_id, payload)
       values ($1, null, 'wa_message_refiled', 'wa_message', $2, $3::jsonb)`,
      [LIVE, m.id, JSON.stringify({
        reason: "inbound reply was filed under the TEST Sandbox by the webhook's first-row tenant lookup (fixed in 1ce464d)",
        from_tenant: SANDBOX,
        from_conversation: m.from_conv,
        to_conversation: m.to_conv,
        media_path_before: m.media_path,
        via: "scripts/_fix-sandbox-wa-replies.mjs, approved by the user in chat on 2026-11-04",
      })],
    );
  }

  // ── live threads: what ingestInbound would have done when each reply arrived ──
  const byLive = new Map();
  for (const m of msgs) {
    const g = byLive.get(m.to_conv) ?? { n: 0, latest: m.created_at };
    g.n += 1;
    if (m.created_at > g.latest) g.latest = m.created_at;
    byLive.set(m.to_conv, g);
  }
  for (const [conv, g] of byLive) {
    const r = await c.query(
      `update public.wa_conversations
          set unread = unread + $2,
              last_inbound_at = greatest(coalesce(last_inbound_at, '-infinity'::timestamptz), $3::timestamptz),
              last_message_at = greatest(last_message_at, $3::timestamptz),
              archived = false
        where id = $1 and tenant_id = $4`,
      [conv, g.n, g.latest, LIVE],
    );
    if (r.rowCount !== 1) throw new Error(`live thread ${conv}: expected 1 row, updated ${r.rowCount}`);
  }

  // ── sandbox threads: now empty → archived, nothing unread ────────────────────
  const fromConvs = [...new Set(msgs.map((m) => m.from_conv))];
  const { rows: [{ left }] } = await c.query(
    `select count(*)::int as left from public.wa_messages where conversation_id = any($1::uuid[])`,
    [fromConvs],
  );
  if (left !== 0) throw new Error(`${left} messages still in the sandbox threads — refusing to archive them`);
  const a = await c.query(
    `update public.wa_conversations set unread = 0, archived = true where id = any($1::uuid[]) and tenant_id = $2`,
    [fromConvs, SANDBOX],
  );
  if (a.rowCount !== fromConvs.length) throw new Error(`archived ${a.rowCount} of ${fromConvs.length} sandbox threads`);

  // ── prove it ─────────────────────────────────────────────────────────────────
  const { rows: [after] } = await c.query(
    `select count(*) filter (where tenant_id = $2 and direction = 'in')::int as sandbox_in,
            count(*) filter (where tenant_id = $1 and direction = 'in')::int as live_in,
            count(*) filter (where id = any($3::uuid[]) and tenant_id = $1)::int as moved
       from public.wa_messages`,
    [LIVE, SANDBOX, PINNED],
  );
  console.log(`\nAfter: sandbox inbound ${after.sandbox_in}, live inbound ${after.live_in}, moved ${after.moved}/${PINNED.length}; ${byLive.size} live threads updated, ${fromConvs.length} sandbox threads archived`);
  if (after.sandbox_in !== 0 || after.moved !== PINNED.length) throw new Error("post-check failed");

  if (APPLY) {
    await c.query("commit");
    console.log("\nAPPLIED — replies are in the live inbox, one audit_events row each.");
  } else {
    await c.query("rollback");
    console.log("\nDRY RUN — rolled back, nothing persisted. Re-run with --apply to write.");
  }
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error(`\n✗ ${e.message} — rolled back.`);
  process.exitCode = 1;
} finally {
  await c.end();
}
