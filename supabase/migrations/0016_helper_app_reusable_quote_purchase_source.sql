-- A single helper quote can satisfy multiple customer purchase requests.
-- Keep the quote photo as the shared source/provenance record and allow each
-- customer to receive an independent purchase task.
alter table helper_app.purchase_tasks
  drop constraint if exists purchase_tasks_source_quote_task_photo_id_key;

create index if not exists purchase_tasks_source_quote_task_photo_idx
  on helper_app.purchase_tasks(source_quote_task_photo_id);
