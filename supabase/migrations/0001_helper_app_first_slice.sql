create schema if not exists helper_app;

create extension if not exists pgcrypto;

create table if not exists helper_app.helper_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null check (btrim(display_name) <> ''),
  email text not null check (btrim(email) <> ''),
  compensation_mode text not null check (compensation_mode in ('hourly', 'fx_rate')),
  hourly_rate_twd integer check (hourly_rate_twd is null or hourly_rate_twd >= 0),
  helper_fx_rate numeric check (helper_fx_rate is null or helper_fx_rate > 0),
  bank_account_name text,
  bank_code text,
  bank_account_number text,
  region text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists helper_app.trips (
  id uuid primary key default gen_random_uuid(),
  trip_name text not null check (btrim(trip_name) <> ''),
  business_date date not null,
  scheduled_time time,
  location text,
  timezone text not null default 'Asia/Tokyo',
  assigned_helper_id uuid references helper_app.helper_profiles(id) on delete set null,
  status text not null check (status in ('draft', 'scheduled', 'departed', 'arrived', 'active', 'ended', 'canceled')),
  departed_at timestamptz,
  arrived_at timestamptz,
  admin_activated_at timestamptz,
  ended_at timestamptz,
  canceled_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists helper_app.trip_audit_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references helper_app.trips(id) on delete cascade,
  actor_user_id uuid,
  actor_helper_id uuid references helper_app.helper_profiles(id) on delete set null,
  actor_role text not null check (actor_role in ('admin', 'helper', 'system')),
  action text not null check (btrim(action) <> ''),
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists helper_profiles_auth_user_idx
  on helper_app.helper_profiles(auth_user_id);

create index if not exists trips_assigned_helper_date_idx
  on helper_app.trips(assigned_helper_id, business_date desc);

create index if not exists trip_audit_events_trip_created_idx
  on helper_app.trip_audit_events(trip_id, created_at desc);

alter table helper_app.helper_profiles enable row level security;
alter table helper_app.trips enable row level security;
alter table helper_app.trip_audit_events enable row level security;

drop policy if exists helper_profiles_select_own on helper_app.helper_profiles;
create policy helper_profiles_select_own
  on helper_app.helper_profiles
  for select
  to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists trips_select_active_assigned_helper on helper_app.trips;
create policy trips_select_active_assigned_helper
  on helper_app.trips
  for select
  to authenticated
  using (
    exists (
      select 1
      from helper_app.helper_profiles hp
      where hp.id = trips.assigned_helper_id
        and hp.auth_user_id = auth.uid()
        and hp.is_active = true
    )
  );

drop policy if exists helper_profiles_no_direct_writes on helper_app.helper_profiles;
drop policy if exists trips_no_direct_writes on helper_app.trips;
drop policy if exists trip_audit_events_no_direct_writes on helper_app.trip_audit_events;
