# Acceptance Tests From Current Behavior

This document converts approved current behavior into tests for the Next.js Supabase/R2 helper rewrite.

References:

- `docs/helper-system.md`
- `docs/data-boundary-and-merge.md`
- `docs/database-plan.md`
- `tests/api/auth-permissions.test.js`
- `tests/api/trip-flow.test.js`
- `tests/api/site-photos.test.js`
- `tests/api/quote-tasks.test.js`
- `tests/api/purchase-tasks.test.js`
- `tests/api/face-check.test.js`
- `tests/api/unavailable-rebuy.test.js`
- `tests/api/settlement.test.js`
- `tests/api/staging-orders.test.js`
- `tests/api/photo-metadata.test.js`
- `tests/api/merge-flow.test.js`
- `minichi_helper_system/docs/rewrite/cross-region-mobile-runtime.md`

## Test Principles

- Tests must use isolated Supabase data and isolated R2 key prefixes.
- Tests must not mutate or depend on `data/db.json`.
- Tests must not write to `public/uploads/`.
- Helper credentials must never be able to write `main.orders`.
- Use exact current behavior as the baseline unless a question is explicitly resolved by the product owner.
- Prefer vertical-slice tests that cover UI action, server mutation, Supabase rows, R2 metadata, and readback.
- Mobile reliability tests must cover pending states, retry, idempotency, and lost-response recovery.

## Business Rule Tests

### Helper isolation

- Helper can read only own profile.
- Helper sees only assigned trips.
- Helper sees only own settlements.
- Helper sees own private rebuy tasks and public rebuy tasks.
- Helper cannot see another helper's private rebuy task.
- Helper cannot mutate another helper's trip/task/settlement.
- Helper cannot call admin-only review, merge, helper-profile, or payment actions.

### Staging/main boundary

- Helper purchase completion writes staging rows only.
- Helper actions never insert, update, or delete `main.orders`.
- Helper actions never insert canonical helper provenance directly into `main.order_source_links`.
- Admin approved merge is required before helper-generated data appears in `main.orders`.
- Excel/admin-created main orders do not require helper task, trip, staging, or merge identifiers.

### Purchase eligibility

- Completed purchase task creates or updates one staging order.
- Completed partial purchase uses `completedQuantity`, not requested quantity.
- Open purchase task does not create staging order.
- Review-pending purchase task does not create staging order.
- Not-found purchase task does not create staging order.
- Canceled purchase task does not create staging order.
- Unavailable quantity does not create staging quantity.
- Re-completing/updating an eligible task is idempotent and does not duplicate staging orders.

### Face-check gate

- Face-check-required helper response stores review photo metadata and moves task to `review_pending`.
- `review_pending` face-check task has no staging order.
- Admin rejection/request-retake keeps or returns the task to a helper-action-needed state and creates no staging order.
- Admin approval moves task to `completed`.
- Admin approval creates/updates the staging order.
- Approval records helper report photo metadata.

### Quote provenance

- Quote/detail task with multiple photos tracks each photo response independently.
- Completing only some photos keeps task open.
- Completing all required photo responses marks task completed.
- Admin appending a new photo reopens or keeps the task open until the new photo is answered.
- Publishing a quote photo into purchase preserves source quote task id.
- Publishing a quote photo into purchase preserves source quote photo id.
- Purchase reference photos include the selected quote source photo and matching detail photo when available.
- Final helper provenance is written to `main.order_source_links` only during approved merge.

### R2 media

- Site photo, quote/detail reply, purchase report, face-check, rebuy report, receipt, claim proof, and warehouse proof records store durable `storage_key`.
- No staging or main photo record stores a signed URL as canonical data.
- Signed URLs expire and can be regenerated from `storage_key`.
- Approved merge copies or retains final media using durable R2 keys and records `main.order_photos.storage_key`.
- R2 cleanup in tests removes only isolated test prefixes.
- Failed photo upload can be retried without losing the local preview/draft.
- Metadata commit retry after successful R2 upload does not duplicate photo rows.

### Idempotency and retry

- Every high-frequency helper write accepts a client-generated `submission_id`.
- Exact retry after success returns the original successful result.
- Retry while a submission is processing returns pending/processing state.
- Same `submission_id` with a different payload returns conflict.
- Duplicate purchase response submit does not create duplicate staging orders.
- Duplicate face-check response submit does not create duplicate review rows or staging orders.
- Duplicate admin face-check approval does not create duplicate staging orders.
- Duplicate site-photo metadata commit does not create duplicate photo rows.

### Rebuy

- Private rebuy can be reported only by assigned helper.
- Public rebuy can be reported by the first successful helper claim.
- Concurrent public rebuy claims leave exactly one claimed helper.
- Losing public claim receives conflict and does not overwrite owner.
- Rebuy report does not create staging order immediately.
- Rebuy checkout creates checkout trip/tasks/settlement according to current behavior.
- Rebuy checkout carries `sourceRebuyTaskId` and source purchase provenance.

### Settlement

- Ended trip can produce a pending helper precheck settlement.
- Helper precheck updates bank fields, notes, transport claims, receipts, and payment-method fields.
- Hourly/card mode requires card amount.
- Hourly/cash mode requires cash FX rate.
- Helper precheck moves settlement to admin review.
- Helper correction report before completion stores text/photos.
- Admin rejection returns settlement to helper precheck.
- Admin approval moves settlement to helper final confirmation.
- Helper final confirmation moves settlement to payment pending.
- Warehouse proof upload is allowed only in the approved current statuses.
- Warehouse proof metadata links to staging order photos when applicable.

## Integration Tests

### Login/dashboard

- Given two active helpers and trips, helper A logs in and dashboard shows only helper A profile, trips, settlement count, rebuy count, and warehouse state.
- Dashboard read does not include all customer records, all orders, merge jobs, or other helpers' private data.
- Dashboard opens within the cross-region target after cache/server render under Taiwan/Japan test conditions.

### Trip status

- Helper marks departure: trip becomes `departing`, event is recorded.
- Helper marks arrival: trip becomes `arrived_waiting_admin`, event is recorded.
- Helper cannot self-confirm active live connection.
- Admin confirms: trip becomes `active`.
- Helper ends active trip: trip becomes `ended`, merge/settlement preparation follows approved behavior.
- Duplicate tap on departure/arrival/end with the same `submission_id` returns the same final state and does not duplicate timeline events.
- Trip timestamps are stored in UTC.
- Trip business date/time renders in the trip timezone, usually `Asia/Tokyo`.

### Site photos

- Helper creates a photo batch with blank title; fallback title is generated.
- Helper uploads multiple photos through R2 presign and metadata commit.
- Helper sees submitted batch with photo count and signed display URLs.
- Admin saves selected photos; only selected photos receive saved metadata.
- Helper sees saved status when all photos in a batch are saved.
- Local preview appears before R2 upload completes.
- Simulated upload failure shows retryable failure state.
- Retried upload/metadata commit does not duplicate the photo row.

### Quote/detail

- Admin creates `price`, `detail_photo`, and `both` tasks.
- Helper price reply validates positive JPY price.
- Helper detail reply validates a photo when required.
- Combined task requires both price and detail photo.
- Multi-photo task shows progress and completes only when all photos satisfy requirements.
- Completed quote task remains editable by helper/admin.

### Purchase

- Admin creates purchase with nickname, product, quantity, JPY, TWD, notes, and reference photos.
- Helper completes a purchase with completed quantity, note, and report photo.
- Staging order has expected customer nickname, product, quantity, prices, trip id, helper id, and source purchase task id.
- Grouped response completes all grouped eligible tasks and creates matching staging orders.
- Helper cannot complete canceled, unavailable, or already ineligible tasks.
- Duplicate purchase submit with the same `submission_id` returns the original result and creates exactly one staging order.
- Lost server response followed by retry returns confirmed state without duplicate staging order.

### Unavailable/not found

- Helper marks an open purchase unavailable with reason.
- Task becomes unavailable/not-found/canceled according to approved state naming.
- No staging order exists for that task.
- Admin can route unavailable task to private rebuy.
- Admin can route unavailable task to public rebuy.

### Face-check

- Admin creates face-check-required purchase.
- Helper submits review photo and quantity.
- Task is `review_pending`; no staging order exists.
- Admin rejects; helper can submit a replacement.
- Admin approves; task completes and staging order is created.
- Duplicate helper face-check submit creates one review-pending state and no staging order.
- Duplicate admin approval creates exactly one staging order.

### Rebuy

- Admin creates private and public rebuy tasks.
- Helper sees public plus assigned private tasks.
- Helper does not see another helper's private task.
- Helper reports private task.
- Two helpers race to report the same public task; exactly one wins.
- Reported rebuy appears as checkout-needed.
- Helper checkout creates checkout trip, completed derived purchase task, staging order, merge job, and settlement.

### Settlement

- Completed trip with eligible purchases generates settlement.
- Helper submits precheck with bank data, transport claims, receipts, and payment method.
- Admin reviews and approves/rejects transport claims.
- Helper confirms final detail.
- Admin payment completes small settlement.
- Large/deposit settlement requires warehouse proof before final payment.

### Merge boundary

- Admin edits staging order fields.
- Admin deletes a staging order before merge.
- Admin approves merge job.
- Merge writes `main.orders`, `main.order_source_links`, and `main.order_photos`.
- Merge excludes deleted/ineligible staging orders.
- Merge is idempotent on retry.
- Helper credentials cannot invoke merge.

## Manual And Mobile Acceptance Checks

### Role-perspective UI review

- Every new or materially changed helper screen is reviewed from the helper's
  point of view during an active mobile live-shopping trip.
- Every new or materially changed admin screen is reviewed from the admin's
  point of view while coordinating helpers and reviewing returned work.
- Helper screens make the next action, current status, pending state, retry
  option, and blocked/end/cancel reason clear without backend terminology.
- Helper screens do not expose admin-only decisions, other helpers' private
  data, merge controls, or final operational orders.
- Admin screens make current trip/helper/task context, pending reviews, and
  available admin actions scannable before the admin acts.
- Admin screens separate live monitoring, task publishing, review decisions,
  settlement/payment actions, and final merge actions so destructive or final
  actions are not accidentally triggered from an ambiguous context.
- The UI does not need to be visually refined, but it must be usable and
  reasonable for the role's actual workflow.

### Mobile helper flow

- Helper logs in on phone.
- Dashboard is readable and tap targets are usable.
- Trip card opens reliably.
- Departure/arrival/active state updates are visible without confusing refresh behavior.
- Three work blocks are reachable and return navigation is clear.
- Camera capture works for site photos, detail photos, purchase report photos, rebuy photos, receipts, and warehouse proof.
- Multi-select from album works for site photo batches.
- Upload progress and failure/retry state are understandable.
- Purchase submit immediately shows pending state and remains retryable if the network drops.
- Face-check submit immediately shows pending state and remains retryable if the network drops.
- Other UI remains usable while photo upload is in progress.
- Long product/customer names and emoji nicknames render without layout overlap.

### Admin/helper live coordination

- Admin-created quote task appears for helper promptly.
- Helper reply appears for admin promptly.
- Admin-published purchase appears for helper promptly.
- Helper purchase completion appears for admin and staging review promptly.
- Admin face-check decision changes helper task state promptly.
- Admin route-to-rebuy changes helper rebuy list promptly.

### User-facing flow preservation

- Helper starts from dashboard, not directly in trip workspace.
- Trips page grouping remains today/upcoming/history.
- Active trip still has status and work/reporting views.
- Site photo upload still supports batch title/note and batch review.
- Quote task detail still progresses photo by photo.
- Completed quote tasks remain editable.
- Purchase cards still show status clearly.
- Unavailable/not-found remains a helper action from purchase detail.
- Rebuy list keeps public and private sections.
- Settlement list keeps pending and completed sections.
- Warehouse report shortcut opens only when relevant.
- General issue report supports text and multiple photos.

## Performance Acceptance

- Dashboard opens under 1-2s after cache/server render on warm cross-region path.
- Trip workspace opens under 1-2s after cache/server render on warm cross-region path.
- Trip status update p95 <= 800 ms.
- Quote/detail reply p95 <= 1200 ms excluding media transfer.
- Purchase submit shows immediate pending state; server confirmation is ideally under 2s excluding media transfer.
- Face-check approval p95 <= 1800 ms.
- Face-check submit shows immediate pending state; server confirmation is ideally under 2s excluding media transfer.
- Admin approval is preferred under 3s, with correctness prioritized over speed.
- Rebuy report p95 <= 1500 ms.
- Settlement precheck p95 <= 2500 ms excluding media transfer.
- No helper mutation performs a whole-app read/write or hydrates unrelated workflow groups.

## Recommended Test Build Order

1. Helper auth and visibility tests.
2. Trip status vertical-slice tests.
3. R2 presign and site photo metadata tests.
4. Idempotency/retry contract tests for helper submissions.
5. Quote/detail per-photo tests.
6. Purchase response and staging-order eligibility tests.
7. Face-check gate tests.
8. Not-found/unavailable plus rebuy route tests.
9. Public rebuy atomic claim tests.
10. Settlement precheck and warehouse proof tests.
11. Admin staging review and approved merge boundary tests.
12. Cross-region mobile/manual acceptance pass against the assembled slices.
