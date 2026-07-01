# Helper Rewrite Confirmation Workflow

Last updated: 2026-07-01

This document lists the product and implementation decisions that must be confirmed
before or during the MINICHI helper rewrite. The source behavior is
`latest-helper-operation-spec.md`.

## Confirmed Decisions

### Round 23 confirmed on 2026-07-01

Slice 7 scope is confirmed as admin staging review and explicit merge from
reviewed helper staging data into the main operational order database:

- Only `ended` trips can be merged. Active trips may still expose staging
  preview/review work, but final merge waits until the trip is ended.
- Merge does not wait for settlement, payment, or warehouse approval.
- The first-version merge unit is one merge job per trip.
- Individual staging orders are soft-excluded from the merge with a required
  reason. The staging review UI must not hard-delete orders.
- Reviewed staging data is separate from helper source data. Admin corrections
  update reviewed staging records and audit rows; they do not rewrite helper
  purchase, quote/detail, face-check, or rebuy source responses.
- Admin-editable reviewed staging fields are customer nickname, product name,
  quantity, original JPY price, sale TWD price, notes, include/exclude state,
  exclude reason, and selected final order photos.
- If a customer nickname does not match `main.customers`, the UI warns the
  admin. The admin may explicitly confirm the unknown name and merge, but the
  merge flow does not automatically create a `main.customers` record.
- After admin approval, the reviewed snapshot is frozen. Any later edit revokes
  approval and requires review/approval again.
- Merge actions require expected-version checking, client idempotency keys, and
  retryable `failed` state handling. Duplicate retries must not create duplicate
  `main.orders`, source links, photo rows, or R2 copies.
- Main database writes are all-or-nothing inside the database transaction.
  Because R2 copies cannot be part of the same database transaction, final photo
  copy keys are deterministic and R2 copy steps must be idempotent/resumable.
- Merge writes only the admin-selected final order photos. Eligible selected
  photos can include purchase source/reference, quote/detail, helper purchase
  report, final approved face-check, and rebuy reference/report photos. Site
  photos, rejected/retaken face-check photos, settlement receipts, transport
  proof, and warehouse proof are not final order photos unless a later explicit
  product decision changes that boundary.
- Successful merge writes `main.orders`, `main.order_source_links`, and
  `main.order_photos`.
- After merge, the helper system shows the merged result as read-only. Any
  operational order edit belongs in the administrator order system.
- Staging workflow data remains available for a 7-day recovery window after
  merge, then may be archived or cleaned while preserving minimal audit records.
- The helper system does not provide a reverse-delete or rollback action that
  deletes merged `main.orders`.
- Review-only/internal admin fields must not become helper-visible. If existing
  staging preview rows are helper-readable, Slice 7 should store approval,
  exclusion, internal notes, selected final photos, and merge status in separate
  admin-only review tables or split RLS policies.

### Round 22 confirmed on 2026-06-29

Slice 6 scope is confirmed as private/public rebuy tasks, atomic public claim,
helper release back to the public pool, and rebuy checkout:

- Admins may create rebuy tasks manually or from `canceled`, `unavailable`, or
  `not_found` purchase tasks.
- Rebuy tasks created from purchase tasks preserve purchase, quote/detail,
  customer/order, price, photo, and audit provenance. One source purchase task
  must not have more than one active rebuy task at the same time.
- Public rebuy tasks must be claimed before shopping. The database atomically
  transitions `open -> claimed`; frontend duplicate-tap prevention is only a UX
  safeguard.
- After claim, a public task moves into the claiming helper's private work area
  and is no longer visible to other helpers.
- A helper who cannot buy an originally public claimed task may release it back
  to the public pool through `claimed -> open`.
- Release is allowed only for the current claiming helper before completion or
  checkout. It requires a reason, client idempotency key, expected version, an
  atomic conditional update, cleared claim fields, a refreshed
  `public_available_at`, and an audit event in the same transaction.
- Duplicate release with the same idempotency key returns the already accepted
  result. A stale version, a task claimed by another helper, or a task that has
  advanced beyond `claimed` must not be overwritten.
- Private rebuy tasks cannot be released into the public pool by helpers.
  Private reassignment or conversion to public remains an audited admin action.
- Public listings expose only product name, quantity, JPY price, reference
  photos, instructions, and creation/availability time. They do not
  expose LINE community nickname, TWD sale price, complete provenance,
  unrestricted customer data, or other helpers' data.
- Public listing order is newest publication first by `public_available_at`;
  initial publication uses creation time and a released task receives a new
  public availability time, so it returns to the front of the public list.
- Admins do not set a separate rebuy priority.
- The rebuy lifecycle is
  `open -> claimed -> completed -> checkout_pending ->
  settlement_in_progress -> settled`, with `canceled`, `unavailable`, and
  `not_found` as terminal alternatives.
- The first version does not support rebuy face-check. Report photos are
  optional; completion without a photo requires an explicit confirmation and
  audit event.
- Partial rebuy completion is allowed. The remaining quantity requires a
  reason, is not automatically republished, and may become a new
  provenance-linked rebuy task only through an admin decision.
- Completing a rebuy task records its result but does not yet materialize
  staging orders. Rebuy checkout atomically creates an already-ended checkout
  trip, completed purchase-equivalent records, staging order previews, and a
  settlement.
- One checkout includes all completed, not-yet-checked-out rebuy tasks owned by
  the helper. Duplicate checkout submissions must not create duplicate trips,
  staging previews, or settlements.
- A rebuy checkout has zero work hours. FX-rate and item-advance calculations
  reuse the confirmed settlement formulas; optional transport requires admin
  approval. The system must not invent departure/work timestamps.
- Before claim, admins may edit all task fields. After claim, a material change
  requires audited claim revocation and republication. After completion,
  corrections update reviewed staging data and do not rewrite the helper's
  source response.
- Rebuy checkout produces staging data only. Entry into `main.orders`,
  `main.order_source_links`, and `main.order_photos` still requires Slice 7
  admin review and an explicit merge.

### Round 21 confirmed on 2026-06-28

Slice 5 scope is confirmed as trip end, settlement, payment states, and
warehouse proof:

- Slice 5 includes helper trip end.
- Quote/detail subtasks that remain unfinished at trip end produce a warning but
  do not block ending the trip.
- Purchase tasks that remain unfinished block trip end until they are completed,
  canceled, marked unavailable, or marked not found.
- Trip end writes `ended_at`, blocks further helper live-task mutation, and
  guides the helper into settlement.
- Settlement uses Slice 4 completed purchase tasks and staging order preview
  data. It does not wait for `main.orders` merge and must not write final
  operational orders.
- Transport is optional. Helpers enter transport JPY amount and upload proof only
  when claiming transport; transport is included in payable totals only after
  admin approval.
- The 20,000 TWD split-payment threshold uses item advance TWD, not total
  payable amount.
- Settlements with item advance TWD at or below 20,000 are paid once.
- Settlements with item advance TWD above 20,000 are paid 50% first, then the
  remaining 50% after warehouse proof is approved.
- Admins cannot manually overwrite formula totals. Corrections must change
  source data such as orders, exchange rate, transport approval, work time, or
  review state, with audit events.
- After payment, helpers upload one warehouse proof photo plus optional note.
- Warehouse proof is reviewed by admin inside settlement. Large-settlement final
  payment waits for warehouse approval.
- Warehouse proof photos are retained long-term as `warehouse_evidence`; durable
  media records store private R2 `storage_key` values only.

### Round 20 confirmed on 2026-06-27

Slice 4 scope is confirmed as purchase task creation, face-check, cancellation,
and completed-purchase staging order preview:

- Slice 4 includes admin manual purchase task publishing.
- Slice 4 includes quick purchase publishing from a single quote/detail subtask.
- Slice 4 includes helper non-face-check purchase completion.
- Slice 4 includes helper cancellation, unavailable, and not-found reporting.
- Slice 4 includes face-check upload, admin approval or retake request, and
  helper final confirmation after admin approval.
- Slice 4 includes completed purchase task synchronization into staging order
  preview data.
- Slice 4 does not include staging review editing, final trip merge review, or
  explicit merge into `main.orders`; those remain Slice 7 behavior.
- Quick publish must be one quote/detail subtask to one purchase task, not an
  entire multi-photo quote/detail task to one purchase task.
- Quick publish must carry the source quote/detail photo, helper detail reply
  photos when present, quoted JPY price, and provenance linking the purchase task
  to the source quote task, quote task photo, and reply.
- Admin still confirms or fills LINE community nickname, quantity, sale TWD
  price, and face-check requirement before publishing a purchase task.
- Helper purchase grouping uses product name + original JPY price + face-check
  required flag. Same-group batch actions must not cross this grouping key.
- Partial quantity behavior is retained. Purchased quantities may complete and
  create staging order preview data; unpurchased remaining quantities must be
  explicitly canceled, marked unavailable/not found, or handled by a later rebuy
  path.
- Face-check uses
  `open -> review_pending -> approved_pending_helper_confirmation -> completed`.
- Admin face-check approval does not complete the task. The helper must perform
  final confirmation before the purchase becomes completed and before staging
  order preview data is created.
- `canceled`, `unavailable`, and `not_found` purchase tasks do not create
  staging orders.
- Canceled purchase tasks do not reopen. If the item should be purchased again,
  admin creates a new purchase task linked through provenance and audit events.

### Round 19 confirmed on 2026-06-26

Role-based UI reasonableness review is required for all new helper-system UI
slices:

- When implementing helper-facing screens, agents must review the UI from the
  helper's perspective while working on a phone during a live shopping trip.
- When implementing admin-facing helper-workflow screens, agents must review the
  UI from the admin's perspective while coordinating helpers and reviewing live
  returns.
- The current requirement is not visual polish. The minimum requirement is a
  reasonable, usable UI whose states, labels, next actions, and navigation make
  sense for the role.
- Helper screens must make pending, success, retry, blocked, inactive, ended,
  and canceled states understandable without exposing admin-only concepts or
  other helpers' data.
- Admin screens must make trip/helper/task context, pending review state, and
  available actions scannable, and must clearly separate live monitoring, task
  publishing, staging review, settlement/payment, and final merge actions.
- A slice is not complete if the interaction logic works but the screen is
  unreasonable for the role's real workflow.

### Round 18 confirmed on 2026-06-26

Slice 3 scope is confirmed as quote/detail task creation, per-photo helper
replies, and admin live return feed viewing of replies only:

- Slice 3 does not include purchase task creation or quick publish from a
  quote/detail item. Those start in Slice 4.
- Admin task publishing selects exactly one trip per publish action.
- A task can contain multiple photos, and one referenced photo creates one
  subtask.
- All subtasks in the same task must share one task type:
  `quote`, `detail`, or `quote_and_detail`.
- Task-level product name and instruction are optional.
- Photo-level product name and instruction are optional and override the
  task-level values for that photo.
- Quote replies require a JPY price.
- Detail replies require at least one detail photo.
- Quote-and-detail replies require both a JPY price and at least one detail
  photo.
- Reply notes are optional.
- Quote/detail replies and edits require client-generated idempotency keys.
- Server confirmation is the source of truth; optimistic UI must not mark a
  reply complete before the server confirms it.
- Helpers may edit already replied subtasks only while the trip is `active` and
  the response has not been converted into a purchase task.
- Once a quote/detail response is converted into a purchase task, the response
  is locked from direct helper rewrite.
- Admin edits must not clear or overwrite submitted helper replies.
- If an admin edit changes the meaning of an already submitted reply, the
  subtask must be marked `needs_review`.
- Task-referenced site photos become durable retained media.
- Helper detail reply photos are durable retained media.
- Media records store private R2 `storage_key` values as durable data. Signed
  URLs remain temporary presentation values and must not be stored as canonical
  data.

### Round 17 confirmed on 2026-06-23

Overall helper rewrite implementation will use eight vertical slices:

1. Helper account, trip assignment, departure, arrival, admin activation, and
   active-trip state.
2. Site photo batch upload to private R2 plus admin live return feed.
3. Quote/detail task creation and per-photo helper replies.
4. Purchase tasks, cancellation/unavailable handling, face-check, and staging
   order creation.
5. Trip end, settlement, payment states, and warehouse proof.
6. Private/public rebuy tasks and rebuy checkout.
7. Admin staging review and explicit merge into `main.orders`.
8. Production hardening and full dress rehearsal.

Slice 2 scope is confirmed as site photo batch upload plus admin live return
feed only:

- Slice 2 does not include creating quote/detail tasks from photos. That starts
  in Slice 3.
- Helpers can upload multiple photos in one batch from an active trip.
- Photo ordering must be preserved.
- Individual failed photo uploads must be retryable.
- Media uses private R2 only. Durable database records store R2 `storage_key`
  values; signed URLs are temporary display/share values and must not be stored
  as canonical data.
- Admin live return feed can view photo batches, mark selected photos as saved,
  and share or download photos through short-lived signed URLs.
- Slice 2 acceptance must include mobile/iPhone Safari or equivalent mobile
  browser testing.
- Slice 2 must verify duplicate submission/idempotency behavior, helper
  ownership isolation, inactive-helper blocking, ended/canceled trip blocking,
  R2 `storage_key` persistence, signed URLs not being persisted, and preserved
  photo order after retries.

### Round 16 confirmed on 2026-06-22

First-slice RLS and server-side authorization:

- Helper clients may directly read only their own helper profile and assigned
  trips when the helper profile is active.
- Inactive helpers may read only their own helper profile so the UI can show the
  inactive-account notice. They must not read trips.
- Helpers must not directly insert, update, or delete `helper_app.trips`.
- Helper departure and arrival must go through Server Actions that call
  server-side domain functions.
- The first admin identity check uses a server-side environment allowlist,
  `MINICHI_ADMIN_EMAILS`, initially containing `minichi.shop.tw@gmail.com`.
- Admin email addresses must not be hard-coded in source code.
- The first slice does not create `admin_profiles` or `admin_roles`.
- Admin create/deactivate helper, create trip, activate trip, cancel trip, and
  repair trip actions all go through Server Actions.
- Admin Server Actions must verify the Supabase session first, then verify the
  admin email allowlist.
- Service-role clients are restricted to server-only modules.
- Service-role access may be used only for admin operations, domain mutation
  transactions, and Auth user attachment/invite flows.
- Browser/client components must never import or receive a service-role client.
- RLS is enabled. Authenticated helpers may select their own profile, and active
  helpers may select their assigned trips.
- Helpers cannot insert, update, or delete trips or audit events through direct
  client access.
- Admin reads and writes are primarily guarded by server-side checks; RLS remains
  conservative and must not grant broad authenticated table access.
- `trip_audit_events` are written only by server-side domain functions in the
  same transaction as the state change.

### Round 15 confirmed on 2026-06-22

First-slice schema and migration details:

- The first helper-system migration belongs in
  `minichi_helper_system/supabase/migrations/`, not in the root legacy
  `supabase/migrations/` directory.
- The first slice uses an independent `helper_app` schema.
- The first slice creates only `helper_profiles`, `trips`, and
  `trip_audit_events`.
- The first slice does not create site photo, quote/detail, purchase, staging
  order, settlement, rebuy, or idempotency/submission tables.
- `helper_profiles` has `id uuid primary key`, nullable unique
  `auth_user_id` referencing Supabase `auth.users(id)`, `display_name`, `email`,
  compensation fields, bank fields, `region`, `is_active`, and timestamps.
- `helper_profiles` must not store legacy access keys or plaintext passwords.
- `trips` has `id uuid primary key`, `trip_name`, `business_date`,
  `scheduled_time time`, `location`, `timezone default 'Asia/Tokyo'`,
  `assigned_helper_id`, status and timing fields, `version integer default 1`,
  and timestamps.
- The first assignment model is `trips.assigned_helper_id`; no
  `trip_assignments` table is created in the first slice.
- Stale protection formally uses `trips.version` plus an `expectedVersion`
  precondition on every status mutation.
- `trip_audit_events` records both helper departure/arrival and admin
  activate/cancel/repair actions, including actor fields, action,
  before/after JSON state, optional reason, and timestamp.
- The first migration enables RLS. Helpers may read their own profile and
  assigned trips, while writes remain controlled by server-side domain
  functions. Admin access is guarded by server-side admin checks plus
  conservative RLS policy.
- The first slice does not create a generic idempotency/submission table.
  Departure and arrival use trip version and status transition rules; media,
  task, and purchase slices will introduce formal idempotency storage later.

### Round 14 confirmed on 2026-06-22

First vertical slice implementation breakdown:

- Implementation order is:
  schema/migration -> server domain functions -> Server Actions/API -> minimal
  UI -> tests/browser verification.
- The first slice is implemented as an independent Next.js web app under
  `minichi_helper_system/`, not inside the legacy vanilla prototype or the root
  compatibility `app/` shell.
- First-slice tables are limited to `helper_profiles`, `trips`, and
  `trip_audit_events`, plus only the minimal version/idempotency data needed for
  stale-action or replay protection.
- The first slice must not create site photo, quote/detail, purchase, staging
  order, settlement, or rebuy tables.
- `helper_profiles.auth_user_id` maps to Supabase `auth.users.id`.
- Admins may create helper profiles before Auth setup is complete. The Auth user
  can be attached later through invite/password reset or secure server-side user
  creation.
- Plaintext passwords must not be stored, and legacy helper access keys are not
  part of the new helper system.
- Trip status transitions must be owned by server-side domain functions, not by
  frontend-only logic.
- Each trip needs `version` or an equivalent precondition to prevent stale
  actions from overwriting newer state.
- Admin activate, cancel, and repair actions must write `trip_audit_events`.
- The first admin UI is limited to helper list/form, trip form/list, arrived-trip
  activation, and minimal cancel/repair entry points.
- The first helper UI is limited to login, inactive notice, today/upcoming/history
  trips, departure, arrival, waiting-for-active state, and active workspace
  placeholder.
- Testing order is domain/server tests first, then Server Action/API integration
  tests, then mobile-viewport browser flow verification.
- The first slice does not require R2 tests because it has no media flow.

### Round 13 confirmed on 2026-06-22

First vertical slice implementation boundary:

- The first implementation slice is limited to helper account, trip assignment,
  and the trip status flow `scheduled -> departed -> arrived -> active`.
- The first implementation slice excludes site photos, quote/detail tasks,
  purchase tasks, settlement, rebuy, staging review, and merge.
- The required admin operations are helper profile creation and deactivation,
  trip creation, helper assignment, trip status viewing, arrived-trip activation,
  cancellation, and audited status/time repair.
- The required helper operations are Supabase Auth email/password sign-in,
  inactive-account notice, own-trip-only visibility, trip grouping by trip
  timezone, departure marking, arrival marking, waiting for admin activation, and
  an active-trip workspace placeholder.
- Helper Auth account setup is tied to admin-created helper profiles. Passwords
  must be set through invite/password reset or secure server-side creation; fixed
  passwords must not be committed, and legacy access keys remain excluded.
- Acceptance must verify helper isolation, inactive-helper access blocking,
  helper inability to activate trips, audited admin activation, trip-timezone
  grouping, stale action protection, and server-confirmed completion states.

### Rounds 1-12 confirmed on 2026-06-22

Product scope and launch target:

- The first phase includes only the admin operations required to run the helper
  workflow, not a full administrator system rewrite.
- The new helper system will be an independent web app under
  `minichi_helper_system/`.
- The first accepted vertical slice ends at:
  admin creates helper/trip -> helper logs in -> helper sees today's assigned trip
  -> helper marks departure/arrival -> admin confirms active.
- The first business slice ends at:
  site photo batches -> quote/detail tasks -> purchase tasks -> staging order
  creation.
- The old prototype remains usable during development. It is a behavior and UX
  reference only; the new system should not copy its backend architecture, local
  JSON runtime, global frontend state model, or `public/uploads` media path.
- The old prototype's admin/helper interaction flow is broadly correct except
  for later-confirmed workflow changes. Its UX intent may be referenced, but the
  new design should be built fresh.

Account, permission, and visibility:

- The first version uses Supabase Auth email/password.
- Legacy helper access keys have no role in the new system and remain only in
  the old prototype.
- Inactive helpers may sign in, but they only see an inactive-account notice and
  cannot read or mutate trips, tasks, settlements, rebuy data, or other work data.
- Helper payment/bank data is admin-managed in the first version; helpers do not
  edit it themselves.
- The first version has one admin role, while the data model should remain ready
  for multiple admins or more granular permissions later.
- The initial admin account email is `minichi.shop.tw@gmail.com`. The password
  must be set through Supabase invite/password reset or a non-committed
  environment seed; do not commit a fixed password.
- Helpers can see only their own profile, assigned trips, tasks under those
  trips, own settlements, own private rebuy tasks, and the minimum fields needed
  to claim public rebuy tasks.
- Helpers must not see other helpers' private data, unrestricted customer master
  data, merge controls, or final operational orders.

Trip state machine and timing:

- Trip grouping into today/upcoming/history uses the trip timezone. Japan live
  shopping trips normally use `Asia/Tokyo`.
- Admins operate from Taiwan, but admin-local time is display-only. Business
  grouping and state logic must use the trip timezone.
- Trip statuses are `draft`, `scheduled`, `departed`, `arrived`, `active`,
  `ended`, and `canceled`.
- The first vertical slice must at least implement
  `scheduled -> departed -> arrived -> active`.
- Helpers may mark departure and arrival but cannot activate a trip.
- Admin confirms an arrived trip into active and can cancel, force end, and
  repair status or time fields.
- Site photo, quote/detail, purchase, and other live work functions are available
  only after the trip becomes active.
- Hourly settlement uses `departed_at -> ended_at`, including travel/work time.
  Transport fees remain separate transport claims or allowances.
- Trip records retain `departed_at`, `arrived_at`, `admin_activated_at`, and
  `ended_at`.
- Ended or canceled trips expose only a helper-visible history summary and
  settlement navigation. Helpers cannot mutate tasks after end/cancel.
- Admin status changes, force actions, and time repairs must write audit events.

Media, R2, and retention:

- All new helper-system media uses private R2. The new system does not use
  `public/uploads`.
- Database records persist durable R2 `storage_key` values. Signed URLs are
  generated on demand for display/share and must not be stored as canonical data.
- Site photos are `temporary_work_media` by default and are eligible for cleanup
  after 10 days.
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

Quote/detail task behavior:

- Helpers may edit already replied quote/detail subtasks only while the trip is
  `active` and the quote/detail response has not been converted into a purchase
  task.
- Quote/detail edits keep the current value and write audit events. The first
  version does not need a full version-history UI.
- Once a quote/detail response has been converted into a purchase task, the
  response cannot be directly rewritten. Admins must use a correction or
  supplemental workflow instead.
- Admins may edit task-level information and add new subtasks, but they must not
  silently clear or overwrite submitted helper replies.
- If an admin edit affects the meaning of an already submitted reply, the
  subtask must be marked `needs_review` or otherwise show that the task changed.
- Display-name fallback is:
  photo product name -> task product name -> task type default title.
- Instruction fallback is:
  photo instruction -> task instruction -> empty.
- Quote/detail reply photos, task-referenced photos, and photos carried into
  purchase tasks are durable retained media, not temporary 10-day site photos.

Purchase task, face-check, and cancellation behavior:

- Product autofill matches only quote/detail results from the same trip.
- Quick publish from quote/detail must carry source images, helper detail photos,
  quoted JPY price, and provenance.
- Purchase grouping key is:
  product name + original JPY price + face-check required flag.
- The first version keeps partial quantity behavior. Purchased quantities can be
  completed and generate staging orders; unpurchased remaining quantities must be
  canceled, marked unavailable/not found, or routed to rebuy.
- Non-face-check purchases may be completed without report photos, but the UI
  must show a confirmation prompt and the system must write an audit event.
- Face-check purchase flow is:
  `open -> review_pending -> approved_pending_helper_confirmation -> completed`.
- Admins can request retake/replacement, keeping the task pending for helper
  action.
- Admin face-check approval does not complete the task. Helper final
  confirmation is still required.
- Helper final confirmation may support same-group batch confirmation only when
  the grouping key matches exactly and every task is admin-approved.
- Canceled, unavailable, and not-found tasks do not generate staging orders.
- Canceled tasks do not reopen. If the item should be purchased again, admin
  creates a new purchase task linked back through provenance/audit.
- Only completed purchase tasks can generate staging orders.
- Purchase report photos, approved face-check photos, and linked source/detail
  photos are durable retained media.
- Rejected or retaken face-check photos that are not referenced by the final
  order can follow temporary workflow media cleanup after 10 days.

Live return feed behavior:

- The first version uses scoped polling or scoped refresh, not Supabase
  Realtime.
- Supabase Realtime is deferred until core write paths and read models are
  stable.
- Admins can monitor multiple selected trips at the same time.
- The default live feed scope is active or otherwise current operational trips.
  Historical trips are filterable, but they are not the primary view.
- The first live feed supports site photo viewing and sharing, quote/detail
  reply viewing, quick purchase publishing from quote/detail, manual purchase
  task publishing, purchase response monitoring, face-check approval or retake
  request, and completed-purchase staging-order preview.
- Admin edits before merge update reviewed staging data, not helper source
  replies.
- Admin-editable reviewed staging fields are customer nickname, product name,
  quantity, original JPY price, sale TWD price, notes, and order photos or
  selected retained photos.
- Every admin edit writes audit events.
- Live return feed does not perform final merge into `main.orders`. Merge
  remains an explicit review action.

Staging, merge, and main-order boundaries:

- Helper-generated orders remain staging data until admin order review and an
  explicit merge.
- Only ended trips can be merged. Normal live-trip order merge can happen after
  admin order review is complete; settlement, payment, and warehouse completion
  are not required for the normal live-trip order merge.
- The first-version merge unit is one trip-level merge job per trip.
- Admins may soft-exclude individual staging orders before approving a trip
  merge job. Exclusion requires a reason; the staging review UI must not
  hard-delete orders.
- Reviewed staging data stays separate from helper source task/reply data.
- Staging review uses the same reviewed staging editable fields as live return
  feed: customer nickname, product name, quantity, original JPY price, sale TWD
  price, notes, include/exclude state, exclude reason, and selected final order
  photos.
- Unknown customer nicknames warn the admin. Admins may explicitly confirm the
  unknown name and merge, but the merge flow does not automatically create
  `main.customers` records.
- Admin approval freezes the reviewed snapshot. Any later edit revokes approval
  and requires review/approval again.
- Staging review edits must not silently overwrite helper source task or reply
  data.
- Merge uses expected-version checks, client idempotency keys, and retryable
  failed-state recovery.
- Main database writes are all-or-nothing. R2 final-photo copies use
  deterministic keys and idempotent retry because object storage cannot share
  the database transaction.
- Merge writes helper-generated operational data into `main.orders`,
  `main.order_source_links`, and `main.order_photos`.
- Merge writes only admin-selected final order photos.
- Helper provenance is canonical in `main.order_source_links`, not required
  fields on `main.orders`.
- Rebuy checkout orders follow the same
  `staging -> admin review -> explicit merge` rule.
- Post-merge edits belong in the administrator order system, not the helper
  workflow. The helper system shows merged data as read-only and does not offer
  reverse deletion of merged main orders.
- After successful merge, staging workflow data keeps a 7-day recovery window,
  then can be archived or cleaned while preserving minimal merge audit records.
- Live return feed and staging review cannot directly create final
  `main.orders` without an explicit merge action.

Settlement formulas and payment states:

- Settlement stores the day exchange rate as `jpy_to_twd_rate`; formulas convert
  JPY to TWD as `JPY amount * jpy_to_twd_rate`.
- The day exchange rate means the JPY-to-TWD market rate for the settlement day.
  The system may fetch it from an online exchange-rate source during settlement,
  then store the selected rate used for calculation.
- Hourly settlement uses `departed_at -> ended_at`, including travel/work time.
- Transport claims are entered only when claimed. Helpers enter transport amount
  in JPY and upload proof; the amount converts to TWD using `jpy_to_twd_rate`.
- Transport claims require admin approval before they are included in payable
  totals.
- The 20,000 TWD split-payment threshold uses the item advance amount, not the
  total payable amount.
- Settlements at or below the 20,000 TWD item-advance threshold are paid once.
- Settlements above the 20,000 TWD item-advance threshold are paid 50% first,
  then the remaining 50% after warehouse report approval.
- Large-settlement second payments require their own transfer notification text.
  Every payment records paid amount, paid time, and transfer notification text.
- Admins cannot directly overwrite formula totals. Admin corrections must change
  source data such as orders, transport claim, work time, exchange rate, or review
  state, with audit events.

Rebuy behavior:

- Rebuy does not support face-check in the first version.
- Completed rebuy orders create staging data and may be merged before rebuy
  settlement/payment is complete, but only after admin review and an explicit
  merge action.
- Public rebuy ordering is newest publication first. Admins do not set a
  separate rebuy priority.
- Admins may reassign private rebuy tasks only before completion, checkout, or
  merge-related review state; reassignment must write audit events.
- Public rebuy claim must be atomic at the database layer. Frontend duplicate-tap
  prevention is only a helper UX safeguard.
- Rebuy checkout creates an already-ended checkout trip named
  `{date} {helper name} 的補買結帳` and follows the normal settlement flow.

Mobile UX, retry, and idempotency:

- The helper app is mobile-browser first.
- The first version supports weak-network retry and draft preservation, but does
  not implement a full offline queue.
- Every formal helper submission must include a client-generated idempotency key.
- Duplicate taps, page refreshes, timeout retries, and resubmissions must not
  create duplicate task results, photo records, purchase completions, or staging
  orders.
- Media upload supports per-photo status, failed-photo retry, preserved ordering,
  and continuing other work while uploads continue.
- Form drafts are preserved at least on the same device and browser until the
  submission succeeds or the helper explicitly clears the draft.
- If server state changed since the draft or submission began, such as trip
  ended, task canceled, or quote converted to purchase, retries must not
  overwrite the newer state. The server returns a clear error and asks the
  client to refresh.
- Server confirmation is the source of truth for completed states. Optimistic UI
  may show only pending or temporary states and must not mark formal work
  complete before server confirmation.

Slice-specific tests and acceptance:

- Every implementation slice must pass the fixed common gate: helper/admin
  permissions, staging/main boundary, R2 `storage_key` persistence, signed URLs
  not persisted, audit events, idempotency/duplicate retry, server-confirmed
  completion, and stale-error handling that does not overwrite newer server
  state.
- Every slice must define slice-specific acceptance criteria. A slice is not
  complete merely because the screen is operable.
- Test layering uses domain/service or server-side unit tests, API/Server Action
  integration tests, browser flow tests, and selective Supabase/R2 cloud
  acceptance for auth, R2, merge, atomic-claim, and idempotency-critical paths.
- Helper-facing slices must include mobile viewport or mobile browser
  acceptance. Flows involving photos, sharing, drafts, or weak-network retry
  must be tested on iPhone Safari or an equivalent mobile environment.
- Any flow that creates order data must verify that helper workflow actions
  produce staging data only, do not directly write `main.orders`, and can enter
  `main.orders` only through an admin explicit review and merge action.
- R2 media acceptance must verify that durable database fields use private
  `storage_key` values, signed URLs are display/share-only, and upload retry
  does not create duplicate photo records or reorder photos.
- Every formal helper submission must verify that resubmitting the same
  idempotency key does not create duplicate data.
- After all slices are complete, the project must run a full dress rehearsal:
  helper/trip -> active -> site photos -> quote/detail -> purchase/face-check
  -> staging order -> admin review -> merge -> settlement/warehouse/rebuy
  relevant flow.

## Confirmation Process

Use this sequence before implementation and before each vertical slice:

1. Confirm product scope and launch target.
2. Confirm account, permission, and visibility rules.
3. Confirm trip state machine and timing semantics.
4. Confirm media/R2 retention rules.
5. Confirm quote/detail task behavior.
6. Confirm purchase task behavior, face-check, and cancellation.
7. Confirm live return feed behavior.
8. Confirm staging, merge, and main-order boundaries.
9. Confirm settlement formulas and payment states.
10. Confirm rebuy behavior.
11. Confirm mobile UX and retry/idempotency expectations.
12. Confirm slice-specific tests and acceptance criteria.

## Product Scope Decisions

- Whether the rewrite includes all helper-related admin pages in the first phase:
  home/trip management, task publishing, rebuy, live return feed, and settlement.
- Whether `minichi_helper_system/` becomes an independent Next.js app or the rewrite is integrated into the existing Next.js shell.
- Whether the first releasable version must complete a full live session through settlement and merge, or stop at active trip through staging order creation.
- Whether the old helper prototype must remain usable during development.
- Which features are first-version requirements:
  Supabase Auth helper login, direct R2 upload, multi-trip live monitoring, Web Share/LINE sharing, rebuy, settlement, and warehouse report.

Recommended default unless overridden:

- Build in `minichi_helper_system/` as a clean Next.js app.
- Keep the old prototype untouched during rewrite.
- First vertical slice ends at active trip state.
- First business slice after that reaches site photos, quote/detail, purchase, and staging order before settlement/merge.

## Account And Permission Decisions

- Whether Supabase Auth email/password is mandatory in the first slice.
- Whether helper bank edits require admin approval.
- Whether admin is a single admin role at first or multi-admin/permission-ready.
- Exact helper visibility for settlements, rebuy, warehouse report, and issue report.
- Whether helper account activation/deactivation immediately blocks login and actions.

Recommended default unless overridden:

- Use Supabase Auth email/password as the target model.
- Preserve a narrow migration path only if needed for development.
- Treat helper bank edits as pending admin review if payment data changes after initial setup.

## Trip And Timing Decisions

- Which timezone defines today/upcoming/history; default should be trip timezone.
- Whether admin can force-end or repair trip states.
- Whether live/work time starts at departure or admin-confirmed active start.
- Which time span is used for hourly settlement.
- Whether historical trips can expose anything except settlement navigation.

Recommended default unless overridden:

- Group trips by trip timezone, normally `Asia/Tokyo`.
- Use departure-to-end as helper payable work time only if the business wants travel paid; otherwise active-to-end.
- Allow admin repair through audited admin-only actions.

## Media And Retention Decisions

- Whether admin needs a manual retain/delete control for temporary photos.
- Whether Web Share API is enough for first-version LINE/iPhone sharing.
- Whether warehouse proof photos are retained permanently or follow temporary workflow retention.
- Exact cleanup job schedule for 10-day temporary media.

Recommended default unless overridden:

- Use Web Share API first.
- Store only R2 `storage_key` as durable media data.
- Add retention classification fields early, then implement cleanup jobs after workflow slices stabilize.

## Quote And Detail Decisions

- Whether helpers may edit already replied quote/detail subtasks.
- Whether quote/detail edits need versioned history or only audit events.
- Whether task-level optional product/instruction fallback title rules need fixed wording.
- How admin edits to a task affect already submitted helper replies.

Recommended default unless overridden:

- Allow edits while preserving audit events.
- Do not delete prior media on edit unless an explicit cleanup action runs.

## Purchase Decisions

- Product autofill matching scope:
  same trip, same helper, or global history.
- Purchase grouping key:
  product name only, product name plus JPY price, product name plus image, or product name plus face-check flag.
- Whether partial completed quantities remain supported in the new UX.
- Whether canceled purchase tasks can be reopened or must become rebuy only.
- Whether helper final confirmation after face-check approval can be batched or must be per order.

Recommended default unless overridden:

- Match product autofill within the same trip.
- Group purchases by product name plus JPY price plus face-check flag.
- Keep partial quantity behavior only if needed for current operations; otherwise require complete/cancel per command for simpler mobile UX.

## Live Return Feed Decisions

- Whether live updates use polling, Supabase Realtime, or scoped refresh/revalidation.
- Whether admin edits in live return feed immediately update staging order data.
- Which fields admin may edit before merge.
- Whether live return feed can monitor trips across dates or only current active trips.

Recommended default unless overridden:

- Start with scoped polling or scoped refresh for reliability.
- Add Supabase Realtime only after core writes and read models are stable.
- Allow admins to monitor multiple selected trips, with active/current trips as
  the default scope and history available by filter.
- Admin edits before merge update reviewed staging data, not helper source
  replies, and write audit events.
- Keep final merge out of live return feed; merge remains an explicit staging
  review action.

## Staging And Merge Decisions

- Whether merge can happen after admin order review, or only after settlement completion.
- Which order fields admin can modify before merge.
- Whether merge after rebuy checkout follows the same timing as live-trip merge.
- Whether post-merge edits belong in the helper system or administrator order system.

Recommended default unless overridden:

- Keep helper-generated data in staging until admin order review is complete.
- Let admin order review trigger explicit trip-level merge jobs without waiting
  for settlement, payment, or warehouse completion.
- Let admins exclude or delete individual staging orders before approving a
  trip merge job.
- Keep helper provenance canonical in `main.order_source_links`, not required
  fields on `main.orders`.
- Let post-merge operational edits live in the administrator order system, not
  the helper workflow.
- Keep a 7-day post-merge staging recovery window before archive or cleanup.

## Settlement Decisions

- Exchange-rate direction for converting JPY to TWD.
- Whether hourly settlement time starts at departure or active live start.
- Whether transport claims require admin approval.
- Whether the 20,000 TWD threshold uses total payable amount or only item advance amount.
- Whether large-settlement final payment requires a second transfer notification.
- Whether admin can edit settlement formulas manually or only source order/transport data.

Recommended default unless overridden:

- Store the exchange rate as a named JPY-to-TWD conversion rate for formulas.
- Use item advance TWD for the 20,000 TWD threshold.
- Require admin approval for transport claims.

## Rebuy Decisions

- Whether rebuy can require face-check; if yes, reuse block-three purchase behavior exactly.
- Whether completed rebuy orders can merge before rebuy settlement is paid.
- Whether public rebuy visible order should be FIFO, newest first, or priority-based.
- Whether admin can reassign private rebuy after creation.

Recommended default unless overridden:

- Reuse non-face-check purchase task behavior; rebuy does not support
  face-check in the first version.
- Public claim must be atomic in Supabase.
- Allow the current helper to atomically release an originally public,
  still-claimed task back to the public pool with a required reason,
  idempotency, version checking, and an audit event.
- Rebuy checkout creates an ended checkout trip and follows normal settlement.

## Testing And Acceptance Decisions

Every slice must include focused acceptance for:

- Helper ownership and permission isolation.
- Staging/main boundary.
- R2 `storage_key` persistence.
- Signed URLs not persisted as durable data.
- Audit events for status changes, admin edits, and formal submissions.
- Idempotency and duplicate-tap retry.
- Server-confirmed completion, with optimistic UI limited to pending or
  temporary states.
- Stale retry or stale draft conflicts that do not overwrite newer server state.
- Mobile upload retry where media is involved.
- Slice-specific business criteria beyond basic screen operability.

Vertical slice order:

1. Admin creates helper and trip; helper logs in, sees today trip, marks departure/arrival, admin confirms active.
2. Helper uploads R2 site photo batches; admin views, saves, shares, and downloads in live return feed.
3. Admin creates quote/detail tasks; helper replies per photo.
4. Admin creates purchase tasks; helper completes/cancels; face-check flows through admin approval and helper final confirmation; completed tasks create staging orders.
5. Trip settlement, payment, and warehouse report.
6. Private/public rebuy and rebuy checkout.
7. Admin staging review and merge to `main.orders`.
8. Production hardening, mobile/manual acceptance, performance checks, cleanup policy, deployment readiness, and full dress rehearsal.
