-- ═══════════════════════════════════════════════════════════════════════════
-- Carfectionist — seed data (idempotent; safe to re-run)
-- Run AFTER migrations 0001 + 0002 and AFTER scripts/seed-users.mjs (which
-- creates the auth.users that app_users references).
-- Fixed UUIDs + ON CONFLICT everywhere. The number series (*_next_number) is
-- set only on first insert and never reset on re-run.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ─── Tenant / business settings ─────────────────────────────────────────────
insert into business_settings (
  id, legal_name, trading_name, country, brn, vat_number, email, phone, address,
  bank_account_name, bank_account_number, bank_name,
  vat_rate, prices_vat_exclusive,
  quote_prefix, quote_next_number, quote_number_padding,
  invoice_prefix, invoice_next_number, invoice_number_padding,
  receipt_header_text, receipt_footer_text
) values (
  '11111111-1111-4111-8111-000000000001',
  'Diamondbrite Reunion (Mauritius) Ltd', 'Carfectionist', 'MU',
  'C22190760', 'VAT28070619', 'carfectionist@gmail.com', '+230 5258 8854', NULL,
  'Diamondbrite Reunion (Mauritius) Ltd', '000449884716', 'MCB',
  15.00, true,
  'A', 116, 5,
  'INV-', 1, 4,
  'CARFECTIONIST', 'Thank you for choosing Carfectionist!'
)
on conflict (id) do update set
  legal_name = excluded.legal_name, trading_name = excluded.trading_name,
  country = excluded.country, brn = excluded.brn, vat_number = excluded.vat_number,
  email = excluded.email, phone = excluded.phone,
  bank_account_name = excluded.bank_account_name,
  bank_account_number = excluded.bank_account_number, bank_name = excluded.bank_name,
  vat_rate = excluded.vat_rate, prices_vat_exclusive = excluded.prices_vat_exclusive,
  quote_prefix = excluded.quote_prefix, quote_number_padding = excluded.quote_number_padding,
  invoice_prefix = excluded.invoice_prefix, invoice_number_padding = excluded.invoice_number_padding,
  receipt_header_text = excluded.receipt_header_text,
  receipt_footer_text = excluded.receipt_footer_text;
  -- NOTE: quote_next_number / invoice_next_number deliberately NOT updated.

-- ─── Staff (app_users → the auth.users made by seed-users.mjs) ───────────────
insert into app_users (id, tenant_id, auth_user_id, role, display_name, is_active) values
  ('0d000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-000000000001','a0000000-0000-4000-a000-000000000001','owner',     'Rakesh (Owner)',     true),
  ('0d000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-000000000001','a0000000-0000-4000-a000-000000000002','cashier',   'Priya (Cashier)',    true),
  ('0d000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-000000000001','a0000000-0000-4000-a000-000000000003','technician','Deven (Technician)', true),
  ('0d000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-000000000001','a0000000-0000-4000-a000-000000000004','technician','Yash (Technician)',  true),
  ('0d000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-000000000001','a0000000-0000-4000-a000-000000000005','technician','Kevin (Technician)', true)
on conflict (id) do update set
  role = excluded.role, display_name = excluded.display_name, is_active = excluded.is_active;

-- ─── Stock locations ────────────────────────────────────────────────────────
insert into stock_locations (id, tenant_id, name, is_default) values
  ('0a000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-000000000001','Storeroom',  true),
  ('0a000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-000000000001','Shop Floor', false)
on conflict (id) do update set name = excluded.name, is_default = excluded.is_default;

-- ─── Services (~10) — VAT-exclusive prices, not stocked ──────────────────────
insert into products (id, tenant_id, sku, name, kind, unit, selling_price, cost_price, is_stocked, is_active) values
  ('0e000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-000000000001','SVC-DECON-POLISH','Full Decontamination & Body Polish',              'service','service', 32000.00, 0, false, true),
  ('0e000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-000000000001','SVC-WHEEL-DECON', 'Remove Wheel, Decontamination & Polish',          'service','service',  3800.00, 0, false, true),
  ('0e000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-000000000001','SVC-DB-3YR',      'Diamondbrite 3-Year Protection (Exterior Only)',  'service','service', 30000.00, 0, false, true),
  ('0e000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-000000000001','SVC-TINT-STD',    'Window Tint — Standard',                          'service','service',  8500.00, 0, false, true),
  ('0e000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-000000000001','SVC-TINT-CER',    'Window Tint — Premium (Ceramic)',                 'service','service', 14000.00, 0, false, true),
  ('0e000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-000000000001','SVC-PPF-FRONT',   'PPF — Front Package',                             'service','service', 55000.00, 0, false, true),
  ('0e000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-000000000001','SVC-PPF-FULL',    'PPF — Full Body',                                 'service','service',180000.00, 0, false, true),
  ('0e000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-000000000001','SVC-WASH-MAINT',  'Maintenance Wash',                                'service','service',   800.00, 0, false, true),
  ('0e000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-000000000001','SVC-WASH-PREM',   'Premium Wash & Wax',                              'service','service',  1500.00, 0, false, true),
  ('0e000000-0000-4000-8000-00000000000a','11111111-1111-4111-8111-000000000001','SVC-INT-DEEP',    'Interior Deep Clean',                             'service','service',  4500.00, 0, false, true)
on conflict (id) do update set
  sku = excluded.sku, name = excluded.name, kind = excluded.kind, unit = excluded.unit,
  selling_price = excluded.selling_price, is_active = excluded.is_active;

-- ─── Consumables (~16) — stocked, realistic units, a few barcodes ────────────
insert into products (id, tenant_id, sku, name, kind, unit, selling_price, cost_price, is_stocked, low_stock_threshold, barcode, is_active) values
  ('0f000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-000000000001','CON-DB-KIT',   'Diamondbrite Sealant Kit',      'consumable','piece', 6500.00, 4200.0000, true,   5, '5901234123457', true),
  ('0f000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-000000000001','CON-COMP-POL', 'Compound Polish (1L)',          'consumable','ml',        0.18,    0.0850, true,2000, NULL,           true),
  ('0f000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-000000000001','CON-FIN-POL',  'Finishing Polish (1L)',         'consumable','ml',        0.20,    0.0900, true,2000, NULL,           true),
  ('0f000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-000000000001','CON-MF-TOWEL', 'Microfibre Towel',              'consumable','piece',    90.00,   45.0000, true,  30, '5901234123464', true),
  ('0f000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-000000000001','CON-CLAY',     'Clay Bar 200g',                 'consumable','piece',   220.00,  120.0000, true,  10, NULL,           true),
  ('0f000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-000000000001','CON-TINT-FILM','Window Tint Film',              'consumable','m2',      600.00,  250.0000, true,  10, NULL,           true),
  ('0f000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-000000000001','CON-PPF-FILM', 'PPF Film',                      'consumable','m2',     3500.00, 1800.0000, true,   8, NULL,           true),
  ('0f000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-000000000001','CON-FOAM-PAD', 'Foam Applicator Pad',           'consumable','piece',    50.00,   25.0000, true,  25, NULL,           true),
  ('0f000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-000000000001','CON-DEGREASE', 'Degreaser (5L)',                'consumable','ml',        0.03,    0.0120, true,5000, NULL,           true),
  ('0f000000-0000-4000-8000-00000000000a','11111111-1111-4111-8111-000000000001','CON-INT-SHMP', 'Interior Shampoo (5L)',         'consumable','ml',        0.04,    0.0150, true,5000, NULL,           true),
  ('0f000000-0000-4000-8000-00000000000b','11111111-1111-4111-8111-000000000001','CON-GLASS',    'Glass Cleaner (1L)',            'consumable','ml',        0.05,    0.0200, true,3000, '5901234123471', true),
  ('0f000000-0000-4000-8000-00000000000c','11111111-1111-4111-8111-000000000001','CON-TYRE-DRS', 'Tyre Dressing (1L)',            'consumable','ml',        0.07,    0.0300, true,2000, NULL,           true),
  ('0f000000-0000-4000-8000-00000000000d','11111111-1111-4111-8111-000000000001','CON-MASK-TAPE','Masking Tape (roll)',           'consumable','piece',   120.00,   60.0000, true,  15, NULL,           true),
  ('0f000000-0000-4000-8000-00000000000e','11111111-1111-4111-8111-000000000001','CON-IPA-WIPE', 'IPA Panel Wipe (1L)',           'consumable','ml',        0.04,    0.0180, true,2500, NULL,           true),
  ('0f000000-0000-4000-8000-00000000000f','11111111-1111-4111-8111-000000000001','CON-GLOVES',   'Nitrile Gloves (box of 100)',   'consumable','piece',   350.00,  180.0000, true,  10, '5901234123488', true),
  ('0f000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-000000000001','CON-WHEEL-CLN','Wheel Cleaner (1L)',            'consumable','ml',        0.06,    0.0250, true,2000, NULL,           true)
on conflict (id) do update set
  sku = excluded.sku, name = excluded.name, kind = excluded.kind, unit = excluded.unit,
  selling_price = excluded.selling_price, cost_price = excluded.cost_price,
  is_stocked = excluded.is_stocked, low_stock_threshold = excluded.low_stock_threshold,
  barcode = excluded.barcode, is_active = excluded.is_active;

-- ─── Opening stock (adjustment movements; append-only → do nothing on re-run) ─
-- Storeroom (larger holdings)
insert into stock_movements (id, tenant_id, product_id, location_id, qty, unit_cost, ref_type, note) values
  ('d0000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000001',   20, 4200.0000,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000001',10000,   0.0850,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-000000000001', 8000,   0.0900,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000004','0a000000-0000-4000-8000-000000000001',  200,  45.0000,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000005','0a000000-0000-4000-8000-000000000001',   40, 120.0000,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000006','0a000000-0000-4000-8000-000000000001',   60, 250.0000,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000007','0a000000-0000-4000-8000-000000000001',   40,1800.0000,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000008','0a000000-0000-4000-8000-000000000001',  150,  25.0000,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000009','0a000000-0000-4000-8000-000000000001',20000,   0.0120,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-00000000000a','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-00000000000a','0a000000-0000-4000-8000-000000000001',15000,   0.0150,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-00000000000b','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-00000000000b','0a000000-0000-4000-8000-000000000001',12000,   0.0200,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-00000000000c','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-00000000000c','0a000000-0000-4000-8000-000000000001', 8000,   0.0300,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-00000000000d','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-00000000000d','0a000000-0000-4000-8000-000000000001',   80,  60.0000,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-00000000000e','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-00000000000e','0a000000-0000-4000-8000-000000000001',10000,   0.0180,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-00000000000f','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-00000000000f','0a000000-0000-4000-8000-000000000001',   60, 180.0000,'adjustment','opening stock'),
  ('d0000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000010','0a000000-0000-4000-8000-000000000001', 9000,   0.0250,'adjustment','opening stock'),
-- Shop Floor (smaller holdings)
  ('d1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000001','0a000000-0000-4000-8000-000000000002',    5, 4200.0000,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000002','0a000000-0000-4000-8000-000000000002', 2000,   0.0850,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000003','0a000000-0000-4000-8000-000000000002', 1500,   0.0900,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000004','0a000000-0000-4000-8000-000000000002',   50,  45.0000,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000005','0a000000-0000-4000-8000-000000000002',   10, 120.0000,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-000000000006','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000006','0a000000-0000-4000-8000-000000000002',   15, 250.0000,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000007','0a000000-0000-4000-8000-000000000002',    8,1800.0000,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-000000000008','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000008','0a000000-0000-4000-8000-000000000002',   40,  25.0000,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-000000000009','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000009','0a000000-0000-4000-8000-000000000002', 5000,   0.0120,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-00000000000a','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-00000000000a','0a000000-0000-4000-8000-000000000002', 5000,   0.0150,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-00000000000b','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-00000000000b','0a000000-0000-4000-8000-000000000002', 3000,   0.0200,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-00000000000c','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-00000000000c','0a000000-0000-4000-8000-000000000002', 2000,   0.0300,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-00000000000d','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-00000000000d','0a000000-0000-4000-8000-000000000002',   20,  60.0000,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-00000000000e','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-00000000000e','0a000000-0000-4000-8000-000000000002', 2500,   0.0180,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-00000000000f','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-00000000000f','0a000000-0000-4000-8000-000000000002',   15, 180.0000,'adjustment','opening stock'),
  ('d1000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-000000000001','0f000000-0000-4000-8000-000000000010','0a000000-0000-4000-8000-000000000002', 2000,   0.0250,'adjustment','opening stock')
on conflict (id) do nothing;

-- ─── Customers (5) + vehicles (Mauritian plates) ─────────────────────────────
insert into customers (id, tenant_id, name, email, phone, country) values
  ('0c000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-000000000001','Jean-Pierre Laval',  'jp.laval@example.mu',    '+230 5701 1234','MU'),
  ('0c000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-000000000001','Anjali Ramdhony',    'anjali.r@example.mu',    '+230 5702 2345','MU'),
  ('0c000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-000000000001','Marie Celine Dupont','mc.dupont@example.mu',   '+230 5703 3456','MU'),
  ('0c000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-000000000001','Vikram Seebaluck',   'vikram.s@example.mu',    '+230 5704 4567','MU'),
  ('0c000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-000000000001','Hassen Bhagoo',      'hassen.b@example.mu',    '+230 5705 5678','MU')
on conflict (id) do update set
  name = excluded.name, email = excluded.email, phone = excluded.phone;

insert into vehicles (id, tenant_id, customer_id, plate, make, model, year, color) values
  ('0b000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-000000000001','0c000000-0000-4000-8000-000000000001','1234 AB 26','BMW',          '3 Series', 2021,'Black'),
  ('0b000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-000000000001','0c000000-0000-4000-8000-000000000002','5678 CD 22','Toyota',       'Hilux',    2022,'White'),
  ('0b000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-000000000001','0c000000-0000-4000-8000-000000000003','9012 EF 21','Mercedes-Benz','C-Class',  2020,'Silver'),
  ('0b000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-000000000001','0c000000-0000-4000-8000-000000000004','3456 GH 24','Nissan',       'Navara',   2023,'Grey'),
  ('0b000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-000000000001','0c000000-0000-4000-8000-000000000005','7890 IJ 23','Audi',         'Q5',       2022,'Blue')
on conflict (id) do update set
  make = excluded.make, model = excluded.model, year = excluded.year, color = excluded.color;

-- ─── Default Diamondbrite template (both doc types) ──────────────────────────
insert into document_templates (id, tenant_id, name, doc_type, is_default, config) values
  ('0aa00000-0000-4000-8000-000000000001','11111111-1111-4111-8111-000000000001','Diamondbrite', NULL, true,
   '{
      "header_banner_path": null,
      "footer_banner_path": null,
      "logo_path": null,
      "show_bank_details": true,
      "show_terms": true,
      "show_signature": false,
      "terms": [
        "Quotation is valid for 5 days.",
        "Interest at a rate of 2.5% per month will be charged on overdue amounts after 14 days from the invoice due date."
      ],
      "custom_fields": []
    }'::jsonb)
on conflict (id) do update set
  name = excluded.name, is_default = excluded.is_default, config = excluded.config;

commit;
