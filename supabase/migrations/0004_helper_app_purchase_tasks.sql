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

create table if not exists helper_app.purchase_tasks (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references helper_app.trips(id) on delete cascade,
  helper_id uuid not null references helper_app.helper_profiles(id) on delete restrict,
  source_quote_task_id uuid references helper_app.quote_tasks(id) on delete set null,
  source_quote_task_photo_id uuid references helper_app.quote_task_photos(id) on delete set null,
  source_quote_reply_id uuid references helper_app.quote_photo_replies(id) on delete set null,
  line_community_name text not null check (btrim(line_community_name) <> ''),
  product_name text not null check (btrim(product_name) <> ''),
  quantity integer not null check (quantity > 0),
  original_price_jpy integer check (original_price_jpy is null or original_price_jpy >= 0),
  sale_price_twd integer not null check (sale_price_twd >= 0),
  note text,
  requires_face_check boolean not null default false,
  status text not null default 'open' check (status in (
    'open',
    'review_pending',
    'approved_pending_helper_confirmation',
    'completed',
    'canceled',
    'unavailable',
    'not_found'
  )),
  completed_quantity integer check (completed_quantity is null or completed_quantity >= 0),
  unavailable_quantity integer check (unavailable_quantity is null or unavailable_quantity >= 0),
  helper_note text,
  face_check_note text,
  admin_review_note text,
  idempotency_key text,
  created_by_user_id uuid,
  admin_reviewed_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  canceled_at timestamptz,
  unique (source_quote_task_photo_id)
);

create table if not exists helper_app.purchase_task_photos (
  id uuid primary key default gen_random_uuid(),
  purchase_task_id uuid not null references helper_app.purchase_tasks(id) on delete cascade,
  trip_id uuid not null references helper_app.trips(id) on delete cascade,
  helper_id uuid not null references helper_app.helper_profiles(id) on delete restrict,
  storage_key text not null references helper_app.media_objects(storage_key) on delete restrict,
  photo_role text not null check (photo_role in ('source', 'detail_reply', 'manual_reference', 'face_check_report')),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (purchase_task_id, photo_role, sort_order)
);

create table if not exists helper_app.staging_order_previews (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references helper_app.trips(id) on delete cascade,
  helper_id uuid not null references helper_app.helper_profiles(id) on delete restrict,
  purchase_task_id uuid not null unique references helper_app.purchase_tasks(id) on delete cascade,
  line_community_name text not null check (btrim(line_community_name) <> ''),
  product_name text not null check (btrim(product_name) <> ''),
  quantity integer not null check (quantity > 0),
  original_price_jpy integer check (original_price_jpy is null or original_price_jpy >= 0),
  sale_price_twd integer not null check (sale_price_twd >= 0),
  status text not null default 'preview' check (status in ('preview')),
  source_quote_task_id uuid,
  source_quote_task_photo_id uuid,
  source_quote_reply_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_tasks_trip_status_idx
  on helper_app.purchase_tasks(trip_id, status, created_at desc);

create index if not exists purchase_tasks_helper_status_idx
  on helper_app.purchase_tasks(helper_id, status, created_at desc);

create index if not exists purchase_task_photos_task_order_idx
  on helper_app.purchase_task_photos(purchase_task_id, photo_role, sort_order asc);

create index if not exists staging_order_previews_trip_created_idx
  on helper_app.staging_order_previews(trip_id, created_at desc);

alter table helper_app.purchase_tasks enable row level security;
alter table helper_app.purchase_task_photos enable row level security;
alter table helper_app.staging_order_previews enable row level security;

drop policy if exists purchase_tasks_select_active_assigned_helper on helper_app.purchase_tasks;
create policy purchase_tasks_select_active_assigned_helper
  on helper_app.purchase_tasks
  for select
  to authenticated
  using (
    exists (
      select 1
      from helper_app.trips t
      join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
      where t.id = purchase_tasks.trip_id
        and hp.id = purchase_tasks.helper_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists purchase_task_photos_select_active_assigned_helper on helper_app.purchase_task_photos;
create policy purchase_task_photos_select_active_assigned_helper
  on helper_app.purchase_task_photos
  for select
  to authenticated
  using (
    exists (
      select 1
      from helper_app.trips t
      join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
      where t.id = purchase_task_photos.trip_id
        and hp.id = purchase_task_photos.helper_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists staging_order_previews_select_active_assigned_helper on helper_app.staging_order_previews;
create policy staging_order_previews_select_active_assigned_helper
  on helper_app.staging_order_previews
  for select
  to authenticated
  using (
    exists (
      select 1
      from helper_app.trips t
      join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
      where t.id = staging_order_previews.trip_id
        and hp.id = staging_order_previews.helper_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists purchase_tasks_no_direct_writes on helper_app.purchase_tasks;
drop policy if exists purchase_task_photos_no_direct_writes on helper_app.purchase_task_photos;
drop policy if exists staging_order_previews_no_direct_writes on helper_app.staging_order_previews;
