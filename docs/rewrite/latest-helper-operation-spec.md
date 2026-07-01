# Latest Helper Operation Spec

Last updated: 2026-07-01

This document is the authoritative product behavior source for the MINICHI helper
rewrite. It supersedes older helper-operation descriptions when behavior differs.
Existing documents and legacy code remain useful only as implementation references,
migration context, and regression baselines.

## Rewrite Principles

- Build the new helper system on Supabase and private R2 as the product runtime.
- Do not design new product behavior around `data/db.json` or `public/uploads/`.
- Helper actions write staging workflow data only.
- Completed helper purchases enter `main.orders` only after admin review and explicit merge.
- Helper provenance must be written through `main.order_source_links`, not required on `main.orders`.
- New frontend work must use TypeScript, Tailwind CSS, and shadcn/ui.
- Photos must store durable R2 `storage_key` values; signed URLs are temporary display values.
- High-frequency helper submissions must be retryable and idempotent with client-generated submission ids.

## First Implementation Slice Boundary

The first implementation slice is intentionally limited to helper account, trip
assignment, and the status flow `scheduled -> departed -> arrived -> active`.
It does not include site photos, quote/detail tasks, purchase tasks, settlement,
rebuy, staging review, or merge.

Admin operations in this slice:

- Create and deactivate helper profiles.
- Create trips.
- Assign helpers to trips.
- View trip status.
- Confirm an arrived trip as active.
- Cancel trips or repair status/time fields with audit events.

Helper operations in this slice:

- Sign in with Supabase Auth email/password.
- See only an inactive-account notice when the helper profile is inactive.
- See only the helper's own assigned trips.
- View trips grouped by the trip timezone.
- Mark departure on today's scheduled trip.
- Mark arrival after departure.
- Wait for admin activation after arrival.
- Enter an active-trip workspace placeholder after admin activation.

Helper Auth accounts are tied to admin-created helper profiles. Passwords must be
set through invite/password reset or secure server-side creation. Fixed
passwords must not be committed, and legacy helper access keys are not part of
the new system.

Acceptance for this slice must verify helper isolation, inactive-helper access
blocking, helper inability to activate trips, audited admin activation,
trip-timezone grouping, stale action protection, and server-confirmed completion
states.

## First Implementation Slice Plan

Implementation order for the first slice is:

1. Schema and migrations.
2. Server domain functions.
3. Server Actions or API boundaries.
4. Minimal usable UI.
5. Tests and browser verification.

The first slice lives in the independent `minichi_helper_system/` Next.js web
app. It must not be mixed into the legacy vanilla prototype or the root
compatibility `app/` shell.

First-slice persistence is limited to:

- `helper_profiles`.
- `trips`.
- `trip_audit_events`.
- Minimal `version` or equivalent precondition data for stale-action protection.
- Minimal idempotency/submission data only if the first formal helper actions
  need immediate replay protection.

The first slice must not create tables for site photos, quote/detail tasks,
purchase tasks, staging orders, settlement, or rebuy. Those tables should be
introduced by later slices when their workflow rules are implemented.

`helper_profiles.auth_user_id` maps to Supabase `auth.users.id`. Admins may
create helper profiles before Auth setup is complete, then attach the Auth user
through invite/password reset or secure server-side user creation. Plaintext
passwords must never be stored, and legacy helper access keys are excluded.

Trip status transitions are implemented in server-side domain functions. Each
trip uses `version` or an equivalent precondition so stale actions do not
overwrite newer state. Admin activation, cancellation, and repair actions must
write `trip_audit_events`.

The first admin UI includes helper list/form, trip form/list, arrived-trip
activation, and minimal cancel/repair entry points. The first helper UI includes
login, inactive notice, today/upcoming/history trips, departure, arrival,
waiting-for-active state, and an active workspace placeholder.

Testing starts with domain/server tests, then Server Action/API integration
tests, then mobile-viewport browser flow verification. The first slice does not
require R2 tests because it has no media flow.

## First Slice Schema

The first helper-system migration lives in
`minichi_helper_system/supabase/migrations/`, not in the root legacy
`supabase/migrations/` directory. The first slice uses an independent
`helper_app` schema.

The first slice creates only these tables:

- `helper_app.helper_profiles`.
- `helper_app.trips`.
- `helper_app.trip_audit_events`.

It must not create site photo, quote/detail, purchase, staging order,
settlement, rebuy, or generic idempotency/submission tables.

`helper_app.helper_profiles` fields:

- `id uuid primary key`.
- `auth_user_id uuid unique null references auth.users(id)`.
- `display_name text not null`.
- `email text not null`.
- `compensation_mode text not null`.
- `hourly_rate_twd integer null`.
- `helper_fx_rate numeric null`.
- `bank_account_name text null`.
- `bank_code text null`.
- `bank_account_number text null`.
- `region text null`.
- `is_active boolean not null default true`.
- `created_at timestamptz`.
- `updated_at timestamptz`.

`helper_profiles` must not store legacy access keys or plaintext passwords.

`helper_app.trips` fields:

- `id uuid primary key`.
- `trip_name text not null`.
- `business_date date not null`.
- `scheduled_time time null`.
- `location text null`.
- `timezone text not null default 'Asia/Tokyo'`.
- `assigned_helper_id uuid references helper_app.helper_profiles(id)`.
- `status text not null`.
- `departed_at timestamptz null`.
- `arrived_at timestamptz null`.
- `admin_activated_at timestamptz null`.
- `ended_at timestamptz null`.
- `canceled_at timestamptz null`.
- `version integer not null default 1`.
- `created_at timestamptz`.
- `updated_at timestamptz`.

The first assignment model is `trips.assigned_helper_id`; the first slice does
not create a `trip_assignments` table.

Stale protection uses `trips.version` with an `expectedVersion` precondition on
every status mutation. State-changing mutations increment `version`.

`helper_app.trip_audit_events` fields:

- `id uuid primary key`.
- `trip_id uuid not null references helper_app.trips(id)`.
- `actor_user_id uuid null`.
- `actor_helper_id uuid null references helper_app.helper_profiles(id)`.
- `actor_role text not null`.
- `action text not null`.
- `before_state jsonb not null default '{}'::jsonb`.
- `after_state jsonb not null default '{}'::jsonb`.
- `reason text null`.
- `created_at timestamptz not null`.

Trip audit events record helper departure, helper arrival, admin activation,
admin cancellation, and admin repair actions.

The first migration enables RLS. Helpers may read their own profile and assigned
trips. Mutations remain controlled by server-side domain functions. Admin access
is guarded by server-side admin checks plus conservative RLS policy.

The first slice does not create a generic idempotency/submission table.
Departure and arrival use trip version and status transition rules. Media, task,
and purchase slices will introduce formal idempotency storage later.

## First Slice Auth And RLS

Helper clients may directly read only the minimum data needed for the first
slice:

- An authenticated helper may read the helper's own profile.
- An active helper may read assigned trips.
- An inactive helper may read only the helper's own profile so the UI can show
  the inactive-account notice. Inactive helpers must not read trips.

Helpers must not directly insert, update, or delete `helper_app.trips`. Helper
departure and arrival go through Server Actions that call server-side domain
functions.

The first admin identity check uses a server-side environment allowlist:
`MINICHI_ADMIN_EMAILS`. The initial allowlisted email is
`minichi.shop.tw@gmail.com`. Admin email addresses must not be hard-coded in
source code. The first slice does not create `admin_profiles` or `admin_roles`.

Admin create/deactivate helper, create trip, activate trip, cancel trip, and
repair trip actions all go through Server Actions. Admin Server Actions verify
the Supabase session first, then verify the admin email allowlist.

Service-role clients are restricted to server-only modules. Service-role access
may be used only for admin operations, domain mutation transactions, and Auth
user attachment/invite flows. Browser/client components must never import or
receive a service-role client.

RLS is enabled. Authenticated helpers may select their own profile, and active
helpers may select their assigned trips. Helpers cannot insert, update, or delete
trips or audit events through direct client access. Admin reads and writes are
primarily guarded by server-side checks; RLS remains conservative and must not
grant broad authenticated table access.

`helper_app.trip_audit_events` rows are written only by server-side domain
functions in the same transaction as the state change. This applies to helper
departure, helper arrival, admin activation, admin cancellation, and admin
repair actions.

## Mobile UX, Retry, And Idempotency

The helper app is mobile-browser first. The first version supports weak-network
retry and draft preservation, but does not implement a full offline queue.

Every formal helper submission must include a client-generated idempotency key.
This applies to high-risk workflow writes such as site photo batch records,
quote/detail replies, purchase completion, purchase cancellation or unavailable
reports, face-check submission, helper final face-check confirmation, settlement
precheck, settlement correction, transport proof, issue reports, and warehouse
proof.

Duplicate taps, page refreshes, timeout retries, and resubmissions must not
create duplicate task results, photo records, purchase completions, or staging
orders. Server confirmation is the source of truth for completed states.
Optimistic UI may show only pending or temporary states and must not mark formal
work complete before server confirmation.

Media upload supports per-photo status, failed-photo retry, preserved ordering,
and continuing other work while uploads continue. The database record must bind
uploaded media through durable R2 `storage_key` values plus batch/photo client
identifiers and ordering data, so retries do not duplicate or reorder photos.

Form drafts are preserved at least on the same device and browser until the
submission succeeds or the helper explicitly clears the draft. If server state
changed since the draft or submission began, such as trip ended, task canceled,
or quote converted to purchase, retries must not overwrite the newer state. The
server returns a clear error and asks the client to refresh.

## Roles And Account Setup

The first-phase admin surface is a necessary operations console for the helper
workflow, not a complete administrator system rewrite. It must support helper
creation, trip creation, helper assignment, trip-state review, and active-trip
confirmation. Later business slices add task publishing, live return review,
rebuy, settlement, and warehouse flows as needed.

Admin creates and manages helper accounts from the admin operations console.

Helper account data:

- Login email and password through Supabase Auth.
- Compensation mode: hourly or FX-rate.
- Hourly rate in TWD, when hourly.
- Helper FX rate, when FX-rate.
- Bank account name.
- Bank code.
- Bank account number.
- Helper live-shopping region.
- Active/inactive account state.

Bank account name, bank code, and bank account number are admin-managed in the
first version. Helpers do not edit payment/bank data themselves.

The first version uses Supabase Auth email/password. Legacy helper access keys
are excluded from the new system and remain only in the old prototype.

Inactive helpers may sign in, but they only see an inactive-account notice and
cannot read or mutate trips, tasks, settlements, rebuy data, or other work data.

The first version has one admin role. The data model should remain ready for
multiple admins or more granular permissions later. The initial admin account
email is `minichi.shop.tw@gmail.com`; its password must be set through Supabase
invite/password reset or a non-committed environment seed.

Helper visibility:

- Own profile.
- Assigned trips only.
- Tasks under assigned trips only.
- Own settlements.
- Own private rebuy tasks.
- Minimum public rebuy fields needed to claim public rebuy tasks.
- Own warehouse reports.
- Own issue reports.

Helpers must not see unrestricted customer data, other helpers' private data, merge controls,
or final operational order data.

## Role-Based UI Reasonableness Review

Every helper-system UI slice must be checked from the role that actually uses
that screen, not only from the data model or API flow. The current target is a
reasonable working UI, not a polished visual redesign.

When building helper-facing screens, the implementer must review the screen as a
helper working from a phone during a live shopping trip:

- The next required action should be obvious without reading implementation
  notes or knowing backend state names.
- Pending, success, retryable failure, blocked, inactive, ended, and canceled
  states must be visible and understandable.
- The screen should not ask helpers to make admin decisions, expose admin-only
  concepts, or show data from other helpers.
- Mobile tap targets, camera/photo flows, long product names, and unstable
  network recovery must be reasonable for on-site use.
- Navigation should let the helper return to the current trip task without
  losing drafts or upload progress.

When building admin-facing screens for the helper workflow, the implementer must
review the screen as an admin coordinating live helper work:

- The screen should make current trip, helper, task, and pending-review state
  scannable enough to decide what needs attention next.
- Admin-only controls must be clearly separated from read-only live return data
  and from final merge/review actions.
- The UI should make it hard to accidentally overwrite helper replies, approve
  stale data, or perform a final merge from the wrong context.
- Multi-trip monitoring, helper assignment, task publishing, save/share/download,
  face-check review, staging review, and settlement/payment states must each
  show the minimum context needed for a confident admin decision.
- The admin view may remain simple, but it must not rely on hidden state,
  ambiguous labels, or backend-only terminology for critical actions.

Each slice's verification should include a short role-perspective pass for every
new or materially changed helper/admin screen. If the UI is technically wired
but unreasonable for the role's real workflow, the slice is not complete.

## Navigation

### Helper

The helper app has these primary areas:

- Home: dashboard, helper settlement, rebuy, warehouse report, and issue report entry points.
- Trips: today trips, upcoming trips, and historical trips.

Trip grouping:

- Today: trip business date equals today.
- Upcoming: trip business date is after today.
- History: trip business date is before today or the trip is ended. Historical trips cannot be operated and should guide the helper to settlement.

Business-date grouping should use the trip timezone, normally `Asia/Tokyo`.
Admins normally operate from Taiwan, but admin-local time is display-only.
Business grouping and state logic must use the trip timezone.

### Admin

The helper-related admin app has these primary areas:

- Home: helper management plus trip creation and trip management.
- Settlement.
- Task publishing.
- Rebuy.
- Live return feed.

## Live Return Feed

The first-version live return feed uses scoped polling or scoped refresh, not
Supabase Realtime. Supabase Realtime is deferred until the core write paths and
read models are stable.

Admins can monitor multiple selected trips at the same time. The default live
feed scope is active or otherwise current operational trips. Historical trips
are filterable for review, but they are not the primary live feed view.

The first live feed supports:

- Site photo viewing and sharing.
- Quote/detail reply viewing.
- Quick purchase publishing from quote/detail.
- Manual purchase task publishing.
- Purchase response monitoring.
- Face-check approval or retake request.
- Completed-purchase staging-order preview.

Admin edits before merge update reviewed staging data, not helper source
replies. Admin-editable reviewed staging fields are:

- Customer nickname.
- Product name.
- Quantity.
- Original JPY price.
- Sale TWD price.
- Notes.
- Order photos or selected retained photos.

Every admin edit writes audit events. Live return feed does not perform final
merge into `main.orders`; merge remains an explicit review action.

## Trip Creation And Status Flow

Admin creates trips from the admin home page.

Trip fields:

- Trip name.
- Date.
- Time.
- Location.
- Assigned helper.
- Region/timezone.

Only the assigned helper can see the trip.

Trip statuses:

- `draft`
- `scheduled`
- `departed`
- `arrived`
- `active`
- `ended`
- `canceled`

Trip status flow:

1. Helper opens today's trip.
2. Helper taps departure; hourly settlement timing starts from `departed_at`.
3. Admin sees the status update in trip management.
4. Helper arrives on site and taps arrival/start-live request.
5. Admin receives the request and confirms the live system open.
6. Helper enters the active trip workspace.
7. Helper works through status and work-reporting blocks.
8. Helper taps end live session.
9. Helper confirms the end action.
10. If block-two tasks remain unfinished, the system warns but does not block ending.
11. If block-three purchase tasks remain unfinished, the helper must complete or cancel them before ending.
12. Live timing stops and the system guides the helper into settlement.

The first accepted vertical slice must at least implement:

`scheduled -> departed -> arrived -> active`

Helpers may mark departure and arrival but cannot activate a trip. Admin confirms
an arrived trip into active and may cancel, force end, and repair status or time
fields. Site photos, quote/detail tasks, purchase tasks, and other live work
functions are available only after the trip becomes active.

Trip records retain `departed_at`, `arrived_at`, `admin_activated_at`, and
`ended_at`. Hourly settlement uses `departed_at -> ended_at`, including
travel/work time. Transport fees remain separate transport claims or allowances.

Ended or canceled trips expose only a helper-visible history summary and
settlement navigation. Helpers cannot mutate tasks after end/cancel.

All admin status changes, force actions, and time repairs must write audit events.

Active helper workspace:

- Trip status dashboard: work summary, live timer, and pending priorities.
- Work report area:
  - Block 1: site photo batches.
  - Block 2: quote/detail replies.
  - Block 3: purchase tasks.

## Block 1: Site Photo Batches

Helper behavior:

- Upload multiple on-site wide photos in one batch.
- Photos can come from direct camera capture or prior album photos.
- Batch name is optional.
- Batch note is optional.
- Each upload creates a separate batch.
- The helper sees upload progress as a count, such as `3/10`.
- The helper can continue other work while uploads continue.
- The helper may return to block 1 and add more batches at any time.

Admin behavior:

- In live return feed, admin selects one or more trips to monitor.
- Multiple trips can be monitored at the same time.
- Admin sees uploaded site photos under the selected trips.
- Admin can share photos through the browser/mobile share flow or save them to the iPhone photo library where supported.

Retention:

- All new helper-system media uses private R2. The new system does not use
  `public/uploads`.
- Database records persist durable R2 `storage_key` values. Signed URLs are
  generated on demand for display/share and must not be stored as canonical data.
- Site-wide photos are `temporary_work_media` by default and are eligible for
  cleanup after 10 days.
- Photos used by task, order, face-check, settlement, or warehouse workflows
  become durable retained media and are excluded from 10-day temporary cleanup.
- Admin can manually retain site photos or mark them for deletion.
- Warehouse proof photos are `warehouse_evidence` and are retained long term.
- First-version LINE/iPhone sharing uses the Web Share API, with download or
  short-lived share-link fallback.
- The first version must include retention fields in the schema. The cleanup job
  can be implemented after core workflow slices stabilize.
- Media upload flows must support retry, batch ordering, and idempotency keys to
  avoid duplicate photo records or duplicate tasks.

## Block 2: Quote And Detail Tasks

Admin creates quote/detail tasks from task publishing.

Creation rules:

- Admin selects exactly one trip per task publish action.
- Task type is one of:
  - Quote.
  - Detail photos.
  - Quote plus detail photos.
- A task can contain multiple photos.
- One uploaded photo equals one subtask.
- All subtasks in the same publish action must share the same task type.
- Product name is optional at the task level.
- Instruction content is optional at the task level.
- At least one image is required.
- Each photo can have its own optional product name.
- Each photo can have its own optional instruction.

Helper reply rules:

- Open and replied tasks must have clear visual separation.
- Reply requirements follow task type.
- Quote price accepts numbers only.
- Detail-photo replies can contain multiple photos.
- Notes are optional.
- Progress shows completed subtasks over total subtasks.
- Helpers may edit already replied subtasks only while the trip is `active` and
  the response has not been converted into a purchase task.
- Edits update the current response value and write audit events. The first
  version does not need a full version-history UI.
- Once a quote/detail response has been converted into a purchase task, it cannot
  be directly rewritten. Admins must use a correction or supplemental workflow
  instead.

Display fallback rules:

- Subtask display name uses photo product name first, then task product name,
  then the task type default title.
- Subtask instruction uses photo instruction first, then task instruction, then
  empty content.

Admin live return behavior:

- Admin sees quote/detail replies in live return feed.
- Detail photos can be shared or saved through the browser/mobile share flow.
- Admins may edit task-level information and add new subtasks, but must not
  silently clear or overwrite submitted helper replies.
- If an admin edit affects the meaning of an already submitted reply, the
  subtask must be marked `needs_review` or otherwise show that the task changed.

Retention:

- Quote/detail reply photos are durable retained media.
- Photos referenced by quote/detail tasks are durable retained media.
- Photos carried from quote/detail into purchase tasks remain durable retained
  media.

## Purchase Task Publishing

Purchase tasks can be created from two places:

- Task publishing page.
- Quick publish from a quote/detail item in live return feed.

Purchase fields are required:

- LINE community nickname.
- Product name.
- Quantity.
- Original product price in JPY.
- Sale price in TWD.
- Product/reference photos.
- Face-check required flag.

Customer nickname suggestions:

- Source suggestions from Supabase `main.customers`.
- Debounce the suggestion query.
- Allow nicknames that do not exist in suggestions.
- Do not expose unrestricted customer master records to helper clients.

Product autofill:

- Match only quote/detail results from the same trip.
- If the product name was quoted earlier in the same trip, automatically fill
  the quoted JPY price and related images.
- Quick publish from quote/detail must carry the admin-uploaded source image.
- If helper detail photos exist, quick publish must carry all related detail photos.
- Quick publish from quote/detail must preserve provenance linking the purchase
  task back to the quote/detail source.

## Block 3: Purchase Tasks

Helper purchase lists must clearly separate:

- Not completed.
- Completed.
- Canceled.
- Pending MINICHI review.

Purchases with the same product should be grouped for helper operation. The home view
should show total order count, total quantity, bought quantity, and completed order count.
Swiping horizontally should reveal the individual customer purchase commands.
The grouping key is product name + original JPY price + face-check required flag.
Same-group batch actions must not cross this key.

The first version keeps partial quantity behavior. Purchased quantities can be
completed and generate staging orders; unpurchased remaining quantities must be
canceled, marked unavailable/not found, or routed to rebuy.

### Non-Face-Check Purchases

- Report photos are optional.
- Notes are optional.
- If the helper completes without photos, show a confirmation prompt.
- Completing without photos writes an audit event.
- After confirmation, the task becomes completed.

### Face-Check Purchases

- The helper must upload one or more face-check photos.
- Notes are optional.
- Submission moves the task to pending MINICHI review.
- The helper must keep the physical item available while waiting for review.
- Admin can request a replacement/retake, keeping the task pending for helper action.
- Admin can approve the face-check, but the task remains pending until helper final confirmation.
- Helper sees the approved pending task in the unfinished area.
- Helper taps final confirmation after seeing that MINICHI approved the face.
- Only then does the task become completed.
- The status flow is
  `open -> review_pending -> approved_pending_helper_confirmation -> completed`.
- Helper final confirmation can support same-group batch confirmation only when
  the grouping key matches exactly and every task is admin-approved.

### Canceled Purchases

- Helper can cancel when an item is unavailable or cannot be bought.
- Cancel reason is required.
- Canceled tasks do not generate staging orders.
- Admin can route canceled tasks to private rebuy or public rebuy.
- Canceled tasks do not reopen. If the item should be purchased again, admin
  creates a new purchase task linked back through provenance/audit.
- Unavailable and not-found tasks do not generate staging orders.

## Staging, Merge, And Photo Retention

Only completed purchase tasks can generate staging orders.

These statuses must not create staging or final orders:

- Open.
- Pending MINICHI review.
- Approved pending helper confirmation.
- Canceled.
- Not found/unavailable.

Completed helper purchase data remains in staging until admin review and merge.
Admin merge writes reviewed helper-generated orders into:

- `main.orders`.
- `main.order_source_links`.
- `main.order_photos`.

Only ended trips can be merged. Active trips may expose staging previews and
admin review work, but final merge waits until the trip is ended. Normal
live-trip order merge can happen after admin order review is complete.
Settlement, payment, and warehouse completion are not required for the normal
live-trip order merge.

The first-version merge unit is one trip-level merge job per trip. Admins may
soft-exclude individual staging orders before approving a trip merge job.
Exclusion requires a reason; the staging review UI must not hard-delete orders.

Reviewed staging data is separate from helper source data. Admin corrections
update reviewed staging records and audit rows; they do not rewrite helper
purchase, quote/detail, face-check, or rebuy source responses. Review-only or
internal admin fields must not become helper-visible. If staging preview rows
are helper-readable, approval, exclusion, internal notes, selected final photos,
and merge status should live in separate admin-only review tables or behind
split RLS policies.

Staging review uses the same reviewed staging editable fields as live return
feed:

- Customer nickname.
- Product name.
- Quantity.
- Original JPY price.
- Sale TWD price.
- Notes.
- Include/exclude state.
- Exclude reason.
- Selected final order photos.

If a customer nickname does not match `main.customers`, the UI warns the admin.
The admin may explicitly confirm the unknown name and merge, but the merge flow
does not automatically create a `main.customers` record.

Staging review edits must not silently overwrite helper source task or reply
data. Helper provenance is canonical in `main.order_source_links`, not required
fields on `main.orders`.

After admin approval, the reviewed snapshot is frozen. Any later edit revokes
approval and requires review/approval again.

Merge actions require expected-version checking, client idempotency keys, and
retryable failed-state handling. Duplicate retries must not create duplicate
`main.orders`, source links, photo rows, or R2 copies.

Main database writes are all-or-nothing inside the database transaction. Because
R2 copies cannot be part of the same database transaction, final photo copy keys
are deterministic and R2 copy steps must be idempotent/resumable.

Merge writes only admin-selected final order photos. Eligible selected photos
can include purchase source/reference, quote/detail, helper purchase report,
final approved face-check, and rebuy reference/report photos. Site photos,
rejected/retaken face-check photos, settlement receipts, transport proof, and
warehouse proof are not final order photos unless a later explicit product
decision changes that boundary.

Rebuy checkout orders follow the same
`staging -> admin review -> explicit merge` rule.

Post-merge edits belong in the administrator order system, not the helper
workflow. After merge, the helper system shows the merged result as read-only
and does not provide a reverse-delete or rollback action that deletes merged
`main.orders`. Live return feed and staging review cannot directly create final
`main.orders` without an explicit merge action.

After successful merge, staging workflow data keeps a 7-day recovery window,
then can be archived or cleaned while preserving minimal merge audit records.

Photo retention:

- Site-wide photos: delete after 10 days unless retained.
- Admin task images linked to completed purchase orders: retain.
- Helper detail photos linked to completed purchase orders: retain.
- Helper purchase report photos linked to completed purchase orders: retain.
- Face-check rejected/retaken photos: delete after 10 days.
- Final approved face-check photos: retain.
- Non-face-check report photos: retain when linked to completed purchase orders.
- Linked source/detail photos carried into purchase orders: retain.
- Unlinked temporary media can be deleted after 10 days.

Merge timing relative to settlement is defined above: normal live-trip order
merge does not wait for settlement, payment, or warehouse completion.

## Settlement

After live session end, the helper is guided into settlement.
Settlement is by trip.
Settlement uses completed purchase tasks and staging order preview data from the
helper workflow. It does not wait for merge into `main.orders`, and settlement
must not directly create or mutate final operational orders.

At trip end, unfinished quote/detail subtasks warn the helper but do not block
ending the trip. Unfinished purchase tasks block ending until they are completed,
canceled, marked unavailable, or marked not found. After `ended_at` is written,
helpers cannot mutate live tasks.

Settlement line items include:

- Item.
- Quantity.
- Original JPY price.
- Product total.

Compensation formula:

- FX-rate mode: product total JPY multiplied by helper FX rate, plus TWD transport subsidy.
- Hourly mode: live/work time multiplied by hourly TWD rate, plus product total JPY converted to TWD by the day rate, plus TWD transport subsidy.

The settlement day exchange rate is stored as `jpy_to_twd_rate`. The conversion
formula is `JPY amount * jpy_to_twd_rate = TWD amount`. This rate represents the
JPY-to-TWD market exchange rate for the settlement day; the system may fetch it
from an online exchange-rate source during settlement, then stores the selected
rate used for calculation.

Hourly settlement uses `departed_at -> ended_at`, including travel/work time.

Helper precheck:

- Helper reviews settlement detail.
- If details are wrong, helper submits correction information.
- Daily receipt photo is required.
- Transport proof and transport amount are required only when claiming transport.
- Transport amount is entered in JPY and converted to TWD by
  `jpy_to_twd_rate`.
- Transport claims require admin approval before they are included in payable
  totals.
- Correction evidence can be text and/or photos.

Admin settlement:

- Settlement page groups records as paid, in progress, and unpaid.
- Each live session appears as one settlement card.
- Admin opens a session to inspect settlement progress.
- If order details are wrong, admin edits the live-return/order data and asks helper to recheck.
- If helper-submitted settlement data is wrong, admin can reject and request refill.
- If all data is correct, admin approves.

Helper final confirmation:

- After admin approval, helper performs final confirmation.
- The settlement then waits for admin payment.

Payment:

- Admin pastes transfer notification text and marks payment complete.
- The 20,000 TWD split-payment threshold uses the item advance amount, not the
  total payable amount.
- Settlements at or below the 20,000 TWD item-advance threshold are paid once.
- Settlements above the 20,000 TWD item-advance threshold are paid 50% first,
  then the remaining 50% after warehouse report approval.
- Large-settlement second payments require their own transfer notification text.
- Every payment records paid amount, paid time, and transfer notification text.
- Admins cannot directly overwrite formula totals. Admin corrections must change
  source data such as orders, transport claim, work time, exchange rate, or review
  state, with audit events.

## Warehouse Report

After payment completion, the helper is guided to warehouse report.
For settlements above the 20,000 TWD item-advance threshold, completion is
withheld until warehouse report and final payment.

Helper warehouse report:

- Upload one photo showing goods handed to the forwarding warehouse.
- Optional text note.

Admin:

- Reviews the warehouse photo in settlement.
- Marks warehouse report complete.
- For settlements above the 20,000 TWD item-advance threshold, pays the
  remaining half.

Final-payment transfer notification is required for large settlements. Warehouse
proof photos are `warehouse_evidence` and are retained long term.

## Rebuy

Rebuy tasks can be private or public.

- Private rebuy: only the assigned helper can see and complete it.
- Public rebuy: active helpers can see the minimum public fields while it is
  open; the first successful atomic claim wins.

Rebuy purchase flow should match non-face-check block-three purchase behavior.
Rebuy does not support face-check in the first version.
Public rebuy claim must be atomic at the database layer.

Admin rebuy creation:

- Admin can create rebuy tasks manually from the rebuy page.
- Admin can create a rebuy task from a `canceled`, `unavailable`, or `not_found`
  purchase task.
- A rebuy created from a purchase task preserves source purchase,
  quote/detail, customer/order, price, photo, and audit provenance.
- One source purchase task must not have more than one active rebuy task at the
  same time. A later attempt is a new provenance-linked task, not a reopened
  completed or canceled task.
- Fields are almost the same as purchase task publishing.
- Admin first selects private or public.
- If private, admin selects one helper.
- Admin may reassign private rebuy tasks only before completion, checkout, or
  merge-related review state. Reassignment must write an audit event.
- Before claim, admins may edit all task fields.
- After claim, material changes to product, quantity, price, photos, scope, or
  assignee require audited claim revocation and republication.
- After completion, admin corrections update reviewed staging data and must not
  rewrite the helper's source response.
- Admin can list and filter pending and completed rebuy orders.

Helper rebuy area:

- Public rebuy area.
- My rebuy area.
- Rebuy settlement button.
- The rebuy settlement button is enabled only when completed rebuy items exist.

Public rebuy visibility:

- Product name.
- Quantity.
- Original JPY price.
- Reference photos.
- Shopping instructions.
- Creation and public availability time.

The public list must not expose LINE community nickname, TWD sale price,
complete purchase or quote provenance, unrestricted customer data, or other
helpers' data. It sorts by `public_available_at` descending, so the newest
publication appears first. Initial publication sets `public_available_at` to
the creation time. Returning a task to the public pool sets a new
`public_available_at`, so the released task returns to the front of the list.
Admins do not set a separate rebuy priority.

Public claim and release:

- Public tasks must be claimed before shopping.
- Claim atomically transitions `open -> claimed`, records the claiming helper
  and claim time, increments the task version, and writes an audit event in the
  same transaction.
- After claim, the task disappears from every other helper's public list and
  appears in the claiming helper's My Rebuy area.
- If the claiming helper cannot buy the item, the helper may use a release
  action to return an originally public task through `claimed -> open`.
- Release is allowed only for the current claiming helper while the task is
  still `claimed`. It is not allowed after completion or checkout.
- Release requires a reason, a client-generated idempotency key, and the
  expected task version.
- The database conditionally updates the row only when its status, owner, and
  version still match. It clears the claim fields, refreshes
  `public_available_at`, increments the version, and writes the release audit
  event in the same transaction.
- Replaying the same release idempotency key returns the accepted result.
  Stale versions or a task claimed by another helper return a clear conflict
  without overwriting current state.
- Helpers cannot release private rebuy tasks into the public pool. Private
  reassignment or conversion to public is an audited admin action.

Rebuy task states:

- Public normal flow:
  `open -> claimed -> completed -> checkout_pending ->
  settlement_in_progress -> settled`.
- Private normal flow:
  `open -> completed -> checkout_pending -> settlement_in_progress -> settled`;
  the assigned helper is set at creation, so no public claim step is needed.
- Terminal alternatives are `canceled`, `unavailable`, and `not_found`.

Rebuy completion:

- The first version does not support face-check.
- Report photos are optional and notes are optional.
- Completing without a report photo requires an explicit confirmation prompt
  and an audit event.
- Partial quantity completion is allowed.
- The helper must provide a reason for the unpurchased remainder.
- The remainder does not automatically return to the public pool. Admin may
  create a new provenance-linked private or public rebuy task for it.
- Completion stores the rebuy result. It does not yet materialize staging
  order previews because the trip-level checkout/merge unit does not exist
  until checkout.
- Formal claim, release, completion, partial completion, and checkout actions
  use client-generated idempotency keys and server-confirmed states.

Rebuy checkout:

- Helper clicks rebuy settlement.
- One checkout atomically selects every completed, not-yet-checked-out rebuy
  task owned by that helper.
- The system creates a rebuy checkout trip named
  `{date} {helper name} 的補買結帳`.
- Additional same-day checkout trips may add a human-readable sequence suffix;
  UUID remains the identity.
- The checkout trip behaves like an already ended live trip.
- Checkout creates the completed purchase-equivalent records, staging order
  previews, and settlement in the same transaction.
- Duplicate checkout submission must return the existing accepted checkout and
  must not create duplicate trips, purchase-equivalent records, staging
  previews, or settlements.
- It appears in helper settlement.
- It follows the normal settlement flow.
- Rebuy checkout work hours are zero. FX-rate and item-advance calculations
  follow the confirmed settlement formulas, and optional transport is included
  only after admin approval. The system must not invent departure or work
  timestamps.
- Admin sees the checkout trip in settlement.
- Admin can select the checkout trip in live-return orders to inspect and edit the rebuy orders.

Completed rebuy orders may be merged before rebuy settlement/payment is complete,
but only after admin review and an explicit merge action.
Rebuy checkout writes staging workflow data only. It must not directly write
`main.orders`, `main.order_source_links`, or `main.order_photos`; those writes
remain part of the explicit Slice 7 merge.

## Testing And Acceptance Gates

Every implementation slice must pass the fixed common gate:

- Helper/admin permissions.
- Staging/main boundary.
- R2 `storage_key` persistence.
- Signed URLs not persisted as durable data.
- Audit events for status changes, admin edits, and formal submissions.
- Idempotency and duplicate retry.
- Server-confirmed completion, with optimistic UI limited to pending or
  temporary states.
- Stale retry or stale draft conflicts that do not overwrite newer server state.

Every slice must define slice-specific acceptance criteria. A slice is not
complete merely because the screen is operable.

Test layering uses:

- Domain/service or server-side unit tests.
- API/Server Action integration tests.
- Browser flow tests.
- Selective Supabase/R2 cloud acceptance for auth, R2, merge, atomic-claim, and
  idempotency-critical paths.

Helper-facing slices must include mobile viewport or mobile browser acceptance.
Flows involving photos, sharing, drafts, or weak-network retry must be tested on
iPhone Safari or an equivalent mobile environment.

Any flow that creates order data must verify that helper workflow actions
produce staging data only, do not directly write `main.orders`, and can enter
`main.orders` only through an admin explicit review and merge action.

R2 media acceptance must verify that durable database fields use private
`storage_key` values, signed URLs are display/share-only, and upload retry does
not create duplicate photo records or reorder photos.

Every formal helper submission must verify that resubmitting the same
idempotency key does not create duplicate data.

After all slices are complete, the project must run a full dress rehearsal:
helper/trip -> active -> site photos -> quote/detail -> purchase/face-check ->
staging order -> admin review -> merge -> settlement/warehouse/rebuy relevant
flow.

## Implementation Slice Order

1. Helper account, trip creation, helper login, assigned today trip, departure, arrival, admin confirmation, and active state.
2. Site photo batch upload to private R2 and admin live-return viewing, saving, sharing, and download.
3. Quote/detail task creation and per-photo helper replies.
4. Purchase task creation, non-face-check completion, face-check review/final confirmation, cancellation, and staging order creation.
5. Settlement, payment, and warehouse report.
6. Private/public rebuy and rebuy checkout.
7. Admin staging review and merge into `main.orders`.
8. Production hardening, mobile/manual acceptance, performance checks, cleanup policy, deployment readiness, and full dress rehearsal.

## Second Implementation Slice Boundary

The second implementation slice is limited to active-trip site photo batches and
admin live return feed. It is the first media slice and introduces private R2
upload behavior for the new helper system.

Admin operations in this slice:

- View site photo batches from active trips.
- View photos through temporary signed display URLs.
- Mark selected photos as saved.
- Share or download photos through short-lived signed URLs.

Helper operations in this slice:

- Open the active-trip workspace.
- Select and preview multiple site photos in one batch.
- Upload photos directly to private R2.
- Retry individual failed photo uploads without resubmitting successful photos.
- Submit batch metadata after uploads are available.
- See clear per-photo uploading, uploaded, failed, retrying, and submitted states.

Slice 2 explicitly excludes:

- Creating quote/detail tasks from photos.
- Helper quote/detail replies.
- Purchase tasks.
- Staging order creation.
- Settlement, rebuy, and merge workflows.

Slice 2 persistence must store durable R2 `storage_key` values and must not store
signed URLs as canonical data. Photo order must be preserved across upload,
metadata commit, readback, and retry. Metadata commits use client-generated
submission identifiers so duplicate taps, page refreshes, and lost responses do
not create duplicate batches or duplicate photo records.

Site photos are temporary work media by default and remain eligible for later
cleanup unless an admin marks them saved or a later workflow slice references
them as durable task/order evidence.

Acceptance for this slice must include mobile/iPhone Safari or equivalent mobile
browser testing. It must verify helper ownership isolation, inactive-helper
blocking, ended/canceled trip upload blocking, duplicate submission behavior,
single-photo retry without duplicate records, preserved ordering, R2
`storage_key` persistence, and signed URLs being display/share-only values.

## Third Implementation Slice Boundary

The third implementation slice is limited to quote/detail task creation,
per-photo helper replies, and admin live return feed viewing of replies.
Purchase task creation and quick publish from quote/detail are explicitly
deferred to Slice 4.

Admin operations in this slice:

- Select exactly one active trip for a quote/detail publish action.
- Select one or more site photos from that trip.
- Create a task with one shared task type for all selected photos:
  `quote`, `detail`, or `quote_and_detail`.
- Optionally set task-level product name and instruction.
- Optionally set photo-level product name and instruction; photo-level values
  override task-level values for that photo.
- View quote/detail progress and helper replies in the live return feed.
- Edit task-level or subtask-level information without clearing or overwriting
  submitted helper replies.
- Mark or surface `needs_review` when an admin edit changes the meaning of an
  already submitted reply.

Helper operations in this slice:

- View open and replied quote/detail subtasks with clear visual separation.
- Reply to each subtask according to the task type.
- Submit a JPY price for `quote`.
- Upload at least one detail photo for `detail`.
- Submit both a JPY price and at least one detail photo for
  `quote_and_detail`.
- Add optional notes.
- Edit an already submitted response only while the trip is `active` and the
  response has not been converted into a purchase task.

Slice 3 explicitly excludes:

- Purchase task creation.
- Quick publish from quote/detail to purchase.
- Customer nickname suggestions for purchase publishing.
- Purchase quantity, sale price, face-check, cancellation, unavailable, staging
  order creation, settlement, rebuy, and merge behavior.

Quote/detail replies and edits require client-generated idempotency keys. Server
confirmation is the source of truth for completed replies; optimistic UI may
show pending state but must not mark a formal reply complete before the server
confirms it. Duplicate taps, refresh retries, timeout retries, and repeated
submissions must not create duplicate response records or duplicate reply photos.

Task-referenced site photos become durable retained media. Helper detail reply
photos are also durable retained media. Durable media records store private R2
`storage_key` values only; signed URLs are generated on demand for display,
share, or download and must not be persisted as canonical data.

Once a quote/detail response has been converted into a purchase task in a later
slice, the response is locked from direct helper rewrite. Corrections after that
point must use a later correction or supplemental workflow instead of mutating
the source response silently.

Acceptance for this slice must include mobile browser or equivalent mobile
viewport testing. It must verify task creation from selected site photos,
per-photo fallback display names and instructions, quote-only replies,
detail-photo replies, quote-and-detail replies, idempotent duplicate reply
submission, helper edit before purchase conversion, active-trip-only mutation
blocking, helper ownership isolation, inactive-helper blocking, durable
`storage_key` persistence, signed URLs being display-only values, and admin live
feed visibility of reply progress and completed replies.

## Fourth Implementation Slice Boundary

The fourth implementation slice is limited to purchase task creation, helper
purchase completion or cancellation, face-check review, and completed-purchase
staging order preview. Staging review editing and explicit merge into
`main.orders` remain separate Slice 7 behavior.

Admin operations in this slice:

- Publish a purchase task manually from the task publishing page.
- Quick-publish a purchase task from exactly one quote/detail subtask in the
  live return feed.
- Confirm or fill LINE community nickname, product name, quantity, original JPY
  price, sale TWD price, reference photos, notes, and face-check requirement.
- Use customer nickname suggestions sourced from Supabase `main.customers`,
  while still allowing nicknames that are not in suggestions.
- Review helper purchase responses in the live return feed.
- Approve a face-check submission or request retake/replacement.
- See completed-purchase staging order preview data in the live return feed.

Helper operations in this slice:

- View purchase tasks grouped by product name + original JPY price + face-check
  required flag.
- Complete a non-face-check purchase, with optional report photos and notes.
- Confirm explicitly when completing a non-face-check purchase without report
  photos.
- Submit one or more face-check photos for face-check-required purchases.
- Respond to admin retake/replacement requests.
- Perform final confirmation after admin face-check approval.
- Cancel, mark unavailable, or mark not found with a required reason.
- Complete purchased partial quantities while explicitly resolving unpurchased
  remaining quantities.

Quick publish from quote/detail:

- Must convert one quote/detail subtask into one purchase task.
- Must not convert an entire multi-photo quote/detail task into one purchase
  task.
- Must carry the source quote/detail photo.
- Must carry helper detail reply photos when present.
- Must carry the quoted JPY price when present.
- Must preserve provenance linking the purchase task to the source quote task,
  quote task photo, and quote/detail reply.
- Must lock the source quote/detail response from direct helper rewrite after
  conversion.

Purchase task requirements:

- LINE community nickname is required.
- Product name is required.
- Quantity is required.
- Original product price in JPY is required.
- Sale price in TWD is required.
- At least one product/reference/source photo is required.
- Face-check required flag is required.

Non-face-check purchases:

- Report photos are optional.
- Notes are optional.
- Completing without photos requires an explicit confirmation prompt.
- Completed non-face-check purchases create staging order preview data.

Face-check purchases:

- The status flow is
  `open -> review_pending -> approved_pending_helper_confirmation -> completed`.
- Helper submission requires at least one face-check photo.
- Admin approval does not complete the purchase.
- Helper final confirmation after admin approval is required before completion.
- Only completed face-check purchases create staging order preview data.
- Admin retake or replacement requests keep the task pending for helper action.
- Same-group helper final confirmation may be batched only when every task in
  the batch has the exact same grouping key and is already admin-approved.

Cancellation, unavailable, and not-found behavior:

- Cancel/unavailable/not-found reason is required.
- `canceled`, `unavailable`, and `not_found` tasks do not create staging order
  preview data.
- Canceled purchase tasks do not reopen.
- If the item should be purchased again, admin creates a new purchase task
  linked through provenance and audit events.
- Routing canceled or unavailable purchases to private/public rebuy is deferred
  to the rebuy slice.

Partial quantity behavior:

- Partial quantity remains supported.
- Purchased quantities may be completed and create staging order preview data.
- Unpurchased remaining quantities must be explicitly canceled, marked
  unavailable/not found, or handled by a later rebuy path.
- Partial completion must not silently reduce or discard the original requested
  quantity without audit.

Staging and main-order boundary:

- Only `completed` purchase tasks can create staging order preview data.
- `open`, `review_pending`, `approved_pending_helper_confirmation`,
  `canceled`, `unavailable`, and `not_found` tasks must not create staging order
  preview data.
- Slice 4 does not write `main.orders`, `main.order_source_links`, or
  `main.order_photos`.
- Helper-generated order data remains staging workflow data until admin staging
  review and an explicit Slice 7 merge.

Retention and idempotency:

- Purchase report photos, approved face-check photos, source quote/detail
  photos, and helper detail photos linked to completed purchases are durable
  retained media.
- Retaken or rejected face-check photos that are not referenced by a completed
  purchase can follow temporary workflow media cleanup rules.
- Durable media records store private R2 `storage_key` values only. Signed URLs
  are generated on demand and must not be persisted as canonical data.
- Purchase completion, cancellation/unavailable/not-found reports, face-check
  submission, admin face-check review, helper final confirmation, and staging
  order preview creation must be idempotent where duplicate submission or retry
  can occur.

Acceptance for this slice must include mobile browser or equivalent mobile
viewport testing. It must verify manual purchase publishing, quick publish from
a single quote/detail subtask, same-trip quote/detail provenance, customer
nickname suggestions without exposing customer master data to helpers, grouped
helper purchase display, non-face-check completion with and without report
photos, face-check review and helper final confirmation, cancellation and
unavailable/not-found exclusion from staging, partial quantity handling,
completed-only staging order preview creation, helper ownership isolation,
inactive/ended/canceled trip blocking, R2 `storage_key` persistence, signed URLs
not persisted, audit events, idempotent duplicate retries, and no direct writes
to `main.orders`.
