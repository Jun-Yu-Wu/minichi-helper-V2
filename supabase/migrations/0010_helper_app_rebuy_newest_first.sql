drop index if exists helper_app.rebuy_tasks_public_open_idx;

create index rebuy_tasks_public_open_idx
  on helper_app.rebuy_tasks(public_available_at desc, created_at desc)
  where visibility = 'public' and status = 'open';
