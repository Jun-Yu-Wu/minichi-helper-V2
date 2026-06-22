# Backend Rewrite Goals

The helper rewrite exists to preserve approved behavior while replacing the legacy backend and data flow. The product problem is backend/data architecture and performance, not a workflow redesign.

References:

- `docs/project-map.md`
- `docs/helper-system.md`
- `docs/data-boundary-and-merge.md`
- `docs/database-plan.md`
- `docs/implementation-progress.md`
- `server.js`
- `lib/cloud-state-store.js`
- `lib/cloud-face-check.js`
- `lib/workflows/*`
- `minichi_helper_system/docs/rewrite/cross-region-mobile-runtime.md`

## Why Rewrite

The current system began as a local Node prototype and later gained Supabase/R2 compatibility. It now proves behavior, but its architecture is carrying prototype assumptions:

- Many actions still flow through legacy route adapters and whole-app compatibility state.
- Local JSON and local upload concepts remain in the runtime shape even though they are no longer product runtime options.
- Some cloud mutations still pay high latency from repeated broad reads, broad writes, and client lifecycle overhead.
- Frontend state and routing are centralized in one browser script, making scoped UI loading and invalidation hard.
- Catch-all API routing preserves compatibility but does not express domain boundaries clearly.
- Media references still need a strict separation between durable private R2 keys and temporary signed display URLs.

The rewrite should make the approved workflows faster, safer, easier to test, and easier to operate in cloud-only production.

## Non-Goals

- Do not redesign the helper workflow.
- Do not implement application code as part of this planning package.
- Do not copy the legacy backend architecture.
- Do not add a local JSON runtime.
- Do not expose main DB data or merge controls to helper UI.
- Do not make helper-only provenance required on `main.orders`.
- Do not remove staging review or approved merge.

## Legacy Patterns Not To Copy

Do not copy these implementation patterns:

- `readDb()` / `writeDb()` whole-app object mutation as the primary runtime model.
- `data/db.json` as runtime state.
- `public/uploads/` as durable media storage.
- Legacy `trip` compatibility object as the source of truth.
- One catch-all API handler for unrelated domains.
- Full app-state payloads for high-frequency helper actions.
- Broad snapshot hydration before every scoped mutation.
- Mutating nested arrays in memory and syncing aggregate objects back wholesale.
- Long-lived global frontend state as the source of navigation and workflow truth.
- Base64 photo upload as the primary media path.
- Signed URL persistence as durable media data.
- Rebuy in-process locks as the only concurrency control.

## Runtime Rules

### Supabase Only For Data

- Product runtime data must live in Supabase.
- Use normalized staging tables for helper workflow state.
- Use `main.*` only through approved admin/import/merge paths.
- Helper-facing reads must be scoped by authenticated helper id and assigned trip/task ownership.
- Helper-facing writes must affect staging/helper-owned records only.
- Mutations should update exactly the domain rows required for the action.
- Use PostgreSQL constraints, transactions, row ownership checks, and optimistic concurrency where needed.

### Private R2 Only For Durable Media

- Durable photos/files must be stored in private R2.
- Database records must store `storage_key` and metadata.
- Signed URLs are generated only for presentation and must expire.
- Route Handlers may presign upload/download URLs.
- Server-side merge/copy jobs may copy retained media from staging keys to main keys and audit the copy.
- Base64 fallback may exist only as a temporary migration or compatibility fallback, not a first-line path.

### Cross-Region Mobile Reliability

- Helpers are usually in Japan on mobile networks; admins are usually in Taiwan.
- Every high-frequency helper action must expose clear pending, success, retryable failure, and blocked failure states.
- Photo selection must show immediate local preview before upload completes.
- Photo upload must be retryable without losing the local draft.
- Direct R2 upload should not block other UI work.
- Server writes for helper submissions must be idempotent with client-generated `submission_id` values.
- Purchase response and face-check response must deduplicate staging side effects.
- Database timestamps must be UTC.
- Trips must store a business timezone, usually `Asia/Tokyo`, and admin UI must display trip-local time where relevant.
- Deployment regions for Supabase, Vercel, and R2/custom domains should be chosen and measured for Taiwan/Japan usage.

### Staging/Main Boundary

- Helper actions write staging workflow data.
- Helpers never write `main.orders`.
- Helpers never receive unrestricted `main.orders` or `main.customers` access.
- Runtime nickname suggestions may read approved customer master suggestion data through a scoped server boundary, but helper clients do not receive broad customer records.
- Admin review and approved merge are the only helper-generated path into `main.orders`.
- Helper provenance is canonical in `main.order_source_links`.

### Next.js Backend Shape

Prefer these boundaries:

- Server Components for read-heavy authenticated pages and dashboards.
- Server Actions for internal form/mutation workflows initiated by rendered pages.
- Route Handlers for real HTTP boundaries: upload presign, webhooks, file downloads/redirects, mobile/background clients that are not form submissions, and compatibility APIs during migration.

Avoid building a new catch-all backend. Each domain should have a small server module with typed inputs, ownership checks, and transaction-scoped data access.

## Performance Goals

The current cloud acceptance notes show high latency for several endpoints, including purchase task response, face-check approval, staging edits, finalize trip, and merge approval. The rewrite should treat high-frequency helper actions as fast, scoped operations.

Targets for helper-facing actions on a warm deployment, excluding the actual browser-to-R2 file transfer time:

| Action | Target p50 | Target p95 | Notes |
| --- | ---: | ---: | --- |
| Helper dashboard read | <= 500 ms | <= 1200 ms | Scoped helper summary, assigned trips, settlement/rebuy counts. |
| Trip workspace read | <= 700 ms | <= 1500 ms | One trip, visible task summaries, signed URLs only for visible media. |
| Trip status update | <= 300 ms | <= 800 ms | Single trip status/timeline transaction. |
| Create site photo batch | <= 300 ms | <= 800 ms | Metadata only; photos upload separately to R2. |
| Attach uploaded site photo metadata | <= 300 ms | <= 900 ms | One photo row plus batch/trip summary update. |
| Quote/detail reply | <= 500 ms | <= 1200 ms | One task-photo response plus task status summary. |
| Purchase task response | <= 600 ms | <= 1500 ms | One task update plus staging-order side effect when eligible. |
| Grouped purchase response | <= 900 ms | <= 2000 ms | Batched task updates plus staging-order side effects. |
| Not-found/unavailable | <= 500 ms | <= 1200 ms | Task status update, no staging order. |
| Face-check helper submit | <= 600 ms | <= 1500 ms | Moves task to review pending, no staging order. |
| Face-check admin approval | <= 700 ms | <= 1800 ms | Approval plus staging-order side effect. |
| Rebuy report public/private | <= 600 ms | <= 1500 ms | Public claim must be atomic. |
| Rebuy checkout | <= 1200 ms | <= 3000 ms | Creates checkout trip/tasks/settlement/merge job. |
| Settlement precheck submit | <= 900 ms | <= 2500 ms | Claims/receipts metadata, settlement status, recompute summary. |

Operational targets:

- Avoid repeated full cloud reads within a single request.
- Keep transaction work bounded and measurable.
- Batch related inserts/updates.
- Generate signed URLs lazily or cache them briefly by `storage_key`.
- Record lightweight timing for slow Server Actions and Route Handlers.
- Design each action so mobile users see a fast acknowledgement and clear retry state.
- Treat purchase and face-check submit as immediate local-pending UI, with server confirmation ideally under 2s.
- Treat photo upload as progress-based background work with retry, not as a full-screen blocking step.
- Prefer admin approval under 3s, but never trade off correctness or idempotency for speed.

## Data Access Principles

- Read models should be page-specific, not app-wide.
- Mutation inputs should contain ids and fields for one action, not whole nested objects.
- High-frequency mutation inputs should include a client-generated `submission_id`.
- Server modules should enforce ownership and state-machine transitions before writing.
- Staging order generation should be deterministic and idempotent per source purchase task.
- Public rebuy claim must be atomic in the database, for example by conditional update on `status = 'open'`.
- Face-check approval must be atomic with staging-order eligibility updates.
- Settlement recomputation should be server-side and deterministic.
- Every action that changes business state should write a compact audit/timeline event.

## Recommended Implementation Sequence

1. Scaffold the Next.js helper app shell and shared server configuration in `minichi_helper_system/`.
2. Define Supabase staging table access modules and R2 media helpers without UI changes.
3. Implement helper auth/session and helper dashboard read model.
4. Implement trip list and trip status vertical slice.
5. Implement direct R2 upload presign plus site photo batch metadata.
6. Implement quote/detail task list and per-photo reply.
7. Implement purchase task single response, staging-order side effect, and exclusion rules.
8. Add face-check helper submit and admin approval path.
9. Add not-found/unavailable and admin route-to-rebuy.
10. Add rebuy private/public report with atomic public claim, then rebuy checkout.
11. Add settlement precheck, correction, final confirm, and warehouse proof.
12. Add admin review/merge compatibility only after helper staging paths pass acceptance.
13. Add broad mobile/manual acceptance and retire legacy compatibility surfaces slice by slice.
