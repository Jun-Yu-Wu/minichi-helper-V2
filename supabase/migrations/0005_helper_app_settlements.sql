alter table helper_app.media_objects
  drop constraint if exists media_objects_media_kind_check;

alter table helper_app.media_objects
  add constraint media_objects_media_kind_check
  check (media_kind in (
    'site_photo',
    'quote_task_photo',
    'quote_detail_reply_photo',
    'purchase_reference_photo',
    'purchase_face_check_photo',
    'settlement_receipt',
    'transport_proof',
    'warehouse_evidence'
  ));

create table if not exists helper_app.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references helper_app.trips(id) on delete restrict,
  helper_id uuid not null references helper_app.helper_profiles(id) on delete restrict,
  status text not null default 'pending_helper_precheck' check (status in (
    'pending_helper_precheck',
    'pending_admin_review',
    'correction_required',
    'pending_helper_confirmation',
    'payment_pending',
    'warehouse_pending',
    'warehouse_review_pending',
    'final_payment_pending',
    'completed'
  )),
  compensation_mode text not null check (compensation_mode in ('hourly', 'fx_rate')),
  hourly_rate_twd integer check (hourly_rate_twd is null or hourly_rate_twd >= 0),
  helper_fx_rate numeric check (helper_fx_rate is null or helper_fx_rate > 0),
  jpy_to_twd_rate numeric check (jpy_to_twd_rate is null or jpy_to_twd_rate > 0),
  product_total_jpy integer not null default 0 check (product_total_jpy >= 0),
  item_advance_twd integer check (item_advance_twd is null or item_advance_twd >= 0),
  work_minutes integer not null default 0 check (work_minutes >= 0),
  work_pay_twd integer check (work_pay_twd is null or work_pay_twd >= 0),
  transport_claim_jpy integer check (transport_claim_jpy is null or transport_claim_jpy >= 0),
  transport_status text not null default 'none' check (transport_status in ('none', 'pending', 'approved', 'rejected')),
  approved_transport_twd integer check (approved_transport_twd is null or approved_transport_twd >= 0),
  total_payable_twd integer check (total_payable_twd is null or total_payable_twd >= 0),
  is_split_payment boolean,
  helper_note text,
  correction_note text,
  admin_review_note text,
  helper_submission_key text unique,
  warehouse_submission_key text unique,
  helper_submitted_at timestamptz,
  admin_reviewed_at timestamptz,
  helper_confirmed_at timestamptz,
  warehouse_submitted_at timestamptz,
  warehouse_reviewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists helper_app.settlement_line_items (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references helper_app.settlements(id) on delete cascade,
  staging_order_preview_id uuid not null references helper_app.staging_order_previews(id) on delete restrict,
  purchase_task_id uuid not null references helper_app.purchase_tasks(id) on delete restrict,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  original_price_jpy integer not null check (original_price_jpy >= 0),
  product_total_jpy integer not null check (product_total_jpy >= 0),
  created_at timestamptz not null default now(),
  unique (settlement_id, staging_order_preview_id)
);

create table if not exists helper_app.settlement_evidence (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references helper_app.settlements(id) on delete cascade,
  storage_key text not null references helper_app.media_objects(storage_key) on delete restrict,
  evidence_type text not null check (evidence_type in ('daily_receipt', 'transport_proof', 'warehouse_proof')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (settlement_id, evidence_type)
);

create table if not exists helper_app.settlement_payments (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references helper_app.settlements(id) on delete restrict,
  payment_type text not null check (payment_type in ('single', 'first', 'final')),
  amount_twd integer not null check (amount_twd > 0),
  transfer_notification text not null check (btrim(transfer_notification) <> ''),
  paid_by_user_id uuid,
  paid_at timestamptz not null default now(),
  unique (settlement_id, payment_type)
);

create index if not exists settlements_helper_status_idx
  on helper_app.settlements(helper_id, status, created_at desc);
create index if not exists settlement_line_items_settlement_idx
  on helper_app.settlement_line_items(settlement_id, created_at);
create index if not exists settlement_payments_settlement_idx
  on helper_app.settlement_payments(settlement_id, paid_at);

alter table helper_app.settlements enable row level security;
alter table helper_app.settlement_line_items enable row level security;
alter table helper_app.settlement_evidence enable row level security;
alter table helper_app.settlement_payments enable row level security;

drop policy if exists settlements_select_own_helper on helper_app.settlements;
create policy settlements_select_own_helper
  on helper_app.settlements for select to authenticated
  using (
    exists (
      select 1 from helper_app.helper_profiles hp
      where hp.id = settlements.helper_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists settlement_line_items_select_own_helper on helper_app.settlement_line_items;
create policy settlement_line_items_select_own_helper
  on helper_app.settlement_line_items for select to authenticated
  using (
    exists (
      select 1
      from helper_app.settlements s
      join helper_app.helper_profiles hp on hp.id = s.helper_id
      where s.id = settlement_line_items.settlement_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists settlement_evidence_select_own_helper on helper_app.settlement_evidence;
create policy settlement_evidence_select_own_helper
  on helper_app.settlement_evidence for select to authenticated
  using (
    exists (
      select 1
      from helper_app.settlements s
      join helper_app.helper_profiles hp on hp.id = s.helper_id
      where s.id = settlement_evidence.settlement_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists settlement_payments_select_own_helper on helper_app.settlement_payments;
create policy settlement_payments_select_own_helper
  on helper_app.settlement_payments for select to authenticated
  using (
    exists (
      select 1
      from helper_app.settlements s
      join helper_app.helper_profiles hp on hp.id = s.helper_id
      where s.id = settlement_payments.settlement_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists settlements_no_direct_writes on helper_app.settlements;
drop policy if exists settlement_line_items_no_direct_writes on helper_app.settlement_line_items;
drop policy if exists settlement_evidence_no_direct_writes on helper_app.settlement_evidence;
drop policy if exists settlement_payments_no_direct_writes on helper_app.settlement_payments;
