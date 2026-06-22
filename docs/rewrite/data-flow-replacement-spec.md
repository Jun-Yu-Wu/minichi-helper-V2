# Data Flow Replacement Spec

This document maps approved current flows from legacy likely data paths to proposed scoped Supabase/R2 paths for the Next.js helper rewrite.

References:

- `docs/helper-system.md`
- `docs/data-boundary-and-merge.md`
- `docs/database-plan.md`
- `public/app.js`
- `server.js`
- `lib/workflows/purchase-service.js`
- `lib/workflows/staging-review-service.js`
- `lib/cloud-face-check.js`
- `minichi_helper_system/docs/rewrite/cross-region-mobile-runtime.md`

## Routing Rules

- Use Server Components for authenticated reads and page assembly.
- Use Server Actions for internal form submissions and state transitions.
- Use Route Handlers for direct R2 upload/download presigning, webhooks, compatibility endpoints, and non-form HTTP clients.
- Keep helper writes in staging/helper tables only.
- Generate signed URLs only at read/presentation time.
- High-frequency helper writes must include client-generated `submission_id` values for idempotency.
- Helper UI must show local pending/success/failure states for mobile submission reliability.
- Store database timestamps in UTC and render trip business times using the trip timezone.

Table names below are conceptual and should be aligned with the actual Supabase migrations before implementation.

## Helper Login And Dashboard

### Current likely legacy path

- `POST /api/auth` validates a helper access key against helper profiles loaded through `readDb()`.
- `GET /api/app-state`, `/api/helper-profile/me`, `/api/settlements`, and `/api/trip` hydrate broad state into `public/app.js`.
- Frontend global state derives today trips, counts, rebuy counts, and settlement widgets.

### Proposed path

- Server-side auth resolves a helper identity/session.
- Server Component loads a scoped dashboard read model:
  - helper profile fields needed for greeting/region.
  - assigned trips summary.
  - today trip cards and pending-work counts.
  - settlement widget counts.
  - rebuy widget counts.
  - warehouse-proof availability.
- No `main.orders` exposure.
- Customer nickname data is not loaded on the helper dashboard.
- Dashboard should use cache/server render paths that normally open within 1-2s for Japan/Taiwan users.
- Trip cards should display business-date grouping based on the trip timezone, usually `Asia/Tokyo`.

### Next.js boundary

- Server Components for dashboard reads.
- Server Action for prototype helper-key login if retained.
- Route Handler only if a mobile/non-form login endpoint is required.

### Notes/questions

- Dashboard mock metrics need product confirmation before replacing with live metrics.

## Trip Status Updates

### Current likely legacy path

- Helper/admin posts to `/api/trip/status`.
- Route loads full db, selects requested trip, mutates `trip.status` and timeline, writes whole db.
- Active-trip compatibility state is maintained.

### Proposed path

- Server Action updates exactly one `staging.trips` row and one timeline/audit row.
- Enforce helper ownership for helper actions.
- Enforce allowed transitions:
  - `idle -> departing`
  - `departing -> arrived_waiting_admin`
  - `arrived_waiting_admin -> active` by admin only
  - `active -> ended` by helper/admin as approved
- Return minimal updated trip status and summary.
- Revalidate the trip workspace and dashboard summary.
- Store timestamps in UTC and preserve `business_timezone` on the trip.
- Admin-facing schedule/status displays should render trip-local time.
- Status mutations should accept `submission_id` so duplicate mobile taps return the same result.

### Next.js boundary

- Server Components for trip status display.
- Server Actions for status transitions.

## Site Photo Upload

### Current likely legacy path

- Helper creates batch through `/api/trip/photo-batches`.
- Each photo posts to `/api/trip/photo-batches/photos`.
- `saveSubmittedPhoto` may handle base64, URL, or storage key; legacy local uploads can persist under `public/uploads/`.
- Batch and trip arrays are mutated and written through whole db.
- Admin saves selected photos through `/api/trip/photo-batches/save`.

### Proposed path

- Route Handler creates short-lived R2 presigned upload URLs for selected files.
- Browser uploads directly to private R2.
- Client shows local previews immediately and keeps upload drafts retryable.
- Server Action creates batch metadata in Supabase:
  - `staging.site_photo_batches`
  - `staging.site_photos`
  - trip event/timeline rows
- Photo records store `storage_key`, original name, content type, size when available, helper id, batch id, trip id, and created time.
- Helper read model receives temporary signed display URLs.
- Admin save action updates selected photo metadata (`saved_by_admin`, `saved_at`) without moving data to `main`.
- Metadata commit uses `submission_id` so retrying after a network drop attaches the same `storage_key` without duplicate photo rows.

### Next.js boundary

- Route Handler for R2 upload presign and signed display/download URLs.
- Server Action for batch creation and photo metadata commit.
- Server Components for uploaded batch lists and admin review lists.

## Quote / Detail Reply

### Current likely legacy path

- Admin creates quote tasks through `/api/trip/quote-tasks`.
- Helper/admin replies through `/api/trip/quote-tasks/respond`.
- Task contains product photos and `photoResponses`; status is recomputed after every reply.
- Whole trip/db is read and written.

### Proposed path

- Quote tasks and task photos are normalized:
  - `staging.quote_tasks`
  - `staging.quote_task_photos`
  - `staging.quote_task_photo_responses`
- Helper opens a task detail Server Component with one task and signed URLs for visible photos.
- Detail photo upload uses R2 presign, then Server Action records `detail_photo_storage_key`.
- Server Action upserts one response row and recomputes task completion based on task type and all photo responses.
- Admin can use the same domain action for response edits, with admin authorization.
- App revalidates only the quote task/list and trip summary.
- Helper submit shows immediate pending state and retries with the same `submission_id`.
- Detail-photo metadata stores `storage_key`; signed URL readback is temporary.

### Next.js boundary

- Server Components for task list/detail reads.
- Server Actions for reply/update.
- Route Handler for R2 presign.

## Purchase Task Respond

### Current likely legacy path

- Admin creates purchase tasks through `/api/trip/purchase-tasks`.
- Helper responds through `/api/trip/purchase-tasks/respond` or grouped response.
- `respondToPurchaseTask` mutates purchase status and may create/update a staging order.
- Whole db is written after task response.

### Proposed path

- Purchase task tables store task fields, reference photos, quote provenance, review state, and helper response fields.
- Helper response Server Action:
  - Validates helper ownership and task status.
  - Uses `submission_id` to deduplicate duplicate taps, retries, and lost responses.
  - Persists uploaded response photo metadata by `storage_key`.
  - Stores helper note and completed quantity.
  - If no face-check is required, marks task `completed`.
  - Creates or updates one staging order idempotently for the completed quantity.
  - Adds order-photo metadata for purchase reference, quote marked/detail, and helper report photos as applicable.
  - Writes trip/order events.
- Grouped response should batch the same rules over the selected tasks in one transaction.
- UI should move to a local pending state immediately; server confirmation should ideally return within 2s.
- Retrying a confirmed submission must return the existing task/staging-order result, not create another staging order.

### Next.js boundary

- Server Components for purchase list/detail reads.
- Server Actions for single and grouped responses.
- Route Handler for R2 presign.

## Not Found / Unavailable

### Current likely legacy path

- Helper posts to `/api/trip/purchase-tasks/not-found`.
- `markPurchaseUnavailable` marks tasks unavailable/not-found or canceled with unavailable kind.
- No staging order should be generated.
- Admin may route the unavailable task to rebuy.

### Proposed path

- Server Action validates helper ownership and open/reviewable status.
- Server Action accepts `submission_id` for retry/double-tap safety.
- Transaction updates purchase task status and unavailable fields:
  - unavailable quantity.
  - reason.
  - `cancel_kind = 'unavailable'` or approved status equivalent.
- Delete or prevent any staging order tied to that source task if the status becomes ineligible.
- Add event row.
- Admin route-to-rebuy creates a rebuy task linked to the source purchase task.

### Next.js boundary

- Server Action for helper unavailable report.
- Server Action for admin route-to-rebuy.
- Server Components for refreshed purchase/rebuy lists.

## Face-Check Submit And Admin Approval

### Current likely legacy path

- Purchase task has `requiresFaceCheck` and review fields.
- Helper purchase response with a review photo moves task to `review_pending`.
- Admin posts `/api/trip/purchase-tasks/review`.
- Approval can use a focused cloud path; fallback still does full db read/write.
- Only approval creates/updates staging order.

### Proposed path

- Helper submit Server Action:
  - Validates helper ownership.
  - Uses `submission_id` to deduplicate duplicate taps, retries, and lost responses.
  - Stores review photo `storage_key`.
  - Sets task `review_pending`.
  - Does not create a staging order.
  - Writes review event.
- Admin approval Server Action:
  - Validates admin authorization.
  - Runs one transaction over the target task and related staging-order rows.
  - Sets review status approved and task `completed`.
  - Creates/updates staging order and order photos idempotently.
  - Writes audit/event rows.
- Admin rejection Server Action:
  - Sets task back to helper-action-needed status.
  - Stores rejection/request note.
  - Does not create staging order.
- Helper submit shows immediate pending state; server confirmation should ideally return within 2s.
- Admin approval should be preferred under 3s, but idempotent correctness is more important than speed.

### Next.js boundary

- Server Components for helper task detail and admin review queue.
- Server Actions for helper submit, admin approve, and admin reject.
- Route Handler for R2 presign.

## Rebuy Report

### Current likely legacy path

- Rebuy tasks live in broad db state.
- Helper posts `/api/rebuy/respond`.
- Private task checks assigned helper.
- Public task uses in-process lock and, in cloud mode, a claim helper.
- Reported task stores completed quantity, helper note, response photo, claimed helper, and commission owner.
- `/api/rebuy/checkout` creates a checkout trip, purchase tasks, merge job, and settlement.

### Proposed path

- Rebuy tables store scope, assigned helper, public claim fields, source purchase task, reference media, and checkout links.
- Rebuy report Server Action:
  - Validates helper identity.
  - Uses `submission_id` for retry/double-tap safety.
  - Private: requires assigned helper.
  - Public: atomic conditional update where `status = 'open'` and claim fields are empty.
  - Stores response photo `storage_key`, completed quantity, note, claimed helper, and commission owner in one transaction.
  - Returns conflict if another helper already claimed the public task.
- Rebuy checkout Server Action:
  - Selects ready reported tasks claimed by this helper.
  - Creates checkout trip, derived completed purchase tasks, staging orders through the same purchase/staging rule, merge job, and settlement.
  - Links `source_rebuy_task_id` and source purchase provenance.

### Next.js boundary

- Server Components for rebuy lists/detail.
- Server Actions for report and checkout.
- Route Handler for R2 presign.

### Question

- Confirm whether checkout-trip creation remains the product path for the rewrite or is a compatibility bridge.

## Settlement Precheck

### Current likely legacy path

- `GET /api/settlement` and `/api/settlements` read broad state and filter for helper.
- Helper posts `/api/settlement/helper-precheck`.
- Route mutates settlement, helper profile bank fields, transport claims, receipts, status, timeline, and recomputed summary.
- Receipt/claim media can be base64/local/URL/storage-key.

### Proposed path

- Settlement read model is scoped to helper id and trip id.
- Server Action for helper precheck:
  - Validates helper ownership and settlement status `pending_helper_precheck`.
  - Uses `submission_id` for retry/double-tap safety.
  - Updates bank fields and helper note.
  - Optionally updates helper profile bank fields.
  - Replaces or versions transport claims and receipts.
  - Stores media by `storage_key`.
  - Validates hourly/card/cash required fields.
  - Recomputes summary server-side from staging purchase/order data.
  - Sets status `pending_admin_review`.
  - Writes timeline event.
- Admin review and helper final confirmation are separate Server Actions.
- Warehouse proof uses R2 presign plus Server Action metadata commit and order-photo metadata linkage.

### Next.js boundary

- Server Components for settlement list/detail.
- Server Actions for precheck, correction report, final confirm, admin review, payment, warehouse proof metadata.
- Route Handler for R2 presign.

## Cross-Flow Data Rules

- No helper action writes `main.orders`.
- Completed eligible purchases create staging orders.
- Not-found, unavailable, canceled, and review-pending tasks do not create staging orders.
- Face-check approval is the gate for eligible face-check purchases.
- R2 database records store `storage_key`, not signed URL.
- Signed URLs are generated lazily for display.
- All helper mutations check helper ownership by server-side identity and trip/task assignment.
- All high-frequency actions update scoped rows only.
- Every business mutation writes a compact event row.
- Every high-frequency helper mutation stores/uses an idempotency record keyed by server-resolved actor, target action, target id, and `submission_id`.
- Duplicate successful retries return the original result.
- Same `submission_id` with a different payload returns a conflict.
- UI states must distinguish uploading, submitting, pending confirmation, confirmed, retryable failure, and blocked failure.
