create table if not exists helper_app.purchase_batches (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references helper_app.trips(id) on delete cascade,
  helper_id uuid not null references helper_app.helper_profiles(id) on delete restrict,
  group_key text not null check (btrim(group_key) <> ''),
  product_name text not null check (btrim(product_name) <> ''),
  original_price_jpy integer check (original_price_jpy is null or original_price_jpy >= 0),
  requires_face_check boolean not null default false,
  sequence integer not null check (sequence >= 0),
  status text not null default 'open' check (status in ('open', 'completed', 'canceled')),
  reported_quantity integer not null default 0 check (reported_quantity >= 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (trip_id, group_key, sequence)
);

alter table helper_app.purchase_tasks
  add column if not exists purchase_batch_id uuid references helper_app.purchase_batches(id) on delete set null;

create unique index if not exists purchase_batches_open_group_idx
  on helper_app.purchase_batches(trip_id, group_key)
  where status = 'open';

create index if not exists purchase_batches_trip_status_idx
  on helper_app.purchase_batches(trip_id, status, created_at desc);

create index if not exists purchase_batches_helper_status_idx
  on helper_app.purchase_batches(helper_id, status, created_at desc);

create index if not exists purchase_tasks_batch_created_idx
  on helper_app.purchase_tasks(purchase_batch_id, created_at asc);

alter table helper_app.purchase_batches enable row level security;

drop policy if exists purchase_batches_select_active_assigned_helper on helper_app.purchase_batches;
create policy purchase_batches_select_active_assigned_helper
  on helper_app.purchase_batches
  for select
  to authenticated
  using (
    exists (
      select 1
      from helper_app.trips t
      join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
      where t.id = purchase_batches.trip_id
        and hp.id = purchase_batches.helper_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists purchase_batches_no_direct_writes on helper_app.purchase_batches;
