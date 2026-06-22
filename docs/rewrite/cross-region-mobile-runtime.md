# Cross-Region Mobile Runtime

Helpers usually operate in Japan on mobile networks while admins coordinate from Taiwan. The helper rewrite must optimize for reliable submissions across cross-region latency, intermittent connectivity, and photo upload failures.

This is a runtime requirement, not a workflow redesign. The approved helper/admin behavior remains the acceptance baseline.

## Core Requirements

- All high-frequency helper actions must have clear pending, success, and failure UI states.
- Photo upload must show local preview before upload completes.
- Photo upload must support retry without losing the draft.
- Server writes must be idempotent using client-generated submission ids.
- Purchase response and face-check response must avoid duplicate staging orders.
- Database timestamps must be stored in UTC.
- Trips must have a business timezone, usually `Asia/Tokyo` for Japan live shopping.
- Admin UI should clearly display trip-local time where relevant.
- R2 durable references must be `storage_key` only.
- Signed URLs must be generated only for display and may expire safely.
- Helper system writes staging only and never writes `main.orders`.
- Supabase, Vercel, and R2 deployment regions should be chosen for Taiwan/Japan usage.

## Pending-State Contract

Every helper mutation should move through explicit local states:

- `draft`: form/photo data exists only on the client.
- `uploading`: file transfer to R2 is in progress.
- `upload_failed`: file transfer failed and can be retried.
- `submitting`: metadata/business write is in progress.
- `pending_confirmation`: client sent the request, but the confirmation has not returned or the network was interrupted.
- `confirmed`: server returned success and the read model reflects it.
- `failed_retryable`: server or network failure that can be retried with the same submission id.
- `failed_blocked`: validation, permission, conflict, or state-machine failure that needs user/admin action.

The UI should never require a helper to reselect photos after a retryable upload or metadata failure unless the browser itself has discarded the file handle.

## Idempotency Contract

All high-frequency helper writes must include a client-generated `submission_id`.

Minimum fields:

- `submission_id`: UUID generated before the first submit attempt.
- `client_created_at`: client timestamp for debugging only.
- `actor_helper_id`: resolved server-side, not trusted from the client.
- `target_type`: action domain, such as `purchase_response`, `face_check_response`, or `site_photo_metadata`.
- `target_id`: task, batch, settlement, or rebuy id.
- `payload_hash`: stable server-computed hash of the accepted business payload.
- `status`: processing state for the idempotency record.

Server behavior:

- First request with a new `submission_id` creates an idempotency record and processes the write.
- Exact retry after success returns the original successful result.
- Retry while processing returns the current pending/processing state.
- Retry with the same `submission_id` but different payload fails with a conflict.
- Idempotency records should be scoped by helper/session and target action to prevent cross-user reuse.
- Idempotency records need a retention window long enough for mobile retries; start with at least 24 hours.

## Photo Upload Contract

Use direct-to-R2 upload for first-line media handling:

1. Client selects/captures photos and immediately shows local previews.
2. Client requests presigned upload targets from a Route Handler.
3. Client uploads files directly to private R2 with progress UI.
4. Client retries failed uploads without losing the local preview/draft.
5. Server Action commits photo metadata with `storage_key`, not signed URL.
6. Server read model generates signed display URLs when rendering.

Photo metadata commit should be idempotent. If the R2 upload succeeded but the metadata write failed or the network dropped, retrying the same submission must attach the existing `storage_key` without duplicating rows.

## Purchase And Face-Check Idempotency

Purchase response:

- The response action must be idempotent by `submission_id`.
- Staging order generation must also be idempotent by source purchase task id.
- Retrying a completed purchase response must not create a duplicate staging order or duplicate order photos.
- If completed quantity changes after a confirmed response, use an explicit edit/update action with its own submission id and audit event.

Face-check response:

- Helper face-check submit must be idempotent by `submission_id`.
- A retry must not create duplicate review photos or duplicate review events.
- Helper face-check submit moves the task to `review_pending` and creates no staging order.
- Admin approval must be idempotent by source purchase task id and review decision id.
- Retried approval must not create a duplicate staging order.

## Time And Timezone Rules

- Store all database timestamps as UTC.
- Store each trip's business timezone, usually `Asia/Tokyo`.
- Business-date grouping for trips should use the trip timezone, not the server timezone.
- Admin UI should show trip-local time for schedule, departure, arrival, active start, trip end, and live-task timing where relevant.
- Admin UI may also show admin-local relative times for coordination, but trip-local time must be clear.
- Audit timestamps remain UTC in the database and can be rendered in the viewer's locale when not business-date-sensitive.

## Latency Targets

Perceived user experience matters more than raw server timing for mobile helper actions.

| Interaction | Target |
| --- | --- |
| Open dashboard | Under 1-2s after cache/server render. |
| Open active trip | Under 1-2s after cache/server render. |
| Purchase task submit | Immediate local pending state; server confirmation ideally under 2s. |
| Photo preview | Immediate local preview. |
| Photo upload | Progress-based and not blocking other UI. |
| Face-check submit | Immediate local pending state; server confirmation ideally under 2s. |
| Admin approval | Under 3s preferred; correctness is more important than speed. |

## Deployment Region Guidance

Choose infrastructure for Taiwan/Japan usage:

- Prefer Vercel region(s) close to Japan/Taiwan for Server Components, Server Actions, and Route Handlers.
- Prefer a Supabase region with low latency from the selected Vercel runtime and acceptable latency from both Taiwan admins and Japan helpers.
- Prefer R2 access patterns and custom domains that perform well from Japan mobile networks and Taiwan admin networks.
- Measure from real phones in Japan/Taiwan-like networks before final deployment choices.
- Keep correctness and idempotency independent of region choice; no action should rely on a single low-latency round trip to feel safe.

## Manual Acceptance

Before launch, run mobile checks that simulate:

- Japan helper on cellular network.
- Taiwan admin on office/home network.
- Slow photo upload.
- Interrupted photo upload.
- Metadata submit succeeds but response is lost.
- Duplicate tap on purchase submit.
- Duplicate tap on face-check submit.
- Signed URL expiry while viewing an older task.
- Admin approving a face-check while helper is refreshing or retrying.
