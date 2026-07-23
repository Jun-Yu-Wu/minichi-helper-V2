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
    'rebuy_report_photo',
    'photo_annotation'
  ));

create table if not exists helper_app.media_variants (
  id uuid primary key default gen_random_uuid(),
  source_media_object_id uuid not null references helper_app.media_objects(id) on delete restrict,
  source_storage_key text not null references helper_app.media_objects(storage_key) on delete restrict,
  storage_key text not null unique references helper_app.media_objects(storage_key) on delete restrict,
  variant_type text not null default 'annotation' check (variant_type = 'annotation'),
  annotation_manifest jsonb not null default '{}'::jsonb,
  original_filename text,
  content_type text not null,
  byte_size integer check (byte_size is null or byte_size >= 0),
  created_by_user_id uuid not null,
  created_by_helper_id uuid references helper_app.helper_profiles(id) on delete set null,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  created_at timestamptz not null default now(),
  unique (created_by_user_id, idempotency_key)
);

create index if not exists media_variants_source_created_idx
  on helper_app.media_variants(source_storage_key, created_at desc);

create index if not exists media_variants_creator_created_idx
  on helper_app.media_variants(created_by_user_id, created_at desc);

create table if not exists helper_app.media_variant_audit_events (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references helper_app.media_variants(id) on delete cascade,
  actor_user_id uuid not null,
  actor_role text not null check (actor_role in ('admin', 'helper')),
  action text not null check (action in ('photo_annotation_saved')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists media_variant_audit_events_variant_created_idx
  on helper_app.media_variant_audit_events(variant_id, created_at desc);

alter table helper_app.media_variants enable row level security;
alter table helper_app.media_variant_audit_events enable row level security;

drop policy if exists media_variants_no_direct_reads on helper_app.media_variants;
create policy media_variants_no_direct_reads
  on helper_app.media_variants for select to authenticated
  using (false);

drop policy if exists media_variants_no_direct_writes on helper_app.media_variants;
create policy media_variants_no_direct_writes
  on helper_app.media_variants for all to authenticated
  using (false)
  with check (false);

drop policy if exists media_variant_audit_events_no_direct_reads on helper_app.media_variant_audit_events;
create policy media_variant_audit_events_no_direct_reads
  on helper_app.media_variant_audit_events for select to authenticated
  using (false);

drop policy if exists media_variant_audit_events_no_direct_writes on helper_app.media_variant_audit_events;
create policy media_variant_audit_events_no_direct_writes
  on helper_app.media_variant_audit_events for all to authenticated
  using (false)
  with check (false);
