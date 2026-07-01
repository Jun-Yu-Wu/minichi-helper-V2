alter table helper_app.trip_audit_events
  alter column trip_id drop not null;

create index if not exists trip_audit_events_action_created_idx
  on helper_app.trip_audit_events(action, created_at desc)
  where trip_id is null;
