create table if not exists helper_app.media_objects (
  id uuid primary key default gen_random_uuid(),
  storage_key text not null unique check (btrim(storage_key) <> ''),
  media_kind text not null check (media_kind in ('site_photo')),
  retention_status text not null default 'temporary_work_media'
    check (retention_status in ('temporary_work_media', 'admin_saved', 'task_evidence', 'order_evidence', 'warehouse_evidence')),
  original_filename text,
  content_type text,
  byte_size integer check (byte_size is null or byte_size >= 0),
  uploaded_by_helper_id uuid references helper_app.helper_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists helper_app.site_photo_batches (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references helper_app.trips(id) on delete cascade,
  helper_id uuid not null references helper_app.helper_profiles(id) on delete restrict,
  submission_id text not null check (btrim(submission_id) <> ''),
  note text,
  status text not null default 'submitted' check (status in ('submitted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, helper_id, submission_id)
);

create table if not exists helper_app.site_photos (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references helper_app.site_photo_batches(id) on delete cascade,
  trip_id uuid not null references helper_app.trips(id) on delete cascade,
  helper_id uuid not null references helper_app.helper_profiles(id) on delete restrict,
  client_photo_id text not null check (btrim(client_photo_id) <> ''),
  storage_key text not null references helper_app.media_objects(storage_key) on delete restrict,
  original_filename text,
  content_type text,
  byte_size integer check (byte_size is null or byte_size >= 0),
  sort_order integer not null check (sort_order >= 0),
  saved_by_admin boolean not null default false,
  saved_at timestamptz,
  saved_by_user_id uuid,
  created_at timestamptz not null default now(),
  unique (batch_id, client_photo_id),
  unique (batch_id, sort_order)
);

create index if not exists media_objects_uploaded_helper_created_idx
  on helper_app.media_objects(uploaded_by_helper_id, created_at desc);

create index if not exists site_photo_batches_trip_created_idx
  on helper_app.site_photo_batches(trip_id, created_at desc);

create index if not exists site_photos_batch_order_idx
  on helper_app.site_photos(batch_id, sort_order asc);

create index if not exists site_photos_trip_created_idx
  on helper_app.site_photos(trip_id, created_at desc);

alter table helper_app.media_objects enable row level security;
alter table helper_app.site_photo_batches enable row level security;
alter table helper_app.site_photos enable row level security;

drop policy if exists media_objects_select_active_owner on helper_app.media_objects;
create policy media_objects_select_active_owner
  on helper_app.media_objects
  for select
  to authenticated
  using (
    exists (
      select 1
      from helper_app.helper_profiles hp
      where hp.id = media_objects.uploaded_by_helper_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists site_photo_batches_select_active_assigned_helper on helper_app.site_photo_batches;
create policy site_photo_batches_select_active_assigned_helper
  on helper_app.site_photo_batches
  for select
  to authenticated
  using (
    exists (
      select 1
      from helper_app.trips t
      join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
      where t.id = site_photo_batches.trip_id
        and hp.id = site_photo_batches.helper_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists site_photos_select_active_assigned_helper on helper_app.site_photos;
create policy site_photos_select_active_assigned_helper
  on helper_app.site_photos
  for select
  to authenticated
  using (
    exists (
      select 1
      from helper_app.trips t
      join helper_app.helper_profiles hp on hp.id = t.assigned_helper_id
      where t.id = site_photos.trip_id
        and hp.id = site_photos.helper_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists media_objects_no_direct_writes on helper_app.media_objects;
drop policy if exists site_photo_batches_no_direct_writes on helper_app.site_photo_batches;
drop policy if exists site_photos_no_direct_writes on helper_app.site_photos;
