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
    'warehouse_evidence',
    'rebuy_reference_photo',
    'rebuy_report_photo'
  ));

create table if not exists helper_app.rebuy_tasks (
  id uuid primary key default gen_random_uuid(),
  visibility text not null check (visibility in ('private', 'public')),
  assigned_helper_id uuid references helper_app.helper_profiles(id) on delete restrict,
  claimed_helper_id uuid references helper_app.helper_profiles(id) on delete restrict,
  source_purchase_task_id uuid references helper_app.purchase_tasks(id) on delete set null,
  source_trip_id uuid references helper_app.trips(id) on delete set null,
  line_community_name text,
  product_name text not null check (btrim(product_name) <> ''),
  quantity integer not null check (quantity > 0),
  original_price_jpy integer check (original_price_jpy is null or original_price_jpy >= 0),
  sale_price_twd integer check (sale_price_twd is null or sale_price_twd >= 0),
  instructions text,
  priority integer not null default 100 check (priority >= 0),
  public_available_at timestamptz,
  status text not null default 'open' check (status in (
    'open',
    'claimed',
    'reported',
    'checked_out',
    'canceled'
  )),
  version integer not null default 1,
  claim_idempotency_key text,
  release_idempotency_key text,
  report_idempotency_key text,
  checkout_idempotency_key text,
  reported_quantity integer check (reported_quantity is null or reported_quantity >= 0),
  remaining_quantity integer check (remaining_quantity is null or remaining_quantity >= 0),
  remaining_reason text,
  helper_report_note text,
  report_photos_omitted boolean not null default false,
  checkout_trip_id uuid references helper_app.trips(id) on delete set null,
  checkout_purchase_task_id uuid references helper_app.purchase_tasks(id) on delete set null,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  released_at timestamptz,
  reported_at timestamptz,
  checked_out_at timestamptz,
  canceled_at timestamptz,
  check (
    (visibility = 'private' and assigned_helper_id is not null)
    or (visibility = 'public')
  ),
  check (
    (visibility = 'public')
    or claimed_helper_id is null
  )
);

create unique index if not exists rebuy_tasks_claim_idempotency_idx
  on helper_app.rebuy_tasks(claimed_helper_id, claim_idempotency_key)
  where claim_idempotency_key is not null;

create unique index if not exists rebuy_tasks_report_idempotency_idx
  on helper_app.rebuy_tasks(coalesce(claimed_helper_id, assigned_helper_id), report_idempotency_key)
  where report_idempotency_key is not null;

create unique index if not exists rebuy_tasks_checkout_idempotency_idx
  on helper_app.rebuy_tasks(coalesce(claimed_helper_id, assigned_helper_id), checkout_idempotency_key)
  where checkout_idempotency_key is not null;

create index if not exists rebuy_tasks_public_open_idx
  on helper_app.rebuy_tasks(priority asc, public_available_at asc, created_at asc)
  where visibility = 'public' and status = 'open';

create index if not exists rebuy_tasks_helper_status_idx
  on helper_app.rebuy_tasks(coalesce(claimed_helper_id, assigned_helper_id), status, created_at desc);

create table if not exists helper_app.rebuy_task_photos (
  id uuid primary key default gen_random_uuid(),
  rebuy_task_id uuid not null references helper_app.rebuy_tasks(id) on delete cascade,
  storage_key text not null references helper_app.media_objects(storage_key) on delete restrict,
  photo_role text not null check (photo_role in ('reference', 'report')),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (rebuy_task_id, photo_role, sort_order)
);

create index if not exists rebuy_task_photos_task_order_idx
  on helper_app.rebuy_task_photos(rebuy_task_id, photo_role, sort_order asc);

alter table helper_app.purchase_tasks
  add column if not exists source_rebuy_task_id uuid references helper_app.rebuy_tasks(id) on delete set null;

alter table helper_app.staging_order_previews
  add column if not exists source_rebuy_task_id uuid references helper_app.rebuy_tasks(id) on delete set null;

alter table helper_app.rebuy_tasks enable row level security;
alter table helper_app.rebuy_task_photos enable row level security;

drop policy if exists rebuy_tasks_select_visible_helper on helper_app.rebuy_tasks;
create policy rebuy_tasks_select_visible_helper
  on helper_app.rebuy_tasks for select to authenticated
  using (
    visibility = 'public' and status = 'open'
    or exists (
      select 1 from helper_app.helper_profiles hp
      where hp.auth_user_id = auth.uid()
        and hp.is_active = true
        and hp.id = coalesce(rebuy_tasks.claimed_helper_id, rebuy_tasks.assigned_helper_id)
    )
  );

drop policy if exists rebuy_task_photos_select_visible_helper on helper_app.rebuy_task_photos;
create policy rebuy_task_photos_select_visible_helper
  on helper_app.rebuy_task_photos for select to authenticated
  using (
    exists (
      select 1
      from helper_app.rebuy_tasks rt
      where rt.id = rebuy_task_photos.rebuy_task_id
        and (
          rt.visibility = 'public' and rt.status = 'open'
          or exists (
            select 1 from helper_app.helper_profiles hp
            where hp.auth_user_id = auth.uid()
              and hp.is_active = true
              and hp.id = coalesce(rt.claimed_helper_id, rt.assigned_helper_id)
          )
        )
    )
  );

drop policy if exists rebuy_tasks_no_direct_writes on helper_app.rebuy_tasks;
drop policy if exists rebuy_task_photos_no_direct_writes on helper_app.rebuy_task_photos;
