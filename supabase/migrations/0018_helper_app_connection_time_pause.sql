-- Administrator-controlled connection-time pauses. The trip remains active
-- while a pause is open; only the elapsed/settlement time excludes it.
alter table helper_app.trips
  add column if not exists connection_paused_at timestamptz,
  add column if not exists connection_paused_seconds integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trips_connection_paused_seconds_check'
      and conrelid = 'helper_app.trips'::regclass
  ) then
    alter table helper_app.trips
      add constraint trips_connection_paused_seconds_check
      check (connection_paused_seconds >= 0);
  end if;
end $$;
