-- ═══════════════════════════════════════════════════════════════════════════
-- Carfection — migration: credit-note number series
-- Bug: app.next_document_number only knew quote/invoice, so EVERY credit note
-- (create_and_issue_credit_note, web + POS) failed with "no number series for
-- doc_type credit_note" — despite business_settings carrying credit_note_*
-- counter columns since day one. Adds the missing branch (gapless, CN-####).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function app.next_document_number(p_tenant uuid, p_doc_type doc_type)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prefix text; v_num int; v_pad int;
begin
  if p_doc_type = 'quote' then
    update public.business_settings
       set quote_next_number = quote_next_number + 1
     where id = p_tenant
     returning quote_prefix, quote_next_number - 1, quote_number_padding
       into v_prefix, v_num, v_pad;
  elsif p_doc_type = 'invoice' then
    update public.business_settings
       set invoice_next_number = invoice_next_number + 1
     where id = p_tenant
     returning invoice_prefix, invoice_next_number - 1, invoice_number_padding
       into v_prefix, v_num, v_pad;
  elsif p_doc_type = 'credit_note' then
    update public.business_settings
       set credit_note_next_number = credit_note_next_number + 1
     where id = p_tenant
     returning credit_note_prefix, credit_note_next_number - 1, credit_note_number_padding
       into v_prefix, v_num, v_pad;
  else
    raise exception 'no number series for doc_type %', p_doc_type;
  end if;
  if v_prefix is null then
    raise exception 'tenant % not found for numbering', p_tenant;
  end if;
  return v_prefix || lpad(v_num::text, v_pad, '0');
end $$;
revoke execute on function app.next_document_number(uuid, doc_type) from public;
