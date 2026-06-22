# Approved Current Behavior

This document records the current helper-system behavior that the Next.js rewrite must preserve. The current UI and operating logic have been manually verified by the product owner, so this is an acceptance baseline, not a redesign brief.

References:

- `docs/project-map.md`
- `docs/helper-system.md`
- `docs/data-boundary-and-merge.md`
- `docs/database-plan.md`
- `public/app.js`
- `server.js`
- Existing API tests under `tests/api/`
- `minichi_helper_system/docs/rewrite/cross-region-mobile-runtime.md`

## Scope

Preserve the current helper and admin-facing workflow behavior while replacing the backend/data architecture with scoped Supabase and private R2 paths. The legacy implementation may be used to understand behavior and business rules only. Do not copy its local JSON runtime, whole-app read/write model, catch-all API shape, or global frontend state architecture.

## Roles And Visibility

### Helper

Helpers log in with a helper access key and see only:

- Their own helper profile.
- Trips assigned to them.
- Their own settlement records.
- Their own private rebuy tasks.
- Public rebuy tasks.
- Issue/report flows available to them.

Helpers must not see or directly write `main.orders`, global customer/order data, other helpers' private data, merge controls, or main finance data.

### Admin

Admins coordinate helper work and review output:

- Create/update trips and assign helpers.
- Manage helper profiles and compensation settings.
- Confirm live connection after helper arrival.
- Review uploaded site photo batches.
- Create quote/detail tasks.
- Publish quote/detail results into purchase tasks.
- Create/cancel/review purchase tasks.
- Route unavailable purchases to private/public rebuy.
- Review face-check submissions.
- Review/edit/delete staging orders and approve/reject merge jobs.
- Generate, review, and pay settlements.

## Helper Screens To Preserve

## Cross-Region Mobile Expectations

The approved behavior must work for helpers in Japan on mobile networks and admins in Taiwan.

Preserve the workflow while adding runtime reliability expectations:

- Helper actions should show clear pending, success, retryable failure, and blocked failure states.
- Photo selection should show immediate local preview before upload completes.
- Photo uploads should be retryable and should not block unrelated UI.
- Purchase and face-check submissions should enter a pending state immediately.
- Retrying a purchase or face-check submission must not create duplicate staging orders.
- Admin views should show trip-local time where it matters for live coordination.

### Login And App Shell

- Role split between admin and helper must remain.
- Helper login must resolve the current helper profile and then enter the helper dashboard.
- Helper bottom navigation currently has Home and Trips.
- Helper polling/live refresh behavior should be replaced with scoped invalidation or revalidation, but the user-facing freshness expectations must remain.

Question:

- Should helper production auth keep the prototype key UX initially, or should the first rewrite slice introduce Supabase Auth for helpers?

### Helper Dashboard

Preserve these dashboard areas:

- Helper greeting with name and region.
- Monthly commission summary area.
- Today status.
- Monthly trip count.
- Today work hours.
- Today trip card with pending-work count.
- Entry points for settlement, rebuy, warehouse report, and issue report.
- Historical trip area.

Current dashboard data contains mock/history-style values in places, including monthly commission, monthly trip count, and some history cards.

Questions:

- Which dashboard summary values must be live in the first rewrite slice?
- Should mocked historical trip cards be removed, hidden, or replaced by real past-trip data during the rewrite?

### Trip List

Preserve:

- Trips grouped into today, upcoming, and historical sections.
- Each trip as an independent card.
- Opening a trip card enters the trip workflow.
- Empty states when no assigned trips exist.

### Trip Status Flow

Preserve statuses:

- `idle`
- `departing`
- `arrived_waiting_admin`
- `active`
- `receipt_required` as compatibility behavior
- `ended`

Preserve flow:

1. Helper opens today's trip.
2. Helper marks departure.
3. Helper marks arrival and requests live start.
4. Admin confirms live connection.
5. Helper sees active workspace.
6. Helper works through site photos, quote/detail tasks, and purchase tasks.
7. Helper ends the trip after confirmation.
8. Settlement begins after trip end.

Preserve active-trip status UI:

- Status dashboard and live timer.
- Next-action copy based on status.
- Summary counts for uploaded photos, quote replies, and purchase completion.
- Pending-work checklist.
- Work/reporting tab with three active work blocks.

Question:

- Is `receipt_required` still required in the new helper UI, or only in migration/admin compatibility data?

## Active Trip Work Blocks

The active trip workspace has three approved work blocks. The order is commonly site photos, quote/detail, then purchase, but the helper may alternate among them during the live session.

### Block 1: Site Photo Upload

Helper behavior to preserve:

- Camera capture.
- Multi-select from phone album.
- Batch title and note fields.
- Automatic fallback title such as `{location} 大圖 第{n}梯次`.
- Preview selected photos before upload.
- Remove selected photos before upload.
- Upload progress per batch.
- Uploaded batch list.
- Batch detail view with title, timestamp, note, status, and photo grid.
- Batch status distinguishes submitted from admin-saved.

Admin behavior to preserve:

- Admin sees all uploaded batches.
- Admin can open large previews.
- Admin can select one or multiple photos.
- Admin can save selected photos or the whole batch.
- Saved/circled photos can be reused for quote/detail or purchase work.

### Block 2: Quote / Detail Tasks

Task types to preserve:

- Price quote.
- Detail photo.
- Price quote plus detail photo.

Admin creation behavior:

- Admin may provide task type, product name, instruction/title, and product photos.
- Product name and instruction can be optional when a fallback title can be generated.
- At least one product photo is required.
- Multiple product photos can belong to one task.
- Each photo has an independent response state.

Helper behavior:

- List separates open tasks and completed tasks.
- Completed tasks remain editable.
- Task detail screen navigates photo by photo.
- Progress displays completed photo count.
- Helper replies with JPY price, detail photo, or both depending on task type.
- Submit and update actions are visually distinct.
- Existing detail-photo replies can be previewed.

Admin update behavior:

- Admin can change task type, product name, and title/instruction.
- Admin can append more product photos.
- Admin can edit price/detail replies per photo.
- Adding photos can reopen a completed task until all photos are replied.

### Quote To Purchase Publishing

Preserve the rule that a purchase task represents one concrete item/photo, not a whole quote task.

When admin publishes a quote/detail item to purchase, preserve:

- Source quote task id.
- Source quote photo id.
- Original marked/circled photo.
- Matching helper detail photo, when present.
- Matching JPY quote, when present.
- Admin override fields for social nickname, product name, quantity, JPY price, TWD price, and notes.

### Block 3: Purchase Tasks

Admin task fields to preserve:

- Social nickname.
- Product name.
- Quantity.
- Original JPY price.
- TWD selling price.
- Notes.
- Reference photos.
- Quote-derived reference/detail photos.
- Optional face-check requirement.

Admin helper fields to preserve:

- Customer nickname suggestions from Supabase customer master data.
- Emoji nicknames are allowed.
- Admin may enter a nickname not in the list.
- Previously issued products in the trip may be suggested and can fill prices.

Helper behavior to preserve:

- Purchase tasks appear as cards.
- Open, completed, canceled/unavailable, and review-pending states are visually distinct.
- Helper opens task detail from the list.
- General purchases with the same product, JPY price, and note can be grouped for helper display.
- Helper can submit completed quantity, note, and a response/report photo.
- Partial completed quantities are allowed.
- Completed purchases become staging orders.
- Completed tasks remain visible as done.

Not-found/unavailable behavior:

- Helper can mark an item as not found/unavailable with reason/quantity.
- Unavailable tasks do not create staging orders.
- Admin can route unavailable/canceled purchases to private or public rebuy.

Face-check behavior:

- If a task requires face-check, helper submission uploads the review photo and moves the task to `review_pending`.
- Admin approval is required before the task becomes `completed`.
- Admin rejection/request retake sends it back for helper replacement.
- A `review_pending` task must not create a staging order.

Question:

- Should grouped purchase response remain an explicit helper UI feature in the first rewrite slice, or can it ship immediately after single-task response while still preserving final behavior?

## Rebuy

Preserve helper entry points:

- Dashboard rebuy widget.
- Rebuy list with public tasks and private tasks.
- Rebuy detail screen.
- Rebuy checkout action.

Preserve task behavior:

- Public rebuy tasks are visible to helpers.
- Private rebuy tasks are visible only to assigned/owning helper.
- Helper reports completed quantity, note, and optional photo.
- Public rebuy ownership belongs to the first successful helper claim.
- A competing public response must receive a conflict and must not overwrite ownership.
- Reported tasks move to a checkout-needed state.
- Helper checkout creates a rebuy checkout trip and settlement flow.
- Rebuy tasks do not become orders at report time.

Question:

- Are rebuy checkout trips still the desired long-term product concept, or should the rewrite preserve it as an interim compatibility behavior until formal rebuy merge rules are approved?

## Settlement

Preserve settlement entry points:

- Dashboard settlement widget.
- Trip-ended settlement panel.
- Settlement list with pending and completed trips.
- Warehouse report shortcut when required.

Preserve helper precheck:

- Bank account name, bank code, and bank account number.
- Helper note.
- Transport claims with descriptions, amounts, and proof photos.
- Receipt uploads with notes.
- Purchase payment method.
- Hourly-mode payment requirements for card amount or cash FX rate.
- Submit moves settlement to admin review.

Preserve correction/reporting:

- Helper can submit settlement issue/correction reports before completion.
- Report can include text and photos.

Preserve final confirmation:

- After admin review approval, helper confirms final details.
- Confirmation moves settlement to payment pending.

Preserve warehouse proof:

- Large-amount/deposit flow can require warehouse proof.
- Helper uploads warehouse proof photo and note.
- Warehouse proof can attach to staging order photo metadata.

Questions:

- What is the exact large-amount threshold and deposit/final-payment rule source for the rewrite?
- Which settlement summary values should be recomputed server-side versus denormalized for fast display?

## General Issue Report

Preserve:

- Dashboard issue-report entry point.
- Text message field.
- Multiple optional evidence photos.
- Empty-state preview before selecting photos.
- Helper-only submission.

## Staging And Merge Behavior To Preserve

The helper workflow produces staging data only. Preserve:

- Completed purchase tasks create or update staging orders.
- Partial purchase quantity uses completed quantity only.
- `open`, `review_pending`, `not_found`, and `canceled` purchase tasks do not create staging orders.
- Face-check approval gates staging eligibility.
- Quote/detail tasks are source material, not orders.
- Site photos are source material, not orders.
- Rebuy reports do not become orders until explicit checkout/approved rules apply.
- Admin review/edit/delete happens before merge.
- Approved merge writes `main.orders`, `main.order_source_links`, and `main.order_photos`.
- Helper-only provenance belongs in `main.order_source_links`, not as required fields on `main.orders`.
- Private R2 `storage_key` is durable photo data; signed URLs are temporary display values only.

## Current Behavior Questions

- Which dashboard mock metrics are product-approved placeholders versus required first-release live metrics?
- Should `receipt_required` be visible in the new UI or only supported at the data/API compatibility layer?
- Should grouped purchase response ship in the first vertical slice?
- Should rebuy checkout-trip behavior remain permanent or be treated as compatibility until a formal rebuy merge design is approved?
- What exact threshold and payout formula define large settlement deposits?
- What are the mobile upload retry/error copy requirements for direct R2 upload failures?
