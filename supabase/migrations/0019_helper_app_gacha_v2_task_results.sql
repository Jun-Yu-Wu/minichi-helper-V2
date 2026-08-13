-- Dedicated gacha / blind-box helper reporting.
-- Existing rows remain legacy. Only newly published gacha/blind-box tasks use
-- the v2 workflow and its per-item result rows.

alter table helper_app.purchase_tasks
  add column if not exists workflow_version text not null default 'legacy';

alter table helper_app.purchase_tasks
  drop constraint if exists purchase_tasks_workflow_version_check;

alter table helper_app.purchase_tasks
  add constraint purchase_tasks_workflow_version_check
  check (workflow_version in ('legacy', 'gacha_v2'));

alter table helper_app.purchase_tasks
  add column if not exists source_gacha_template_id uuid;

alter table helper_app.purchase_tasks
  add column if not exists version integer not null default 1;

alter table helper_app.purchase_tasks
  drop constraint if exists purchase_tasks_version_check;

alter table helper_app.purchase_tasks
  add constraint purchase_tasks_version_check check (version > 0);

alter table helper_app.purchase_batches
  add column if not exists intake_status text not null default 'accepting';

alter table helper_app.purchase_batches
  drop constraint if exists purchase_batches_intake_status_check;

alter table helper_app.purchase_batches
  add constraint purchase_batches_intake_status_check
  check (intake_status in ('accepting', 'frozen'));

drop index if exists helper_app.purchase_batches_open_group_idx;
create unique index if not exists purchase_batches_accepting_group_idx
  on helper_app.purchase_batches(trip_id, group_key)
  where status = 'open' and intake_status = 'accepting';

create index if not exists purchase_batches_trip_group_sequence_idx
  on helper_app.purchase_batches(trip_id, group_key, sequence desc);

alter table helper_app.staging_order_previews
  add column if not exists workflow_version text not null default 'legacy';

alter table helper_app.staging_order_previews
  drop constraint if exists staging_order_previews_workflow_version_check;

alter table helper_app.staging_order_previews
  add constraint staging_order_previews_workflow_version_check
  check (workflow_version in ('legacy', 'gacha_v2'));

alter table helper_app.staging_order_previews
  add column if not exists source_gacha_template_id uuid;

alter table helper_app.reviewed_staging_orders
  add column if not exists workflow_version text not null default 'legacy';

alter table helper_app.reviewed_staging_orders
  drop constraint if exists reviewed_staging_orders_workflow_version_check;

alter table helper_app.reviewed_staging_orders
  add constraint reviewed_staging_orders_workflow_version_check
  check (workflow_version in ('legacy', 'gacha_v2'));

alter table helper_app.reviewed_staging_orders
  add column if not exists source_gacha_template_id uuid;

create table if not exists helper_app.purchase_task_results (
  id uuid primary key default gen_random_uuid(),
  purchase_task_id uuid not null references helper_app.purchase_tasks(id) on delete cascade,
  sequence_no integer not null check (sequence_no > 0),
  result_name text not null check (btrim(result_name) <> ''),
  unboxing_status text not null default 'recorded'
    check (unboxing_status in ('pending', 'recorded')),
  result_photo_storage_key text references helper_app.media_objects(storage_key) on delete restrict,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_task_id, sequence_no)
);

create index if not exists purchase_task_results_task_sequence_idx
  on helper_app.purchase_task_results(purchase_task_id, sequence_no);

create table if not exists helper_app.staging_order_preview_items (
  id uuid primary key default gen_random_uuid(),
  staging_order_preview_id uuid not null references helper_app.staging_order_previews(id) on delete cascade,
  purchase_task_result_id uuid not null unique references helper_app.purchase_task_results(id) on delete restrict,
  sequence_no integer not null check (sequence_no > 0),
  result_name text not null check (btrim(result_name) <> ''),
  unboxing_status text not null default 'recorded'
    check (unboxing_status in ('pending', 'recorded')),
  result_photo_storage_key text references helper_app.media_objects(storage_key) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staging_order_preview_id, sequence_no)
);

create index if not exists staging_order_preview_items_preview_sequence_idx
  on helper_app.staging_order_preview_items(staging_order_preview_id, sequence_no);

create table if not exists helper_app.reviewed_staging_order_items (
  id uuid primary key default gen_random_uuid(),
  reviewed_order_id uuid not null references helper_app.reviewed_staging_orders(id) on delete cascade,
  staging_order_preview_item_id uuid references helper_app.staging_order_preview_items(id) on delete set null,
  sequence_no integer not null check (sequence_no > 0),
  result_name text not null check (btrim(result_name) <> ''),
  unboxing_status text not null default 'recorded'
    check (unboxing_status in ('pending', 'recorded')),
  result_photo_storage_key text references helper_app.media_objects(storage_key) on delete restrict,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reviewed_order_id, sequence_no)
);

create index if not exists reviewed_staging_order_items_order_sequence_idx
  on helper_app.reviewed_staging_order_items(reviewed_order_id, sequence_no);

alter table helper_app.purchase_task_results enable row level security;
alter table helper_app.staging_order_preview_items enable row level security;
alter table helper_app.reviewed_staging_order_items enable row level security;

drop policy if exists purchase_task_results_no_direct_reads on helper_app.purchase_task_results;
drop policy if exists purchase_task_results_no_direct_writes on helper_app.purchase_task_results;
drop policy if exists staging_order_preview_items_no_direct_reads on helper_app.staging_order_preview_items;
drop policy if exists staging_order_preview_items_no_direct_writes on helper_app.staging_order_preview_items;
drop policy if exists reviewed_staging_order_items_no_direct_reads on helper_app.reviewed_staging_order_items;
drop policy if exists reviewed_staging_order_items_no_direct_writes on helper_app.reviewed_staging_order_items;
