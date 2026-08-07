-- Preserve the gacha/blind-box distinction and the reusable series-photo
-- boundary in helper staging.  Existing purchase data remains standard
-- product data unless an administrator explicitly publishes it as gacha or a
-- blind box.

alter table helper_app.purchase_tasks
  add column if not exists product_type text not null default 'standard';

alter table helper_app.purchase_tasks
  drop constraint if exists purchase_tasks_product_type_check;

alter table helper_app.purchase_tasks
  add constraint purchase_tasks_product_type_check
  check (product_type in ('standard', 'gacha', 'blind_box'));

alter table helper_app.purchase_batches
  add column if not exists product_type text not null default 'standard';

alter table helper_app.purchase_batches
  drop constraint if exists purchase_batches_product_type_check;

alter table helper_app.purchase_batches
  add constraint purchase_batches_product_type_check
  check (product_type in ('standard', 'gacha', 'blind_box'));

alter table helper_app.staging_order_previews
  add column if not exists product_type text not null default 'standard';

alter table helper_app.staging_order_previews
  drop constraint if exists staging_order_previews_product_type_check;

alter table helper_app.staging_order_previews
  add constraint staging_order_previews_product_type_check
  check (product_type in ('standard', 'gacha', 'blind_box'));

alter table helper_app.reviewed_staging_orders
  add column if not exists product_type text not null default 'standard';

alter table helper_app.reviewed_staging_orders
  drop constraint if exists reviewed_staging_orders_product_type_check;

alter table helper_app.reviewed_staging_orders
  add constraint reviewed_staging_orders_product_type_check
  check (product_type in ('standard', 'gacha', 'blind_box'));

alter table helper_app.purchase_task_photos
  drop constraint if exists purchase_task_photos_photo_role_check;

alter table helper_app.purchase_task_photos
  add constraint purchase_task_photos_photo_role_check
  check (photo_role in (
    'source',
    'series_reference',
    'detail_reply',
    'manual_reference',
    'face_check_report',
    'purchase_report'
  ));

create index if not exists purchase_tasks_trip_product_type_created_idx
  on helper_app.purchase_tasks(trip_id, product_type, created_at desc);

create index if not exists purchase_batches_trip_product_type_status_idx
  on helper_app.purchase_batches(trip_id, product_type, status, created_at desc);
