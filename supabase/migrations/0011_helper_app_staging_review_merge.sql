create table if not exists helper_app.staging_merge_jobs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references helper_app.trips(id) on delete restrict,
  status text not null default 'pending_review' check (status in (
    'pending_review',
    'approved',
    'merging',
    'merged',
    'failed',
    'rejected'
  )),
  version integer not null default 1 check (version > 0),
  approved_snapshot jsonb,
  approved_by_user_id uuid,
  approved_at timestamptz,
  rejected_by_user_id uuid,
  rejected_at timestamptz,
  rejection_note text,
  merge_idempotency_key text,
  merged_by_user_id uuid,
  merged_at timestamptz,
  main_order_ids jsonb not null default '[]'::jsonb,
  last_error text,
  recovery_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists helper_app.reviewed_staging_orders (
  id uuid primary key default gen_random_uuid(),
  merge_job_id uuid not null references helper_app.staging_merge_jobs(id) on delete cascade,
  trip_id uuid not null references helper_app.trips(id) on delete restrict,
  helper_id uuid not null references helper_app.helper_profiles(id) on delete restrict,
  staging_order_preview_id uuid not null unique references helper_app.staging_order_previews(id) on delete restrict,
  purchase_task_id uuid not null references helper_app.purchase_tasks(id) on delete restrict,
  line_community_name text not null check (btrim(line_community_name) <> ''),
  product_name text not null check (btrim(product_name) <> ''),
  appearance_notes text not null default '',
  quantity integer not null check (quantity > 0),
  original_price_jpy integer check (original_price_jpy is null or original_price_jpy >= 0),
  sale_price_twd integer not null check (sale_price_twd >= 0),
  source_quote_task_id uuid,
  source_quote_task_photo_id uuid,
  source_quote_reply_id uuid,
  source_rebuy_task_id uuid,
  is_excluded boolean not null default false,
  exclusion_reason text,
  customer_exists boolean not null default false,
  customer_confirmed boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_excluded = false or btrim(coalesce(exclusion_reason, '')) <> '')
);

create table if not exists helper_app.reviewed_staging_order_photos (
  id uuid primary key default gen_random_uuid(),
  reviewed_order_id uuid not null references helper_app.reviewed_staging_orders(id) on delete cascade,
  trip_id uuid not null references helper_app.trips(id) on delete restrict,
  source_purchase_task_photo_id uuid references helper_app.purchase_task_photos(id) on delete set null,
  storage_key text not null references helper_app.media_objects(storage_key) on delete restrict,
  photo_role text not null,
  label text not null default '',
  sort_order integer not null check (sort_order >= 0),
  include_in_merge boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reviewed_order_id, photo_role, sort_order)
);

create index if not exists staging_merge_jobs_status_idx
  on helper_app.staging_merge_jobs(status, updated_at desc);

create index if not exists reviewed_staging_orders_job_idx
  on helper_app.reviewed_staging_orders(merge_job_id, created_at asc);

create index if not exists reviewed_staging_order_photos_order_idx
  on helper_app.reviewed_staging_order_photos(reviewed_order_id, sort_order asc);

alter table helper_app.staging_merge_jobs enable row level security;
alter table helper_app.reviewed_staging_orders enable row level security;
alter table helper_app.reviewed_staging_order_photos enable row level security;

drop policy if exists staging_merge_jobs_no_direct_reads on helper_app.staging_merge_jobs;
drop policy if exists reviewed_staging_orders_no_direct_reads on helper_app.reviewed_staging_orders;
drop policy if exists reviewed_staging_order_photos_no_direct_reads on helper_app.reviewed_staging_order_photos;

drop policy if exists staging_merge_jobs_no_direct_writes on helper_app.staging_merge_jobs;
drop policy if exists reviewed_staging_orders_no_direct_writes on helper_app.reviewed_staging_orders;
drop policy if exists reviewed_staging_order_photos_no_direct_writes on helper_app.reviewed_staging_order_photos;
