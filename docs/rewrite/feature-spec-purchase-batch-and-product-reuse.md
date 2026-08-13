# New Feature Spec: Purchase Batch Aggregation and Product Reuse

Status: Confirmed product direction; quick-publish history reuse confirmed

Confirmed: 2026-07-24; quick-publish history reuse: 2026-08-11

Quick-publish history reuse confirmed: 2026-08-11

Scope: New MINICHI helper system, administrator purchase publishing and helper
purchase task display. This feature does not change the staging-to-admin-review-
to-explicit-merge boundary and does not write directly to `main.orders`.

## 1. Product Goal

Reduce repeated administrator data entry for popular products while allowing the
helper to purchase the current outstanding quantity without exposing the
customer-level order list.

The feature has two connected but separate parts:

1. Administrator product reuse: previously published product data and photos in
   the current connection can be suggested and reused when creating another
   purchase task.
2. Helper purchase batches: customer purchase tasks for the same product are
   aggregated into a batch that remains open for additions until the batch is
   fully resolved.

The helper batch is an operational coordination layer. Customer-level purchase
tasks remain separate source records so that staging previews, provenance,
settlement, audit, and later merge review remain correct.

## 2. Terms

### Product family

The same operational product identity within one connection. The identity should
come from the selected/reused product data, not from a raw display-name match
alone. Product name, product type, original JPY price, face-check requirement,
and material variant/specification must be compatible before tasks can share a
batch.

### Purchase batch

A helper-facing group of customer purchase tasks for one product family. The
initial customer orders use the base title. Later batches use the same title with
an explicit suffix:

```text
浴衣漢頓
浴衣漢頓－加單1
浴衣漢頓－加單2
```

The suffix represents a new batch after the previous batch was closed. It does
not represent every individual administrator publish action.

### Closed batch

A batch is closed only when its outstanding work is fully resolved. Full quantity
completion closes it; an explicitly resolved remainder such as canceled,
unavailable, or not-found also closes the relevant work. A partial report alone
does not close the batch.

## 3. Administrator: Product Reuse

### 3.1 Suggestion source and scope

- The initial suggestion source is purchase tasks already published in the
  current connection/trip.
- Both manual publishes and quick publishes from quote/detail are eligible.
- Suggestions are scoped to the current connection. They must not expose or
  silently reuse products from another helper's private scope or an unrelated
  connection.
- The initial implementation may query prior published tasks directly. A
  separate global product-template table is not required for this feature.

### 3.2 Product-name input behavior

The product-name field behaves like the existing customer-nickname suggestion
field:

- When focused while empty, show recent published products, with the most
  recently published product first.
- When text is entered, filter suggestions using the entered text.
- Rank exact matches first, then prefix matches, then contains matches; within
  the same match quality, sort newest publication first.
- A suggestion is selected explicitly by click/tap, keyboard Enter, or the
  equivalent accessible control. The system must not silently overwrite the
  form just because a suggestion is visible.
- Each suggestion should show enough context to distinguish variants: thumbnail,
  product name, original JPY price, publication recency, and photo count or
  thumbnail preview.

### 3.3 Fields copied after selection

Selecting a prior product fills:

- Product name.
- Durable reference-photo links.
- Original JPY price.
- Sale TWD price, as the previous value/default.
- Purchase note/instructions.
- Face-check requirement.
- Any approved product-level helper instruction that is part of the purchase
  form.

The administrator can edit every copied field before publishing. Quantity is
also editable and should receive focus/select behavior after product selection so
the administrator can immediately replace the previous quantity.

The form must not copy:

- The previous customer's nickname.
- The previous task's quantity as an immutable value.
- Purchase status, bought quantity, cancellation, unavailable, or review state.
- The previous quote/detail source identifiers.
- The previous task's customer-specific notes or staging result as hidden data.

The new publish action creates an independent customer purchase task. If the
same private R2 object is reused, the system stores/reuses the durable
`storage_key` and creates the appropriate new task-photo link; it does not save a
signed URL as canonical data.

### 3.4 Quick entrance

The purchase publishing page should provide a compact `最近使用商品` or
`再次使用商品` entry near the top of the form. It can show the most recent few
products as thumbnail cards or rows. Selecting one opens the same prefilled
form as the product-name suggestion.

The quick entrance is a convenience shortcut, not a separate publish workflow.
It must use the same validation, authorization, photo handling, audit, and
provenance rules as normal publishing.

### 3.5 Quick-publish history from the same quote photo

The block-two quick-publish form exposes prior quick publishes from the same
`quote_task_photo` as reusable history. The scope is exact-photo only, not every
product published in the connection. History is newest first; one item is shown
directly and multiple items can be expanded.

Selecting a history item fills product name, product type, original JPY price,
sale TWD price, quantity, note, and face-check requirement. Quantity remains
editable. The previous customer nickname, purchase result, task status,
reported/bought quantity, and old provenance are never copied.

The current quote/detail source photo and current helper detail-reply photos are
always the photos carried into the new quick-published task. Previous purchase
photos do not replace current source evidence. Each submission creates an
independent purchase task linked to the current quote task, photo, and reply.
The quick-publish product type must be passed through the form, Server Action,
and service layer. No main-order or staging/merge boundary changes are part of
this behavior.

### 3.5 Gacha and blind-box product metadata

Administrator publishing accepts three product types:

- `standard`: ordinary purchase item; existing product-reuse behavior remains
  compatible.
- `gacha`: capsule-toy product.
- `blind_box`: blind-box product.

For `gacha` and `blind_box`, the reusable photo set contains only the series
reference photos. Each helper purchase report still creates its own
`purchase_report` photo links and is never used as a reusable product photo.
The product suggestion key includes product type, so an ordinary product,
gacha, and blind box with the same display name and JPY price are not merged.
Different series reference-photo sets are also shown as separate suggestion
cards. Selecting a suggestion copies the series reference photo links and
metadata, but never copies a previous customer's purchase result or report
photo.

The dedicated gacha/blind-box helper flow keeps the product type and
series-reference role through the purchase batch, completed staging preview,
reviewed staging order, and source provenance, but adds task-level per-item
reporting:

- The helper first enters actual purchased quantity. The system then creates
  one result row per purchased item; unpurchased remainder follows the normal
  cancellation / unavailable flow.
- Every result row requires result text or one result photo. A later row may
  reuse the first row's photo. A photo-only result is represented as `看圖` in
  the administrator result text.
- A blind-box row may use the explicit `待開箱` state. It may enter staging and
  be merged, but remains unavailable for administrator transfer until unboxed.
- The helper submits the complete task as one persistence operation. The admin
  live return feed shows the task only after that submission succeeds; rows are
  not formally saved one at a time.
- Administrator staging review owns per-row corrections. The helper source
  reply and original media remain auditable and are not silently overwritten.

The batch remains a helper-facing aggregation only. It is never a final order,
and each customer task still maps to its own staging/main order. Existing
gacha/blind-box tasks retain the legacy workflow; only newly published tasks
with the new workflow version use this per-item response model.

## 4. Helper: Purchase Batch Behavior

### 4.1 Base batch

The first set of customer orders for a product creates the base batch:

```text
浴衣漢頓
  A：1 件
  B：2 件
  批次合計：3 件
```

After the helper fully resolves it, the batch remains in the completed area and
is never reopened.

### 4.2 Add-on batches

If a later customer orders the same product after the base batch is closed, the
system creates the next add-on batch:

```text
浴衣漢頓－加單1
  C：2 件
  D：1 件
  批次合計：3 件
```

If this batch is still unresolved, later customers are appended to the same
batch. They do not create another suffix.

```text
浴衣漢頓－加單1
  C：2 件
  D：1 件
  E：1 件
  總需求：4 件
```

If `加單1` has been fully resolved, a later customer creates `加單2` instead:

```text
浴衣漢頓－加單2
  F：1 件
```

The suffix increments only when a new batch is created after the prior batch is
closed. It must not increment merely because an administrator adds another
customer before the current batch is resolved.

### 4.3 Gacha and blind-box batch freeze

Gacha and blind-box batches have an intake state separate from purchase
completion. A helper may freeze an unfinished batch from its long-press action.
After freezing, newly published same-key tasks route to the next numbered
batch. Only an administrator may reopen the latest frozen batch, and reopening
sets that batch back to `accepting`. If a newer numbered batch already exists,
an older frozen batch remains closed and cannot be reopened.

### 4.4 Partial quantity rule

A partial helper report keeps the batch open. For example, if C and D require a
total of 4 units and the helper reports 3 units, the batch remains appendable:

```text
浴衣漢頓－加單1
  總需求：4 件
  已回報：3 件
  尚缺：1 件
```

If E then adds 1 unit, E joins `加單1` and the batch becomes:

```text
浴衣漢頓－加單1
  總需求：5 件
  已回報：3 件
  尚缺：2 件
```

The previously reported 3 units must not be duplicated. The UI and server
response must clearly separate total requested quantity, already reported/bought
quantity, and remaining quantity.

If the remaining quantity is explicitly resolved as unavailable, not found, or
canceled according to the existing purchase rules, the relevant work is closed;
later new orders then create the next add-on batch.

### 4.4 Batch matching key

Only tasks within the same connection/trip and compatible product family may
share a batch. The first version must at least require compatibility for:

- Product identity/name.
- Original JPY price.
- Face-check required flag.
- Material variant or specification when it affects what the helper must buy.

Customer nickname, customer quantity, and sale TWD price do not split the helper
batch by themselves. A changed product variant or purchase condition must split
the batch, even if the display name is similar.

## 5. Helper UI Presentation

### 5.1 Product and current-batch view

The helper primarily sees one actionable product card for the current unresolved
batch, not a customer list:

```text
浴衣漢頓－加單1
待採買：3 位／5 件
已回報：3 件
尚缺：2 件
```

The card includes the reference photo, price, face-check state, and the next
required action. It must not display customer nicknames or the administrator's
customer-level mapping unless a later explicit product decision permits it.

Completed earlier batches remain in the completed section:

```text
已完成
浴衣漢頓：2 位／3 件

進行中
浴衣漢頓－加單1：3 位／5 件，尚缺 2 件
```

The helper action quantity is always the current unresolved batch quantity. The
historical completed quantity is informational and must never be added back into
the amount the helper is asked to buy.

### 5.2 Admin detail view

Administrators can open the same product family and inspect each batch, including
customer-level rows:

```text
浴衣漢頓

原始批次｜已完成｜A 1 件、B 2 件｜合計 3 件
加單1｜進行中｜C 2 件、D 1 件、E 1 件｜總需求 4 件
```

Admin detail may show customer nicknames, quantities, per-customer status,
reported quantities, source photos, and staging preview relationships according
to the existing admin permissions. These details remain admin-only and are not
part of the helper aggregate response.

## 6. Data and Workflow Boundaries

- Each customer purchase task remains an independent source record.
- The purchase batch is a coordination/read model and must retain links to its
  child purchase tasks.
- A batch must not replace the per-customer staging order preview model.
- Completed customer purchase tasks may create staging order preview data under
  the existing rules.
- Helper-generated data remains staging data until administrator review and an
  explicit merge.
- The feature must not directly write helper data into `main.orders`.
- Helper provenance continues through `main.order_source_links` at merge time.
- Durable private R2 `storage_key` values remain canonical; signed URLs are only
  temporary presentation values.
- Adding a customer to an open batch must be idempotent and must not duplicate
  the customer task or inflate the reported/bought quantity.
- A batch close and an append must be protected against stale concurrent actions;
  an append racing with a final completion must resolve deterministically on the
  server.

## 7. Non-Goals

- Do not expose the customer list to helpers in the first version.
- Do not merge different prices, variants, or face-check requirements merely
  because the display name matches.
- Do not reopen completed customer tasks or completed batches.
- Do not combine all historical completed and current quantities into one helper
  action quantity.
- Do not make the batch itself the final `main.orders` order or merge unit.
- Do not build a cross-trip/global product catalog in the first version.
- Do not change settlement or explicit merge rules in this feature.

## 8. Acceptance Criteria

### Administrator

- Empty product-name input shows the latest published product first.
- Typing filters current-connection products and sorts newest within match quality.
- Selecting a suggestion fills product data and photos without copying customer
  identity or old workflow status.
- Gacha and blind-box suggestions are separated by product type, JPY price, and
  series reference-photo set; purchase report photos never appear in them.
- Quantity remains editable and is immediately usable after selection.
- Recent-product quick entrance opens the same validated prefilled form.
- A quote/detail photo with prior quick publishes exposes newest-first reusable
  history; selecting it fills only the confirmed editable product fields and
  keeps the current source photos/provenance.
- Reused photos remain durable private media and are linked to the new task
  without persisting signed URLs.
- Admin can inspect batches and customer-level order rows.

### Helper

- A completed base batch remains in completed history.
- A later customer creates `加單1` after the base batch is closed.
- New customers append to the current add-on batch while it is unresolved.
- A partial report such as 3/4 keeps the batch appendable.
- Adding E after a 3/4 report updates the same batch's total and remaining
  quantity without duplicating the reported 3.
- A new suffix is created only after the prior batch is fully resolved.
- The helper sees the current batch's total/remaining quantity, not customer
  names or historical quantities as actionable work.
- The helper does not receive admin-only customer mapping.

### Boundary and reliability

- Completed, canceled, unavailable, and not-found behavior remains consistent
  with existing purchase rules.
- No duplicate child tasks, responses, staging previews, or media links occur
  after retries.
- The staging/main boundary and explicit merge requirement remain unchanged.

## 9. Implementation Status and Follow-up

Implemented in the first `gacha_v2` slice:

1. Dedicated administrator gacha/blind-box publish entry, separated memory and
   gacha price mapping.
2. Same-trip/name/type/JPY batch grouping, anonymous helper task rows, freeze
   and latest-batch admin reopen behavior.
3. Actual-quantity-first per-item helper reporting, one-photo/reuse-first-photo
   behavior, task-level idempotent submit, and blind-box pending unboxing.
4. Per-item staging review and explicit merge into administrator gacha template,
   order item, item-photo, receivable, and event records.

Remaining acceptance work is authenticated mobile/desktop walkthrough, applying
`0019_helper_app_gacha_v2_task_results.sql` to the intended helper Supabase
project, and validating real R2 and cross-application customer/template data.
