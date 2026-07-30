-- Ensure databases that were deployed before 0014 accept helper purchase
-- report photos without removing the annotation media kind added in 0012.
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
    'purchase_report_photo',
    'settlement_receipt',
    'transport_proof',
    'warehouse_evidence',
    'rebuy_reference_photo',
    'rebuy_report_photo',
    'photo_annotation'
  ));

alter table helper_app.purchase_task_photos
  drop constraint if exists purchase_task_photos_photo_role_check;

alter table helper_app.purchase_task_photos
  add constraint purchase_task_photos_photo_role_check
  check (photo_role in (
    'source',
    'detail_reply',
    'manual_reference',
    'face_check_report',
    'purchase_report'
  ));
