-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — zero the points balances of anonymous customers.
--
-- 20260828000010 made a customer with no phone and no email ineligible for
-- loyalty. Two "Walk-in customer" rows had already accrued balances that way
-- (54 and 826 points) — real money-shaped state on a row nobody can identify or
-- contact, so nobody could ever claim it. Bring the data in line with the rule.
--
-- The ledger is append-only (app.forbid_mutation), so nothing is deleted: one
-- compensating 'adjusted' entry per row, and the trg_points_balance trigger
-- drives customers.points_balance to 0. No redemption ever touched either row
-- (checked), so nothing is clawed back from a real customer.
--
-- The rows are NOT renamed and NOT deleted. The Android POS finds the walk-in
-- bucket by the exact string 'Walk-in customer' (findCustomerByName) and its
-- slip hides points by the same string — a rename would spawn a fresh bucket and
-- start printing points against the old one. The invoices billed to these rows
-- are issued and fiscally locked; they stay as they are.
--
-- Idempotent: after this runs the affected rows have points_balance = 0, so a
-- re-run selects nothing.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.customer_points_ledger
  (tenant_id, customer_id, delta, reason, note, created_by)
select tenant_id, id, -points_balance, 'adjusted',
       'Anonymous customer (no phone/email) — not loyalty-eligible; balance zeroed (20260828000010)',
       null
  from public.customers
 where points_balance <> 0
   and nullif(btrim(phone), '') is null
   and nullif(btrim(email), '') is null;

-- Assert the intent held: no anonymous customer is left carrying a balance.
do $$
declare v_left int;
begin
  select count(*) into v_left
    from public.customers
   where points_balance <> 0
     and nullif(btrim(phone), '') is null
     and nullif(btrim(email), '') is null;
  if v_left > 0 then
    raise exception 'still % anonymous customer(s) with a non-zero points balance', v_left;
  end if;
end $$;
