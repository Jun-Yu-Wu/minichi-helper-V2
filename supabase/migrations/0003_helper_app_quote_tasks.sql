alter table helper_app.media_objects
  drop constraint if exists media_objects_media_kind_check;

alter table helper_app.media_objects
  add constraint media_objects_media_kind_check
  check (media_kind in ('site_photo', 'quote_task_photo', 'quote_detail_reply_photo'));

create table if not exists helper_app.quote_tasks (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references helper_app.trips(id) on delete cascade,
  helper_id uuid not null references helper_app.helper_profiles(id) on delete restrict,
  task_type text not null check (task_type in ('quote', 'detail', 'quote_and_detail')),
  product_name text,
  instruction text,
  status text not null default 'open' check (status in ('open', 'completed', 'needs_review', 'canceled')),
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists helper_app.quote_task_photos (
  id uuid primary key default gen_random_uuid(),
  quote_task_id uuid not null references helper_app.quote_tasks(id) on delete cascade,
  trip_id uuid not null references helper_app.trips(id) on delete cascade,
  helper_id uuid not null references helper_app.helper_profiles(id) on delete restrict,
  source_site_photo_id uuid references helper_app.site_photos(id) on delete set null,
  storage_key text not null references helper_app.media_objects(storage_key) on delete restrict,
  product_name text,
  instruction text,
  sort_order integer not null check (sort_order >= 0),
  reply_status text not null default 'open' check (reply_status in ('open', 'replied', 'needs_review', 'converted_to_purchase')),
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_task_id, sort_order),
  unique (quote_task_id, source_site_photo_id)
);

create table if not exists helper_app.quote_photo_replies (
  id uuid primary key default gen_random_uuid(),
  quote_task_photo_id uuid not null references helper_app.quote_task_photos(id) on delete cascade,
  quote_task_id uuid not null references helper_app.quote_tasks(id) on delete cascade,
  trip_id uuid not null references helper_app.trips(id) on delete cascade,
  helper_id uuid not null references helper_app.helper_profiles(id) on delete restrict,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  price_jpy integer check (price_jpy is null or price_jpy >= 0),
  note text,
  detail_photos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_task_photo_id, helper_id, idempotency_key)
);

create index if not exists quote_tasks_trip_created_idx
  on helper_app.quote_tasks(trip_id, created_at desc);

create index if not exists quote_tasks_helper_status_idx
  on helper_app.quote_tasks(helper_id, status, created_at desc);

create index if not exists quote_task_photos_task_order_idx
  on helper_app.quote_task_photos(quote_task_id, sort_order asc);

create index if not exists quote_photo_replies_photo_updated_idx
  on helper_app.quote_photo_replies(quote_task_photo_id, updated_at desc);

alter table helper_app.quote_tasks enable row level security;
alter table helper_app.quote_task_photos enable row level security;
alter table helper_app.quote_photo_replies enable row level security;

drop policy if exists quote_tasks_select_active_assigned_helper on helper_app.quote_tasks;
create policy quote_tasks_select_active_assigned_helper
  on helper_app.quote_tasks
  for select
  to authenticated
  using (
    exists (
      select 1
      from helper_app.trips t
      join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
      where t.id = quote_tasks.trip_id
        and hp.id = quote_tasks.helper_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists quote_task_photos_select_active_assigned_helper on helper_app.quote_task_photos;
create policy quote_task_photos_select_active_assigned_helper
  on helper_app.quote_task_photos
  for select
  to authenticated
  using (
    exists (
      select 1
      from helper_app.trips t
      join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
      where t.id = quote_task_photos.trip_id
        and hp.id = quote_task_photos.helper_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists quote_photo_replies_select_active_assigned_helper on helper_app.quote_photo_replies;
create policy quote_photo_replies_select_active_assigned_helper
  on helper_app.quote_photo_replies
  for select
  to authenticated
  using (
    exists (
      select 1
      from helper_app.trips t
      join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
      where t.id = quote_photo_replies.trip_id
        and hp.id = quote_photo_replies.helper_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists quote_tasks_no_direct_writes on helper_app.quote_tasks;
drop policy if exists quote_task_photos_no_direct_writes on helper_app.quote_task_photos;
drop policy if exists quote_photo_replies_no_direct_writes on helper_app.quote_photo_replies;
