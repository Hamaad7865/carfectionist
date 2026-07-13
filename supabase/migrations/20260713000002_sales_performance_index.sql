-- Keep the owner dashboard's fiscal sales keyset read index-only friendly.
-- The documents status constraint means credit notes can only contribute while
-- issued; invoices can contribute while issued, partly paid, or paid.
create index if not exists idx_documents_sales_performance
  on public.documents (tenant_id, issued_at, id)
  where issued_at is not null
    and doc_type in ('invoice', 'credit_note')
    and status in ('issued', 'partly_paid', 'paid');
