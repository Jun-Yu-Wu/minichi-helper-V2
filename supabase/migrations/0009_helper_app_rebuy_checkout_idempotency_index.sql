drop index if exists helper_app.rebuy_tasks_checkout_idempotency_idx;

create index if not exists rebuy_tasks_checkout_idempotency_idx
  on helper_app.rebuy_tasks(coalesce(claimed_helper_id, assigned_helper_id), checkout_idempotency_key)
  where checkout_idempotency_key is not null;
