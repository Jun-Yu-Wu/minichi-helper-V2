const assert = require("node:assert/strict");
const test = require("node:test");

const service = require("../src/server/helper-app-service");

function todayTripFields(timezone = "Asia/Tokyo") {
  return {
    business_date: service.dateInTimezone(new Date(), timezone),
    timezone,
  };
}

function tripFieldsWithDayOffset(offsetDays, timezone = "Asia/Tokyo") {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return {
    business_date: service.dateInTimezone(date, timezone),
    timezone,
  };
}

test("groups helper trips by work status and keeps recent completed trips", () => {
  const now = new Date("2026-06-22T15:30:00.000Z");
  const groups = service.groupTripsByLocalDate(
    [
      { business_date: "2026-06-27", status: "scheduled", timezone: "Asia/Tokyo" },
      { business_date: "2026-06-20", status: "scheduled", timezone: "Asia/Tokyo" },
      { business_date: "2026-06-20", status: "active", timezone: "Asia/Tokyo" },
      { business_date: "2026-06-22", status: "departed", timezone: "Asia/Tokyo" },
      { business_date: "2026-06-23", status: "ended", timezone: "Asia/Tokyo" },
      { business_date: "2026-06-01", ended_at: "2026-06-23T08:00:00.000Z", status: "ended", timezone: "Asia/Tokyo" },
      { business_date: "2026-06-19", status: "ended", timezone: "Asia/Tokyo" },
      { business_date: "2026-06-24", status: "canceled", timezone: "Asia/Tokyo" },
    ],
    now,
  );

  assert.equal(groups.notStarted.length, 2);
  assert.equal(groups.inProgress.length, 2);
  assert.equal(groups.completed.length, 2);
  assert.equal(groups.completed.some((trip) => trip.business_date === "2026-06-01"), true);
  assert.deepEqual(groups.today, groups.inProgress);
  assert.deepEqual(groups.upcoming, groups.notStarted);
  assert.deepEqual(groups.history, groups.completed);
});

test("groups pg date objects by yyyy-mm-dd in the trip timezone", () => {
  const now = new Date("2026-06-23T01:00:00.000Z");
  const groups = service.groupTripsByLocalDate(
    [
      {
        business_date: new Date("2026-06-23T00:00:00.000Z"),
        status: "scheduled",
        timezone: "Asia/Tokyo",
      },
    ],
    now,
  );

  assert.equal(groups.notStarted.length, 1);
  assert.equal(service.dateOnly(new Date("2026-06-23T00:00:00.000Z"), "Asia/Tokyo"), "2026-06-23");
});

test("groups purchase tasks into immutable add-on batches and keeps partial quantity open", () => {
  const groups = service.groupPurchaseTasksForHelper([
    {
      id: "a",
      purchase_batch_id: "base-batch",
      purchase_batch_sequence: 0,
      purchase_batch_status: "completed",
      product_name: "浴衣漢頓",
      quantity: 2,
      completed_quantity: 2,
      status: "completed",
      updated_at: "2026-07-24T01:00:00Z",
    },
    {
      id: "b",
      purchase_batch_id: "add-on-1",
      purchase_batch_sequence: 1,
      purchase_batch_status: "open",
      product_name: "浴衣漢頓",
      quantity: 4,
      completed_quantity: 3,
      status: "open",
      updated_at: "2026-07-24T02:00:00Z",
    },
    {
      id: "e",
      purchase_batch_id: "add-on-1",
      purchase_batch_sequence: 1,
      purchase_batch_status: "open",
      product_name: "浴衣漢頓",
      quantity: 1,
      completed_quantity: 0,
      status: "open",
      updated_at: "2026-07-24T03:00:00Z",
    },
  ]);

  assert.equal(groups.length, 2);
  const completed = groups.find((group) => group.batch_id === "base-batch");
  const open = groups.find((group) => group.batch_id === "add-on-1");
  assert.equal(completed.batch_title, "浴衣漢頓");
  assert.equal(completed.batch_status, "completed");
  assert.equal(open.batch_title, "浴衣漢頓－加單1");
  assert.equal(open.batch_requested_quantity, 5);
  assert.equal(open.batch_reported_quantity, 3);
  assert.equal(open.batch_remaining_quantity, 2);
});

test("reports a helper batch total while keeping customer tasks open for later add-ons", async () => {
  const database = fakeDatabase([
    {
      rows: [{
        authorized_helper_id: "helper-1",
        authorized_helper_is_active: true,
        authorized_trip_status: "active",
        id: "batch-1",
        status: "open",
        trip_id: "trip-1",
      }],
    },
    {
      rows: [
        {
          id: "task-cd",
          helper_id: "helper-1",
          product_name: "浴衣漢頓",
          quantity: 4,
          completed_quantity: 2,
          status: "open",
          trip_id: "trip-1",
          requires_face_check: false,
        },
        {
          id: "task-e",
          helper_id: "helper-1",
          product_name: "浴衣漢頓",
          quantity: 1,
          completed_quantity: 0,
          status: "open",
          trip_id: "trip-1",
          requires_face_check: false,
        },
      ],
    },
    { rows: [{ id: "task-cd", status: "open", completed_quantity: 3, quantity: 4 }] },
    { rows: [{ id: "task-e", status: "open", completed_quantity: 0, quantity: 1 }] },
    {
      rows: [{
        id: "batch-1",
        status: "open",
        calculated_requested_quantity: 5,
        calculated_reported_quantity: 3,
        calculated_remaining_quantity: 2,
        calculated_pending_task_count: 2,
      }],
    },
    { rows: [] },
  ]);

  const task = await service.respondPurchaseBatch(database, {
    action: "complete",
    authUserId: "user-1",
    completedQuantity: "1",
    helperNote: "本次再買到一件",
    idempotencyKey: "batch-response-1",
    purchaseBatchId: "batch-1",
  });

  assert.equal(task.id, "task-cd");
  assert.equal(task.status, "open");
  assert.equal(task.completed_quantity, 3);
  assert.equal(task.purchase_batch.status, "open");
  assert.equal(task.purchase_batch.remaining_quantity, 2);
});

test("lists customer nickname suggestions from the Supabase main customer master", async () => {
  const queries = [];
  const database = {
    async query(sql) {
      queries.push({ sql });
      return {
        rows: [
          { line_community_name: "小明" },
          { line_community_name: "阿美" },
        ],
      };
    },
  };

  const nicknames = await service.listCustomerNicknames(database);

  assert.deepEqual(nicknames, ["小明", "阿美"]);
  assert.match(queries[0].sql, /from main\.customers/);
  assert.match(queries[0].sql, /distinct on \(lower\(btrim\(line_community_name\)\)\)/);
  assert.match(queries[0].sql, /order by lower\(btrim\(line_community_name\)\)/);
});

test("customer nickname typeahead searches a bounded subset instead of hydrating the full master", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return { rows: [{ line_community_name: "小明東京" }] };
    },
  };

  const nicknames = await service.searchCustomerNicknames(database, "小明", 8);

  assert.deepEqual(nicknames, ["小明東京"]);
  assert.match(queries[0].sql, /position\(lower\(btrim\(\$1\)\)/);
  assert.match(queries[0].sql, /limit \$2/);
  assert.deepEqual(queries[0].params, ["小明", 8]);
  assert.deepEqual(await service.searchCustomerNicknames(database, ""), []);
  assert.equal(queries.length, 1);
});

test("admin dashboard reads only the sections requested by the current view", async () => {
  const queries = [];
  const database = {
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    },
  };

  const dashboard = await service.listAdminDashboard(database, {
    sections: ["trips"],
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0], /from helper_app\.trips/);
  assert.deepEqual(dashboard.trips, []);
  assert.deepEqual(dashboard.helpers, []);
  assert.deepEqual(dashboard.settlements, []);
});

test("staging merge list uses aggregate counts and defers reviewed rows until a batch is selected", async () => {
  const listQueries = [];
  const database = {
    async query(sql, params) {
      listQueries.push({ params, sql });
      return {
        rows: [{
          id: "merge-1",
          included_order_count: 2,
          reviewed_order_count: 3,
          selected_photo_count: 4,
          unknown_customer_count: 1,
          reviewed_orders: [],
        }],
      };
    },
  };

  const list = await service.listAdminDashboard(database, {
    sections: ["stagingMergeJobs"],
  });

  assert.equal(list.stagingMergeJobs[0].included_order_count, 2);
  assert.match(listQueries[0].sql, /selected_photo_count/);
  assert.match(listQueries[0].sql, /'\[\]'::jsonb as reviewed_orders/);
  assert.deepEqual(listQueries[0].params, []);
});

test("selected staging order scopes review rows and photo metadata to the current detail", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return {
        rows: [{
          id: "merge-1",
          reviewed_orders: [{
            id: "reviewed-order-1",
            photos: [{ id: "photo-1", storage_key: "helper/photo.jpg" }],
          }],
        }],
      };
    },
  };

  const detail = await service.listAdminDashboard(database, {
    sections: ["stagingMergeJobs"],
    stagingMergeIncludeOrders: true,
    stagingMergeIncludeOrderPhotos: true,
    stagingMergeJobId: "merge-1",
    stagingMergeReviewedOrderId: "reviewed-order-1",
  });

  assert.equal(detail.stagingMergeJobs[0].reviewed_orders[0].id, "reviewed-order-1");
  assert.deepEqual(queries[0].params, ["merge-1", "reviewed-order-1"]);
  assert.match(queries[0].sql, /rso\.id = \$2/);
  assert.match(queries[0].sql, /reviewed_staging_order_photos rsop/);
});

test("selected staging merge photos receive temporary signed URLs without changing storage keys", async () => {
  const result = await service.attachSignedStagingMergeJobUrls(
    [{
      id: "merge-1",
      reviewed_orders: [{
        id: "reviewed-order-1",
        photos: [{ id: "photo-1", storage_key: "helper/photo.jpg" }],
      }],
    }],
    { signedGetUrl: async (storageKey) => `signed:${storageKey}` },
  );

  assert.equal(result[0].reviewed_orders[0].photos[0].signed_url, "signed:helper/photo.jpg");
  assert.equal(result[0].reviewed_orders[0].photos[0].storage_key, "helper/photo.jpg");
});

test("photo annotation source authorization keeps helper media scoped", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return {
        rows: [{
          can_access: true,
          content_type: "image/jpeg",
          id: "media-1",
          media_kind: "site_photo",
          original_filename: "shop.jpg",
          storage_key: "helper-app/trip-1/site-photos/photo.jpg",
        }],
      };
    },
  };

  const source = await service.authorizePhotoAnnotationSource(database, {
    actorRole: "helper",
    authUserId: "helper-user-1",
    sourceStorageKey: "helper-app/trip-1/site-photos/photo.jpg",
  });

  assert.equal(source.id, "media-1");
  assert.deepEqual(queries[0].params, [
    "helper-user-1",
    "helper",
    "helper-app/trip-1/site-photos/photo.jpg",
  ]);
  assert.match(queries[0].sql, /media_variants mv/);
  assert.match(queries[0].sql, /site_photos sp/);
});

test("photo annotation source authorization rejects inaccessible media", async () => {
  const database = {
    async query() {
      return { rows: [{ can_access: false, id: "media-1", storage_key: "private/photo.jpg" }] };
    },
  };

  await assert.rejects(
    service.authorizePhotoAnnotationSource(database, {
      actorRole: "helper",
      authUserId: "other-helper",
      sourceStorageKey: "private/photo.jpg",
    }),
    (error) => error.code === "forbidden",
  );
});

test("admin home summary uses one aggregate query instead of loading dashboard records", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return {
        rows: [{
          active_helpers: 3,
          active_trips: 1,
          arrived_trips: 2,
          face_check_pending: 4,
          merge_pending: 5,
          open_quote_tasks: 6,
          settlement_pending: 7,
        }],
      };
    },
  };

  const dashboard = await service.listAdminDashboard(database, {
    sections: ["summary"],
  });

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /count\(\*\)::int/);
  assert.equal(dashboard.summary.active_trips, 1);
  assert.deepEqual(dashboard.trips, []);
  assert.deepEqual(dashboard.purchaseTasks, []);
});

test("settlement list views can read summaries without evidence payloads", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return {
        rows: [{
          evidence: [],
          helper_display_name: "Mina",
          id: "00000000-0000-0000-0000-000000000001",
          line_items: [],
          payments: [],
          product_total_jpy: 12000,
          status: "pending_admin_review",
          trip_name: "Tokyo live",
        }],
      };
    },
  };

  const dashboard = await service.listAdminDashboard(database, {
    sections: ["settlements"],
    settlementIncludeDetails: false,
  });

  assert.equal(dashboard.settlements.length, 1);
  assert.deepEqual(dashboard.settlements[0].evidence, []);
  assert.deepEqual(dashboard.settlements[0].line_items, []);
  assert.doesNotMatch(queries[0].sql, /settlement_evidence se/);
  assert.doesNotMatch(queries[0].sql, /settlement_line_items sli/);
  assert.doesNotMatch(queries[0].sql, /settlement_payments sp/);
});

test("settlement detail views can scope to a selected settlement", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      if (sql.includes("from helper_app.helper_profiles")) {
        return {
          rows: [{
            auth_user_id: "user-1",
            id: "helper-1",
            is_active: true,
          }],
        };
      }
      if (sql.includes("select id, trip_name")) {
        return { rows: [] };
      }
      return {
        rows: [{
          evidence: [{ id: "evidence-1", storage_key: "key" }],
          id: "00000000-0000-0000-0000-000000000001",
          line_items: [{ id: "line-1" }],
          payments: [],
          status: "pending_helper_precheck",
        }],
      };
    },
  };

  const workspace = await service.getHelperWorkspace(database, "user-1", new Date(), {
    sections: ["settlements"],
    settlementIds: ["00000000-0000-0000-0000-000000000001"],
    settlementIncludeDetails: true,
  });

  const settlementQuery = queries.find((query) =>
    String(query.sql).includes("from helper_app.settlements s"),
  );
  assert.ok(settlementQuery);
  assert.match(settlementQuery.sql, /s\.id = any\(\$2::uuid\[\]\)/);
  assert.match(settlementQuery.sql, /settlement_evidence se/);
  assert.deepEqual(settlementQuery.params, [
    "helper-1",
    ["00000000-0000-0000-0000-000000000001"],
  ]);
  assert.equal(workspace.settlements[0].evidence.length, 1);
});

test("admin live dashboard scopes active trips and workflow reads to the selected trip", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return { rows: [] };
    },
  };

  await service.listAdminDashboard(database, {
    sections: [
      "trips",
      "sitePhotoBatches",
      "quoteTasks",
      "purchaseTasks",
      "stagingOrderPreviews",
    ],
    tripStatuses: ["active"],
    workflowTripIds: ["00000000-0000-0000-0000-000000000001"],
  });

  const tripsQuery = queries.find(({ sql }) => sql.includes("select t.id, t.trip_name"));
  assert.deepEqual(tripsQuery.params, [["active"]]);
  assert.match(tripsQuery.sql, /t\.status = any\(\$1::text\[\]\)/);
  const workflowQueries = queries.filter(({ sql }) =>
    /site_photo_batches|quote_tasks qt|purchase_tasks pt|staging_order_previews/.test(sql),
  );
  assert.equal(workflowQueries.length, 4);
  assert.equal(
    workflowQueries.every(({ params }) =>
      params.some((value) =>
        Array.isArray(value) &&
        value.includes("00000000-0000-0000-0000-000000000001"),
      ),
    ),
    true,
  );
});

test("admin live purchase list reads task summaries without signed-photo payloads", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return { rows: [] };
    },
  };

  await service.listAdminDashboard(database, {
    sections: ["trips", "purchaseTasks"],
    tripStatuses: ["active"],
    workflowTripIds: ["00000000-0000-0000-0000-000000000001"],
  });

  const purchaseQuery = queries.find(({ sql }) => sql.includes("helper_app.purchase_tasks pt"));
  assert.ok(purchaseQuery);
  assert.match(purchaseQuery.sql, /photo_counts\.photo_count/);
  assert.doesNotMatch(purchaseQuery.sql, /jsonb_agg/);
  assert.doesNotMatch(purchaseQuery.sql, /storage_key/);
  assert.match(purchaseQuery.sql, /latest_face\.photo_role = 'face_check_report'/);
});

test("purchase task detail reads one selected task before signing photos", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return {
        rows: [{
          id: "purchase-task-1",
          photos: [{ id: "photo-1", storage_key: "purchase-reference-1" }],
          trip_id: "trip-1",
        }],
      };
    },
  };

  const task = await service.getPurchaseTaskDetail(database, {
    activeOnly: true,
    authUserId: "user-1",
    purchaseTaskId: "purchase-task-1",
    tripId: "trip-1",
  });

  assert.equal(task.id, "purchase-task-1");
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ["purchase-task-1", "trip-1", "user-1"]);
  assert.match(queries[0].sql, /where pt\.id = \$1 and pt\.trip_id = \$2 and hp\.auth_user_id = \$3/);
  assert.match(queries[0].sql, /where ptp\.purchase_task_id = pt\.id/);
  assert.match(queries[0].sql, /latest_face\.photo_role = 'face_check_report'/);
  assert.match(queries[0].sql, /order by latest_face\.created_at desc, latest_face\.id desc/);
  assert.match(queries[0].sql, /limit 1/);
});

test("admin live photo section skips quote purchase and staging reads", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return { rows: [] };
    },
  };

  await service.listAdminDashboard(database, {
    sections: ["trips", "sitePhotoBatches"],
    tripStatuses: ["active"],
    workflowTripIds: ["00000000-0000-0000-0000-000000000001"],
  });

  assert.equal(queries.length, 2);
  assert.equal(
    queries.some(({ sql }) => sql.includes("helper_app.site_photo_batches")),
    true,
  );
  assert.equal(
    queries.some(({ sql }) =>
      /quote_tasks qt|purchase_tasks pt|staging_order_previews/.test(sql),
    ),
    false,
  );
});

test("admin live quote section skips server workflow reads", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return { rows: [] };
    },
  };

  await service.listAdminDashboard(database, {
    sections: [],
    tripStatuses: ["active"],
    workflowTripIds: ["00000000-0000-0000-0000-000000000001"],
  });

  assert.equal(queries.length, 0);
  assert.equal(
    queries.some(({ sql }) =>
      /site_photo_batches|quote_tasks qt|purchase_tasks pt|staging_order_previews/.test(sql),
    ),
    false,
  );
});

test("admin quote task list uses one lightweight selected-trip summary query", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return {
        rows: [{
          id: "quote-task-1",
          needs_review_count: 0,
          photo_count: 2,
          replied_photo_count: 1,
          status: "open",
          task_type: "quote_and_detail",
        }],
      };
    },
  };

  const tasks = await service.listAdminQuoteTaskSummaries(database, {
    tripId: "trip-1",
  });

  assert.equal(tasks.length, 1);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ["trip-1"]);
  assert.match(queries[0].sql, /count\(qtp\.id\)::int as photo_count/);
  assert.match(queries[0].sql, /needs_review_count/);
  assert.doesNotMatch(queries[0].sql, /storage_key|quote_photo_replies|jsonb_agg/);
});

test("helper quote task list uses one lightweight active-trip summary query", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return {
        rows: [{
          id: "quote-task-1",
          photo_count: 3,
          replied_photo_count: 1,
          status: "open",
          task_type: "quote",
        }],
      };
    },
  };

  const tasks = await service.listAuthorizedHelperQuoteTaskSummaries(database, {
    authUserId: "helper-user-1",
    tripId: "trip-1",
  });

  assert.equal(tasks.length, 1);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, ["trip-1", "helper-user-1"]);
  assert.match(queries[0].sql, /hp\.auth_user_id = \$2/);
  assert.match(queries[0].sql, /hp\.is_active = true/);
  assert.match(queries[0].sql, /t\.status = 'active'/);
  assert.doesNotMatch(queries[0].sql, /storage_key|quote_photo_replies|jsonb_agg/);
});

test("helper workspace skips workflow reads that are not needed by the current view", async () => {
  const queries = [];
  const database = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("from helper_app.helper_profiles")) {
        return { rows: [{ id: "helper-1", is_active: true }] };
      }
      if (sql.includes("from helper_app.trips")) {
        return {
          rows: [
            {
              business_date: "2026-07-02",
              id: "trip-1",
              status: "scheduled",
              timezone: "Asia/Tokyo",
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const workspace = await service.getHelperWorkspace(
    database,
    "user-1",
    new Date("2026-07-02T00:00:00.000Z"),
    { sections: [] },
  );

  assert.equal(queries.length, 2);
  assert.deepEqual(workspace.quoteTasksByTripId, {});
  assert.deepEqual(workspace.purchaseTasksByTripId, {});
  assert.deepEqual(workspace.rebuyTasks, []);
  assert.deepEqual(workspace.settlements, []);
  assert.deepEqual(workspace.sitePhotoBatchesByTripId, {});
});

test("helper workspace can skip trip reads for settlement-only views", async () => {
  const queries = [];
  const database = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("from helper_app.helper_profiles")) {
        return { rows: [{ id: "helper-1", is_active: true }] };
      }
      if (sql.includes("from helper_app.settlements")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  await service.getHelperWorkspace(
    database,
    "user-1",
    new Date("2026-07-02T00:00:00.000Z"),
    { sections: ["settlements"], loadTrips: false },
  );

  assert.equal(queries.length, 2);
  assert.equal(queries.some((sql) => sql.includes("from helper_app.trips")), false);
  assert.equal(queries.some((sql) => sql.includes("from helper_app.settlements")), true);
});

test("helper workspace scopes the trip read and runs selected workflow reads concurrently", async () => {
  const queries = [];
  let activeWorkflowQueries = 0;
  let maxActiveWorkflowQueries = 0;
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      if (sql.includes("from helper_app.helper_profiles")) {
        return { rows: [{ id: "helper-1", is_active: true }] };
      }
      if (sql.includes("select id, trip_name")) {
        return {
          rows: [{
            business_date: "2026-07-02",
            id: "00000000-0000-0000-0000-000000000001",
            status: "active",
            timezone: "Asia/Tokyo",
          }],
        };
      }
      activeWorkflowQueries += 1;
      maxActiveWorkflowQueries = Math.max(
        maxActiveWorkflowQueries,
        activeWorkflowQueries,
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeWorkflowQueries -= 1;
      return { rows: [] };
    },
  };

  await service.getHelperWorkspace(
    database,
    "user-1",
    new Date("2026-07-02T00:00:00.000Z"),
    {
      sections: [
        "quoteTasks",
        "purchaseTasks",
        "sitePhotoBatches",
        "tripSummaries",
      ],
      tripIds: ["00000000-0000-0000-0000-000000000001"],
    },
  );

  const tripQuery = queries.find(({ sql }) => sql.includes("select id, trip_name"));
  assert.deepEqual(tripQuery.params, [
    "helper-1",
    ["00000000-0000-0000-0000-000000000001"],
  ]);
  assert.match(tripQuery.sql, /id = any\(\$2::uuid\[\]\)/);
  assert.equal(maxActiveWorkflowQueries, 4);
});

test("helper trip summaries expose quote task progress counts", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      if (sql.includes("from helper_app.helper_profiles")) {
        return { rows: [{ id: "helper-1", is_active: true }] };
      }
      if (sql.includes("select id, trip_name")) {
        return {
          rows: [{
            business_date: "2026-07-02",
            id: "00000000-0000-0000-0000-000000000001",
            status: "active",
            timezone: "Asia/Tokyo",
          }],
        };
      }
      return {
        rows: [{
          completed_quote_task_count: 2,
          quote_photo_count: 3,
          quote_task_count: 3,
          replied_quote_photo_count: 2,
          trip_id: "00000000-0000-0000-0000-000000000001",
          unfinished_quote_task_count: 1,
        }],
      };
    },
  };

  const workspace = await service.getHelperWorkspace(
    database,
    "user-1",
    new Date("2026-07-02T00:00:00.000Z"),
    {
      sections: ["tripSummaries"],
      tripIds: ["00000000-0000-0000-0000-000000000001"],
    },
  );

  const summaryQuery = queries.find(({ sql }) =>
    sql.includes("site_photo_batch_count"),
  );
  assert.ok(summaryQuery);
  assert.match(summaryQuery.sql, /as completed_quote_task_count/);
  assert.match(summaryQuery.sql, /as unfinished_quote_task_count/);
  assert.match(summaryQuery.sql, /as quote_photo_count/);
  assert.match(summaryQuery.sql, /as replied_quote_photo_count/);
  assert.deepEqual(
    workspace.tripSummariesByTripId["00000000-0000-0000-0000-000000000001"],
    {
      completed_quote_task_count: 2,
      quote_photo_count: 3,
      quote_task_count: 3,
      replied_quote_photo_count: 2,
      trip_id: "00000000-0000-0000-0000-000000000001",
      unfinished_quote_task_count: 1,
    },
  );
});

test("helper site photo list reads batch summaries without photo payloads", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return {
        rows: [{
          batch_number: 1,
          id: "batch-1",
          note: "",
          photo_count: 3,
          trip_id: "trip-1",
        }],
      };
    },
  };

  const batches = await service.listSitePhotoBatchSummaries(database, {
    helperId: "helper-1",
    tripIds: ["00000000-0000-0000-0000-000000000001"],
  });

  assert.equal(batches[0].photo_count, 3);
  assert.equal(batches[0].batch_number, 1);
  assert.match(queries[0].sql, /count\(p\.id\)::int as photo_count/);
  assert.match(queries[0].sql, /row_number\(\) over/);
  assert.doesNotMatch(queries[0].sql, /storage_key|jsonb_agg/);
  assert.deepEqual(queries[0].params, [
    "helper-1",
    ["00000000-0000-0000-0000-000000000001"],
  ]);
});

test("helper site photo P0 read model authorizes and lists summaries in one query", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return {
        rows: [{
          batch_number: 2,
          helper_id: "helper-1",
          id: "batch-2",
          note: "三麗鷗新品",
          photo_count: 4,
          trip_id: "00000000-0000-0000-0000-000000000001",
        }],
      };
    },
  };

  const result = await service.listAuthorizedHelperSitePhotoBatchSummaries(
    database,
    {
      authUserId: "00000000-0000-0000-0000-000000000009",
      tripId: "00000000-0000-0000-0000-000000000001",
    },
  );

  assert.equal(queries.length, 1);
  assert.equal(result.authorized, true);
  assert.equal(result.batches[0].photo_count, 4);
  assert.match(queries[0].sql, /hp\.auth_user_id = \$1/);
  assert.match(queries[0].sql, /t\.id = \$2::uuid/);
  assert.match(queries[0].sql, /t\.status = 'active'/);
  assert.match(queries[0].sql, /b\.trip_id = permitted\.trip_id/);
  assert.doesNotMatch(queries[0].sql, /left join ranked_batches b on true/);
  assert.doesNotMatch(queries[0].sql, /storage_key|jsonb_agg/);
  assert.deepEqual(queries[0].params, [
    "00000000-0000-0000-0000-000000000009",
    "00000000-0000-0000-0000-000000000001",
  ]);
});

test("helper site photo detail read model scopes ranking to the selected trip", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return {
        rows: [{
          batch_number: 3,
          id: "batch-3",
          photo_count: 2,
          photos: [{ storage_key: "site/photo.jpg" }],
        }],
      };
    },
  };

  const result = await service.getAuthorizedHelperSitePhotoBatchDetail(database, {
    authUserId: "user-1",
    batchId: "00000000-0000-0000-0000-000000000003",
    tripId: "00000000-0000-0000-0000-000000000001",
  });

  assert.equal(queries.length, 1);
  assert.equal(result.authorized, true);
  assert.equal(result.batch.photo_count, 2);
  assert.match(queries[0].sql, /with authorized_batch as/);
  assert.match(queries[0].sql, /join authorized_batch selected on selected\.trip_id = source\.trip_id/);
  assert.match(queries[0].sql, /jsonb_agg/);
  assert.deepEqual(queries[0].params, [
    "00000000-0000-0000-0000-000000000003",
    "00000000-0000-0000-0000-000000000001",
    "user-1",
  ]);
});

test("helper site photo detail loads photos only for the selected owned batch", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      if (sql.includes("from helper_app.helper_profiles")) {
        return { rows: [{ id: "helper-1", is_active: true }] };
      }
      if (sql.includes("select id, trip_name")) {
        return {
          rows: [{
            business_date: "2026-07-05",
            id: "00000000-0000-0000-0000-000000000001",
            status: "active",
            timezone: "Asia/Tokyo",
          }],
        };
      }
      return {
        rows: [{
          id: "00000000-0000-0000-0000-000000000002",
          photos: [{ storage_key: "site/photo.jpg" }],
          trip_id: "00000000-0000-0000-0000-000000000001",
        }],
      };
    },
  };

  const workspace = await service.getHelperWorkspace(
    database,
    "user-1",
    new Date("2026-07-05T00:00:00.000Z"),
    {
      sections: ["sitePhotoBatches"],
      sitePhotoBatchId: "00000000-0000-0000-0000-000000000002",
      tripIds: ["00000000-0000-0000-0000-000000000001"],
    },
  );

  const detailQuery = queries.find(({ sql }) => sql.includes("with ranked_batches"));
  assert.match(detailQuery.sql, /jsonb_agg/);
  assert.match(detailQuery.sql, /storage_key/);
  assert.match(detailQuery.sql, /b\.id = \$1/);
  assert.match(detailQuery.sql, /b\.helper_id = \$2/);
  assert.match(detailQuery.sql, /b\.trip_id = any\(\$3::uuid\[\]\)/);
  assert.deepEqual(detailQuery.params, [
    "00000000-0000-0000-0000-000000000002",
    "helper-1",
    ["00000000-0000-0000-0000-000000000001"],
  ]);
  assert.equal(
    workspace.sitePhotoBatchesByTripId["00000000-0000-0000-0000-000000000001"][0].photos.length,
    1,
  );
});

test("lists rebuy tasks by newest publication time without admin priority ordering", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return { rows: [] };
    },
  };

  await service.listRebuyTasks(database);

  assert.match(queries[0].sql, /coalesce\(rt\.public_available_at, rt\.created_at\) desc/);
  assert.doesNotMatch(queries[0].sql, /rt\.priority asc/);
});

test("rebuy summary list skips photo joins until a task is selected", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return { rows: [] };
    },
  };

  await service.listRebuyTasks(database, { helperId: "helper-1", includePhotos: false });

  assert.doesNotMatch(String(queries[0].sql), /rebuy_task_photos/);
  assert.match(String(queries[0].sql), /'\[\]'::jsonb as photos/);
});

test("admin rebuy summaries can scope public open tasks and one assigned helper", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return { rows: [] };
    },
  };

  await service.listRebuyTasks(database, {
    includePhotos: false,
    includePrivateCustomerData: true,
    statuses: ["open"],
    visibility: "public",
  });

  assert.match(queries[0].sql, /rt\.visibility = \$2/);
  assert.match(queries[0].sql, /rt\.status = any\(\$3::text\[\]\)/);
  assert.deepEqual(queries[0].params, [true, "public", ["open"]]);

  queries.length = 0;
  await service.listRebuyTasks(database, {
    assignedHelperId: "helper-1",
    includePhotos: false,
    includePrivateCustomerData: true,
    visibility: "private",
  });

  assert.match(queries[0].sql, /rt\.visibility = \$2/);
  assert.match(queries[0].sql, /rt\.assigned_helper_id = \$3/);
  assert.deepEqual(queries[0].params, [true, "private", "helper-1"]);
});

test("selected rebuy detail scopes by id and includes photos", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ params, sql });
      return { rows: [] };
    },
  };

  await service.listRebuyTasks(database, {
    helperId: "helper-1",
    rebuyTaskIds: ["00000000-0000-0000-0000-000000000001"],
  });

  assert.match(String(queries[0].sql), /rebuy_task_photos/);
  assert.match(String(queries[0].sql), /rt\.id = any\(\$3::uuid\[\]\)/);
  assert.deepEqual(queries[0].params, [
    false,
    "helper-1",
    ["00000000-0000-0000-0000-000000000001"],
  ]);
});

test("helper departure rejects inactive helpers before trip mutation", async () => {
  const calls = [];
  const database = {
    async connect() {
      return {
        async query(sql) {
          calls.push(sql);
          if (sql === "begin" || sql === "rollback") return { rows: [] };
          if (sql.includes("from helper_app.helper_profiles")) {
            return {
              rows: [
                {
                  id: "helper-1",
                  is_active: false,
                },
              ],
            };
          }
          throw new Error("Trip query should not run for inactive helper.");
        },
        release() {},
      };
    },
  };

  await assert.rejects(
    () =>
      service.markHelperDeparted(database, {
        authUserId: "user-1",
        expectedVersion: 1,
        tripId: "trip-1",
      }),
    /inactive/,
  );
  assert.equal(calls.some((sql) => String(sql).includes("from helper_app.trips")), false);
});

test("helper departure rejects trips assigned to another helper", async () => {
  const database = fakeDatabase([
    {
      rows: [{ id: "helper-1", is_active: true }],
    },
    {
      rows: [
        {
          assigned_helper_id: "helper-2",
          id: "trip-1",
          status: "scheduled",
          version: 1,
          ...todayTripFields(),
        },
      ],
    },
  ]);

  await assert.rejects(
    () =>
      service.markHelperDeparted(database, {
        authUserId: "user-1",
        expectedVersion: 1,
        tripId: "trip-1",
      }),
    /not assigned/,
  );
});

test("helper departure updates trip and writes audit event in one transaction", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      { rows: [{ id: "helper-1", is_active: true }] },
      {
        rows: [
          {
            assigned_helper_id: "helper-1",
            id: "trip-1",
            status: "scheduled",
            version: 1,
            ...todayTripFields(),
            departed_at: null,
            arrived_at: null,
            admin_activated_at: null,
            ended_at: null,
            canceled_at: null,
          },
        ],
      },
      { rows: [{ id: "trip-1", status: "departed", version: 2 }] },
      { rows: [] },
    ],
    queries,
  );

  const updated = await service.markHelperDeparted(database, {
    authUserId: "user-1",
    expectedVersion: 1,
    tripId: "trip-1",
  });

  assert.equal(updated.status, "departed");
  assert.equal(queries[0].sql, "begin");
  assert.equal(queries.at(-1).sql, "commit");
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.trip_audit_events")),
    true,
  );
});

test("site photo batch commit writes media, photos, and audit event", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      { rows: [{ id: "helper-1", is_active: true }] },
      {
        rows: [
          {
            assigned_helper_id: "helper-1",
            id: "trip-1",
            status: "active",
            version: 3,
            ...todayTripFields(),
          },
        ],
      },
      { rows: [] },
      { rows: [{ id: "batch-1" }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          {
            id: "batch-1",
            photos: [
              {
                client_photo_id: "photo-client-1",
                sort_order: 0,
                storage_key: "helper-app/trip-1/site-photos/photo-client-1.jpg",
              },
            ],
          },
        ],
      },
    ],
    queries,
  );

  const batch = await service.submitSitePhotoBatch(database, {
    authUserId: "user-1",
    note: "front shelf",
    photos: [
      {
        byteSize: 123,
        clientPhotoId: "photo-client-1",
        contentType: "image/jpeg",
        originalFilename: "a.jpg",
        sortOrder: 0,
        storageKey: "helper-app/trip-1/site-photos/photo-client-1.jpg",
      },
    ],
    submissionId: "submission-1",
    tripId: "trip-1",
  });

  assert.equal(batch.id, "batch-1");
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.media_objects")),
    true,
  );
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.site_photos")),
    true,
  );
  assert.equal(
    queries.some((query) => String(query.sql).includes("helper_site_photo_batch_submitted")),
    false,
  );
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.equal(auditQuery.params[4], "helper_site_photo_batch_submitted");
  assert.equal(queries.at(-1).sql, "commit");
});

test("site photo batch commit is idempotent by submission id", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      { rows: [{ id: "helper-1", is_active: true }] },
      {
        rows: [
          {
            assigned_helper_id: "helper-1",
            id: "trip-1",
            status: "active",
            version: 3,
            ...todayTripFields(),
          },
        ],
      },
      { rows: [{ id: "batch-existing" }] },
      { rows: [{ id: "batch-existing", photos: [] }] },
    ],
    queries,
  );

  const batch = await service.submitSitePhotoBatch(database, {
    authUserId: "user-1",
    photos: [
      {
        clientPhotoId: "photo-client-1",
        contentType: "image/jpeg",
        sortOrder: 0,
        storageKey: "helper-app/trip-1/site-photos/photo-client-1.jpg",
      },
    ],
    submissionId: "submission-1",
    tripId: "trip-1",
  });

  assert.equal(batch.id, "batch-existing");
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.site_photo_batches")),
    false,
  );
});

test("site photo batch commit rejects trips before admin activation", async () => {
  const database = fakeDatabase([
    { rows: [{ id: "helper-1", is_active: true }] },
    {
      rows: [
        {
          assigned_helper_id: "helper-1",
          id: "trip-1",
          status: "arrived",
          version: 3,
          ...todayTripFields(),
        },
      ],
    },
  ]);

  await assert.rejects(
    () =>
      service.submitSitePhotoBatch(database, {
        authUserId: "user-1",
        photos: [
          {
            clientPhotoId: "photo-client-1",
            contentType: "image/jpeg",
            sortOrder: 0,
            storageKey: "helper-app/trip-1/site-photos/photo-client-1.jpg",
          },
        ],
        submissionId: "submission-1",
        tripId: "trip-1",
      }),
    /after the trip is active/,
  );
});

test("site photo batch commit allows any assigned active trip regardless of date", async () => {
  const database = fakeDatabase([
    { rows: [{ id: "helper-1", is_active: true }] },
    {
      rows: [
        {
          assigned_helper_id: "helper-1",
          id: "trip-1",
          status: "active",
          version: 3,
          ...tripFieldsWithDayOffset(-5),
        },
      ],
    },
    { rows: [] },
    { rows: [{ id: "batch-1" }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    {
      rows: [
        {
          id: "batch-1",
          photos: [
            {
              client_photo_id: "photo-client-1",
              sort_order: 0,
              storage_key: "helper-app/trip-1/site-photos/photo-client-1.jpg",
            },
          ],
        },
      ],
    },
  ]);

  const batch = await service.submitSitePhotoBatch(database, {
    authUserId: "user-1",
    photos: [
      {
        clientPhotoId: "photo-client-1",
        contentType: "image/jpeg",
        sortOrder: 0,
        storageKey: "helper-app/trip-1/site-photos/photo-client-1.jpg",
      },
    ],
    submissionId: "submission-1",
    tripId: "trip-1",
  });

  assert.equal(batch.id, "batch-1");
});

test("admin save site photo updates media retention and writes audit event", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            id: "photo-1",
            storage_key: "helper-app/trip-1/site-photos/photo-client-1.jpg",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [] },
      { rows: [] },
    ],
    queries,
  );

  const photo = await service.markSitePhotoSaved(database, {
    actorUserId: "admin-user-1",
    photoId: "photo-1",
  });

  assert.equal(photo.id, "photo-1");
  assert.equal(
    queries.some((query) => String(query.sql).includes("retention_status = 'admin_saved'")),
    true,
  );
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.equal(auditQuery.params[4], "admin_site_photo_saved");
});

test("admin quote task creation uses selected trip photos as task evidence", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            assigned_helper_id: "helper-1",
            id: "trip-1",
            status: "active",
            ...todayTripFields(),
          },
        ],
      },
      {
        rows: [
          {
            helper_id: "helper-1",
            id: "site-photo-1",
            storage_key: "helper-app/trip-1/site-photos/photo-1.jpg",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [{ id: "quote-task-1", task_type: "quote" }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          {
            id: "quote-task-1",
            photos: [{ id: "quote-photo-1", storage_key: "helper-app/trip-1/site-photos/photo-1.jpg" }],
          },
        ],
      },
      { rows: [] },
    ],
    queries,
  );

  const task = await service.createQuoteTask(database, {
    actorUserId: "admin-user-1",
    photoIds: ["site-photo-1"],
    productName: "測試商品",
    taskType: "quote",
    tripId: "trip-1",
  });

  assert.equal(task.id, "quote-task-1");
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.quote_tasks")),
    true,
  );
  assert.equal(
    queries.some((query) => String(query.sql).includes("retention_status = 'task_evidence'")),
    true,
  );
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.match(String(auditQuery.sql), /'admin_quote_task_created'/);
});

test("all admin quote task types accept uploaded photos as task evidence", async () => {
  for (const taskType of ["quote", "detail", "quote_and_detail"]) {
    const queries = [];
    const taskId = `quote-task-${taskType}`;
    const storageKey = `helper-app/trip-1/admin-task-photos/${taskType}.jpg`;
    const database = fakeDatabase(
      [
        {
          rows: [
            {
              assigned_helper_id: "helper-1",
              id: "trip-1",
              status: "active",
              ...todayTripFields(),
            },
          ],
        },
        { rows: [{ id: taskId, task_type: taskType }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        {
          rows: [
            {
              id: taskId,
              photos: [
                {
                  id: `quote-photo-${taskType}`,
                  source_site_photo_id: null,
                  storage_key: storageKey,
                },
              ],
            },
          ],
        },
      ],
      queries,
    );

    const task = await service.createQuoteTask(database, {
      actorUserId: "admin-user-1",
      photoIds: [],
      taskType,
      tripId: "trip-1",
      uploadedPhotos: [
        {
          byteSize: 1024,
          contentType: "image/jpeg",
          originalFilename: `${taskType}.jpg`,
          sortOrder: 0,
          storageKey,
        },
      ],
    });

    assert.equal(task.id, taskId);
    const mediaQuery = queries.find((query) =>
      String(query.sql).includes("insert into helper_app.media_objects"),
    );
    assert.ok(mediaQuery);
    assert.deepEqual(mediaQuery.params[6], [storageKey]);
    const taskPhotoQuery = queries.find((query) =>
      String(query.sql).includes("insert into helper_app.quote_task_photos"),
    );
    assert.ok(taskPhotoQuery);
    assert.deepEqual(taskPhotoQuery.params[10], [null]);
  }
});

test("quote and detail reply validates active ownership and writes durable detail media", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            authorized_helper_id: "helper-1",
            helper_id: "helper-1",
            id: "quote-photo-1",
            previous_detail_photos: null,
            quote_task_id: "quote-task-1",
            reply_status: "open",
            task_type: "quote_and_detail",
            trip_status: "active",
            trip_id: "trip-1",
          },
        ],
      },
      {
        rows: [
          {
            id: "reply-1",
            price_jpy: 1200,
            quote_task_photo_id: "quote-photo-1",
          },
        ],
      },
      { rows: [] },
      { rows: [] },
    ],
    queries,
  );

  const reply = await service.submitQuotePhotoReply(database, {
    authUserId: "user-1",
    detailPhotos: [
      {
        byteSize: 100,
        contentType: "image/jpeg",
        originalFilename: "detail.jpg",
        storageKey: "helper-app/trip-1/quote-detail-replies/quote-photo-1/detail-1.jpg",
      },
    ],
    idempotencyKey: "reply-key-1",
    priceJpy: "1200",
    quoteTaskPhotoId: "quote-photo-1",
  });

  assert.equal(reply.id, "reply-1");
  assert.equal(
    queries.some((query) => String(query.sql).includes("'quote_detail_reply_photo'")),
    true,
  );
  assert.equal(
    queries.some((query) => String(query.sql).includes("jsonb_to_recordset")),
    true,
  );
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.quote_photo_replies")),
    true,
  );
  assert.equal(
    queries.some((query) =>
      String(query.sql).includes("from helper_app.helper_profiles") &&
      !String(query.sql).includes("join helper_app.helper_profiles"),
    ),
    false,
  );
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.match(String(auditQuery.sql), /'helper_quote_photo_replied'/);
});

test("editing a quote detail reply can keep the previous detail photo", async () => {
  const queries = [];
  const previousDetailPhoto = {
    byte_size: 100,
    content_type: "image/jpeg",
    original_filename: "old-detail.jpg",
    sort_order: 0,
    storage_key: "helper-app/trip-1/quote-detail-replies/quote-photo-1/old-detail.jpg",
  };
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            authorized_helper_id: "helper-1",
            helper_id: "helper-1",
            id: "quote-photo-1",
            previous_detail_photos: [previousDetailPhoto],
            quote_task_id: "quote-task-1",
            reply_status: "replied",
            task_type: "quote_and_detail",
            trip_status: "active",
            trip_id: "trip-1",
          },
        ],
      },
      {
        rows: [
          {
            detail_photos: [previousDetailPhoto],
            id: "reply-2",
            price_jpy: 1300,
            quote_task_photo_id: "quote-photo-1",
          },
        ],
      },
      { rows: [] },
      { rows: [] },
    ],
    queries,
    false,
  );

  const reply = await service.submitQuotePhotoReply(database, {
    authUserId: "user-1",
    detailPhotos: [],
    idempotencyKey: "reply-key-2",
    priceJpy: "1300",
    quoteTaskPhotoId: "quote-photo-1",
  });

  assert.equal(reply.id, "reply-2");
  const combinedReplyQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.quote_photo_replies"),
  );
  assert.ok(combinedReplyQuery);
  assert.equal(combinedReplyQuery.params[12], false);
  assert.deepEqual(JSON.parse(combinedReplyQuery.params[9]), [previousDetailPhoto]);
});

test("admin manual purchase task creation writes an open staging workflow task", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            assigned_helper_id: "helper-1",
            id: "trip-1",
            status: "active",
            ...todayTripFields(),
          },
        ],
      },
      {
        rows: [
          {
            id: "purchase-task-1",
            purchase_batch_id: "purchase-batch-1",
            requires_face_check: false,
            status: "open",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [] },
      { rows: [] },
    ],
    queries,
  );

  const task = await service.createPurchaseTask(database, {
    actorUserId: "admin-user-1",
    lineCommunityName: "客人A",
    productName: "測試商品",
    quantity: "2",
    originalPriceJpy: "1200",
    referencePhotos: [
      {
        byteSize: 123,
        contentType: "image/png",
        originalFilename: "reference.png",
        sortOrder: 0,
        storageKey: "purchase-reference-1",
      },
    ],
    salePriceTwd: "380",
    tripId: "trip-1",
  });

  assert.equal(task.id, "purchase-task-1");
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.purchase_tasks")),
    true,
  );
  assert.equal(
    queries.some((query) => String(query.sql).includes("left join helper_app.purchase_task_photos")),
    false,
  );
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.match(String(auditQuery.sql), /'admin_purchase_task_created'/);
});

test("helper completes a purchase task and creates completed-only staging preview", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            authorized_helper_id: "helper-1",
            authorized_helper_is_active: true,
            authorized_trip_status: "active",
            helper_id: "helper-1",
            id: "purchase-task-1",
            line_community_name: "客人A",
            product_name: "測試商品",
            quantity: 3,
            original_price_jpy: 1200,
            requires_face_check: false,
            sale_price_twd: 380,
            status: "open",
            trip_id: "trip-1",
          },
        ],
      },
      {
        rows: [
          {
            completed_quantity: 3,
            helper_id: "helper-1",
            id: "purchase-task-1",
            line_community_name: "客人A",
            product_name: "測試商品",
            original_price_jpy: 1200,
            sale_price_twd: 380,
            source_quote_reply_id: null,
            source_quote_task_id: null,
            source_quote_task_photo_id: null,
            status: "completed",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [{ id: "preview-1" }] },
      { rows: [] },
    ],
    queries,
  );

  const task = await service.respondPurchaseTask(database, {
    action: "complete",
    authUserId: "user-1",
    completedQuantity: "3",
    helperNote: "已全部買到",
    idempotencyKey: "purchase-response-1",
    purchaseTaskId: "purchase-task-1",
    unavailableQuantity: "0",
  });

  assert.equal(task.status, "completed");
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.staging_order_previews")),
    true,
  );
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.equal(auditQuery.params[4], "helper_purchase_completed");
  assert.deepEqual(JSON.parse(auditQuery.params[6]), {
    completedQuantity: 3,
    purchaseTaskId: "purchase-task-1",
    remainingQuantity: 0,
    remainingResolution: null,
  });
});

test("helper general purchase report photos are stored with the completed staging task", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [{
          authorized_helper_id: "helper-1",
          authorized_helper_is_active: true,
          authorized_trip_status: "active",
          helper_id: "helper-1",
          id: "purchase-task-1",
          line_community_name: "客人A",
          product_name: "一般商品",
          quantity: 1,
          original_price_jpy: 900,
          requires_face_check: false,
          sale_price_twd: 300,
          status: "open",
          trip_id: "trip-1",
        }],
      },
      {
        rows: [{
          completed_quantity: 1,
          helper_id: "helper-1",
          id: "purchase-task-1",
          original_price_jpy: 900,
          product_name: "一般商品",
          sale_price_twd: 300,
          status: "completed",
          trip_id: "trip-1",
        }],
      },
      { rows: [] },
      { rows: [{ id: "preview-1" }] },
      { rows: [] },
    ],
    queries,
  );

  const task = await service.respondPurchaseTask(database, {
    action: "complete",
    authUserId: "user-1",
    completedQuantity: "1",
    idempotencyKey: "purchase-report-1",
    purchaseTaskId: "purchase-task-1",
    reportPhotos: [{
      byteSize: 321,
      contentType: "image/jpeg",
      originalFilename: "shelf.jpg",
      sortOrder: 0,
      storageKey: "helper-app/trip-1/purchase-reports/purchase-task-1/shelf.jpg",
    }],
  });

  assert.equal(task.status, "completed");
  const reportQuery = queries.find((query) =>
    String(query.sql).includes("'purchase_report_photo'") &&
    String(query.sql).includes("'purchase_report'"),
  );
  assert.ok(reportQuery);
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.staging_order_previews")),
    true,
  );
});

test("purchase product suggestions query only recent grouped candidates and their photos", async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ sql, params });
      return {
        rows: [{
          created_at: "2026-07-24T08:00:00.000Z",
          id: "purchase-task-1",
          note: "紅色",
          original_price_jpy: 1200,
          photos: [{ photo_role: "manual_reference", storage_key: "photo-1" }],
          product_name: "限定包",
          quantity: 1,
          requires_face_check: false,
          sale_price_twd: 380,
        }],
      };
    },
  };

  const suggestions = await service.listPurchaseProductSuggestions(database, {
    limit: 8,
    query: "限定",
    tripId: "trip-1",
  });

  assert.equal(suggestions[0].sourceTaskId, "purchase-task-1");
  assert.match(queries[0].sql, /with candidate_tasks as/);
  assert.match(queries[0].sql, /limit \$3/);
  assert.deepEqual(queries[0].params, ["trip-1", "限定", 8]);
});

test("helper purchase completion clamps over-reported quantity to requested quantity", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            authorized_helper_id: "helper-1",
            authorized_helper_is_active: true,
            authorized_trip_status: "active",
            helper_id: "helper-1",
            id: "purchase-task-1",
            line_community_name: "客人A",
            product_name: "測試商品",
            quantity: 3,
            original_price_jpy: 1200,
            requires_face_check: false,
            sale_price_twd: 380,
            status: "open",
            trip_id: "trip-1",
          },
        ],
      },
      {
        rows: [
          {
            completed_quantity: 3,
            helper_id: "helper-1",
            id: "purchase-task-1",
            line_community_name: "客人A",
            product_name: "測試商品",
            original_price_jpy: 1200,
            sale_price_twd: 380,
            source_quote_reply_id: null,
            source_quote_task_id: null,
            source_quote_task_photo_id: null,
            status: "completed",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [{ id: "preview-1" }] },
      { rows: [] },
    ],
    queries,
  );

  const task = await service.respondPurchaseTask(database, {
    action: "complete",
    authUserId: "user-1",
    completedQuantity: "9",
    idempotencyKey: "purchase-response-over",
    purchaseTaskId: "purchase-task-1",
  });

  assert.equal(task.status, "completed");
  const updateQuery = queries.find((query) =>
    String(query.sql).includes("set status = 'completed'"),
  );
  assert.ok(updateQuery);
  assert.equal(updateQuery.params[1], 3);
  assert.equal(updateQuery.params[2], 0);
});

test("helper purchase completion with zero quantity requires a cancellation reason", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            authorized_helper_id: "helper-1",
            authorized_helper_is_active: true,
            authorized_trip_status: "active",
            helper_id: "helper-1",
            id: "purchase-task-1",
            line_community_name: "客人A",
            product_name: "測試商品",
            quantity: 3,
            original_price_jpy: 1200,
            requires_face_check: false,
            sale_price_twd: 380,
            status: "open",
            trip_id: "trip-1",
          },
        ],
      },
      {
        rows: [
          {
            completed_quantity: 0,
            helper_id: "helper-1",
            id: "purchase-task-1",
            status: "canceled",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [] },
    ],
    queries,
  );

  await assert.rejects(
    () => service.respondPurchaseTask(database, {
      action: "complete",
      authUserId: "user-1",
      completedQuantity: "0",
      idempotencyKey: "purchase-response-zero",
      purchaseTaskId: "purchase-task-1",
    }),
    (error) => error.code === "invalid_input" && /reason/i.test(error.message),
  );

  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.staging_order_previews")),
    false,
  );
});

test("helper purchase completion with zero quantity and reason cancels without staging preview", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            authorized_helper_id: "helper-1",
            authorized_helper_is_active: true,
            authorized_trip_status: "active",
            helper_id: "helper-1",
            id: "purchase-task-1",
            line_community_name: "客人A",
            product_name: "測試商品",
            quantity: 3,
            original_price_jpy: 1200,
            requires_face_check: false,
            sale_price_twd: 380,
            status: "open",
            trip_id: "trip-1",
          },
        ],
      },
      {
        rows: [
          {
            completed_quantity: 0,
            helper_id: "helper-1",
            id: "purchase-task-1",
            status: "canceled",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [] },
    ],
    queries,
  );

  const task = await service.respondPurchaseTask(database, {
    action: "complete",
    authUserId: "user-1",
    completedQuantity: "0",
    helperNote: "現場缺貨，取消",
    idempotencyKey: "purchase-response-zero",
    purchaseTaskId: "purchase-task-1",
  });

  assert.equal(task.status, "canceled");
  assert.equal(task.completed_quantity, 0);
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.staging_order_previews")),
    false,
  );
  const updateQuery = queries.find((query) =>
    String(query.sql).includes("set status = $2"),
  );
  assert.ok(updateQuery);
  assert.equal(updateQuery.params[3], "現場缺貨，取消");
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.equal(auditQuery.params[4], "helper_purchase_canceled");
});

test("helper can cancel a completed purchase task and remove staging preview", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            authorized_helper_id: "helper-1",
            authorized_helper_is_active: true,
            authorized_trip_status: "active",
            completed_quantity: 1,
            helper_id: "helper-1",
            id: "purchase-task-1",
            line_community_name: "客人A",
            product_name: "測試商品",
            quantity: 1,
            original_price_jpy: 1200,
            requires_face_check: false,
            sale_price_twd: 380,
            status: "completed",
            trip_id: "trip-1",
          },
        ],
      },
      {
        rows: [
          {
            completed_quantity: null,
            helper_id: "helper-1",
            id: "purchase-task-1",
            status: "canceled",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [] },
      { rows: [] },
    ],
    queries,
  );

  const task = await service.respondPurchaseTask(database, {
    action: "cancel",
    authUserId: "user-1",
    helperNote: "現場確認拿錯商品，取消這筆",
    idempotencyKey: "purchase-cancel-1",
    purchaseTaskId: "purchase-task-1",
  });

  assert.equal(task.status, "canceled");
  assert.equal(
    queries.some((query) => String(query.sql).includes("delete from helper_app.staging_order_previews")),
    true,
  );
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.equal(auditQuery.params[4], "helper_purchase_canceled");
  assert.deepEqual(JSON.parse(auditQuery.params[6]), {
    purchaseTaskId: "purchase-task-1",
    status: "canceled",
  });
});

test("helper can complete a partial purchase without unavailable or not-found reason", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            authorized_helper_id: "helper-1",
            authorized_helper_is_active: true,
            authorized_trip_status: "active",
            helper_id: "helper-1",
            id: "purchase-task-1",
            line_community_name: "客人A",
            product_name: "測試商品",
            quantity: 3,
            completed_quantity: 1,
            original_price_jpy: 1200,
            requires_face_check: false,
            sale_price_twd: 380,
            status: "open",
            trip_id: "trip-1",
          },
        ],
      },
      {
        rows: [
          {
            completed_quantity: 2,
            helper_id: "helper-1",
            id: "purchase-task-1",
            line_community_name: "客人A",
            product_name: "測試商品",
            original_price_jpy: 1200,
            sale_price_twd: 380,
            source_quote_reply_id: null,
            source_quote_task_id: null,
            source_quote_task_photo_id: null,
            status: "open",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [] },
    ],
    queries,
  );

  const task = await service.respondPurchaseTask(database, {
    action: "complete",
    authUserId: "user-1",
    completedQuantity: "1",
    idempotencyKey: "purchase-response-partial",
    purchaseTaskId: "purchase-task-1",
  });

  assert.equal(task.status, "open");
  const updateQuery = queries.find((query) =>
    String(query.sql).includes("set status = 'open'"),
  );
  assert.ok(updateQuery);
  assert.equal(updateQuery.params[1], 2);
  assert.equal(updateQuery.params[2], 1);
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.staging_order_previews")),
    false,
  );
});

test("helper face-check photo response writes media and task photo without redundant media update", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            authorized_helper_id: "helper-1",
            authorized_helper_is_active: true,
            authorized_trip_status: "active",
            helper_id: "helper-1",
            id: "purchase-task-1",
            line_community_name: "客人A",
            product_name: "挑臉商品",
            quantity: 1,
            original_price_jpy: 1800,
            requires_face_check: true,
            sale_price_twd: 560,
            status: "open",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          {
            completed_quantity: 1,
            helper_id: "helper-1",
            id: "purchase-task-1",
            status: "review_pending",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [] },
    ],
    queries,
  );

  const task = await service.respondPurchaseTask(database, {
    action: "complete",
    authUserId: "user-1",
    completedQuantity: "1",
    faceCheckPhoto: {
      byteSize: 1024,
      contentType: "image/jpeg",
      originalFilename: "face.jpg",
      storageKey: "helper-app/trip-1/purchase-face-check/purchase-task-1/face.jpg",
    },
    idempotencyKey: "face-check-upload-1",
    purchaseTaskId: "purchase-task-1",
  });

  assert.equal(task.status, "review_pending");
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.purchase_task_photos")),
    true,
  );
  assert.equal(
    queries.some((query) =>
      String(query.sql).includes("on conflict (purchase_task_id, photo_role, sort_order) do update") &&
      String(query.sql).includes("set storage_key = excluded.storage_key")
    ),
    true,
  );
  assert.equal(
    queries.some((query) =>
      String(query.sql).includes("set retention_status = 'order_evidence'") &&
      String(query.sql).includes("where storage_key = $1")
    ),
    false,
  );
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.equal(auditQuery.params[4], "helper_purchase_face_check_submitted");
});

test("admin face-check approval waits for helper final confirmation", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            id: "purchase-task-1",
            requires_face_check: true,
            status: "review_pending",
            trip_id: "trip-1",
          },
        ],
      },
      {
        rows: [
          {
            id: "purchase-task-1",
            status: "approved_pending_helper_confirmation",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [] },
    ],
    queries,
  );

  const task = await service.reviewFaceCheckPurchaseTask(database, {
    action: "approve",
    actorUserId: "admin-user-1",
    purchaseTaskId: "purchase-task-1",
  });

  assert.equal(task.status, "approved_pending_helper_confirmation");
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.staging_order_previews")),
    false,
  );
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.equal(auditQuery.params[4], "admin_face_check_approved");
});

test("helper final confirmation completes an approved face-check purchase and creates staging preview", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [
          {
            authorized_helper_id: "helper-1",
            authorized_helper_is_active: true,
            authorized_trip_status: "active",
            completed_quantity: 1,
            helper_id: "helper-1",
            id: "purchase-task-1",
            line_community_name: "客人A",
            product_name: "挑臉商品",
            quantity: 1,
            original_price_jpy: 1800,
            requires_face_check: true,
            sale_price_twd: 560,
            status: "approved_pending_helper_confirmation",
            trip_id: "trip-1",
          },
        ],
      },
      {
        rows: [
          {
            completed_quantity: 1,
            helper_id: "helper-1",
            id: "purchase-task-1",
            line_community_name: "客人A",
            product_name: "挑臉商品",
            original_price_jpy: 1800,
            sale_price_twd: 560,
            source_quote_reply_id: null,
            source_quote_task_id: null,
            source_quote_task_photo_id: null,
            source_rebuy_task_id: null,
            status: "completed",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [{ id: "preview-1" }] },
      { rows: [] },
    ],
    queries,
  );

  const task = await service.respondPurchaseTask(database, {
    action: "complete",
    authUserId: "user-1",
    completedQuantity: "1",
    idempotencyKey: "face-check-final-1",
    purchaseTaskId: "purchase-task-1",
  });

  assert.equal(task.status, "completed");
  assert.equal(
    queries.some((query) => String(query.sql).includes("insert into helper_app.staging_order_previews")),
    true,
  );
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.equal(auditQuery.params[4], "helper_purchase_face_check_confirmed");
});

test("helper cannot end a trip while a purchase task is unfinished", async () => {
  const database = fakeDatabase([
    {
      rows: [
        {
          auth_user_id: "auth-helper-1",
          compensation_mode: "hourly",
          hourly_rate_twd: 200,
          id: "helper-1",
          is_active: true,
        },
      ],
    },
    {
      rows: [
        {
          assigned_helper_id: "helper-1",
          departed_at: "2026-06-28T01:00:00.000Z",
          id: "trip-1",
          status: "active",
          version: 3,
        },
      ],
    },
    { rows: [{ count: 1 }] },
  ]);

  await assert.rejects(
    () =>
      service.markHelperEnded(database, {
        authUserId: "auth-helper-1",
        expectedVersion: 3,
        tripId: "trip-1",
      }),
    (error) => error.code === "unfinished_purchase_tasks",
  );
});

test("settlement precheck requires transport amount and route note together", async () => {
  await assert.rejects(
    () =>
      service.submitSettlementPrecheck({}, {
        authUserId: "auth-helper-1",
        idempotencyKey: "settlement-submit-1",
        receipt: {
          byteSize: 10,
          contentType: "image/jpeg",
          originalFilename: "receipt.jpg",
          storageKey: "receipt-key",
        },
        settlementId: "settlement-1",
        transportJpy: 500,
      }),
    (error) => error.code === "invalid_transport_claim",
  );
});

test("settlement precheck allows optional transport photo when amount and route note exist", async () => {
  const queries = [];
  const settlement = {
    helper_id: "helper-1",
    id: "settlement-1",
    status: "pending_helper_precheck",
    trip_id: "trip-1",
  };
  const database = fakeDatabase(
    [
      {
        rows: [{
          auth_user_id: "auth-helper-1",
          id: "helper-1",
          is_active: true,
        }],
      },
      { rows: [settlement] },
      { rows: [] },
      { rows: [] },
      {
        rows: [{
          ...settlement,
          status: "pending_admin_review",
          transport_claim_jpy: 500,
          transport_claim_note: "Shinjuku to Ikebukuro",
        }],
      },
      { rows: [] },
    ],
    queries,
  );

  const result = await service.submitSettlementPrecheck(database, {
    authUserId: "auth-helper-1",
    helperNote: "",
    idempotencyKey: "settlement-submit-1",
    receipt: {
      byteSize: 10,
      contentType: "image/jpeg",
      originalFilename: "receipt.jpg",
      storageKey: "receipt-key",
    },
    settlementId: "settlement-1",
    transportClaimNote: "Shinjuku to Ikebukuro",
    transportJpy: 500,
  });

  assert.equal(result.status, "pending_admin_review");
  assert.equal(
    queries.filter((query) => String(query.sql).includes("settlement_evidence")).length,
    1,
  );
  const update = queries.find((query) =>
    String(query.sql).includes("transport_claim_note = $3"),
  );
  assert.equal(update.params[2], "Shinjuku to Ikebukuro");
});

test("settlement precheck batches receipt and transport evidence writes", async () => {
  const queries = [];
  const settlement = {
    helper_id: "helper-1",
    id: "settlement-1",
    status: "pending_helper_precheck",
    trip_id: "trip-1",
  };
  const database = fakeDatabase(
    [
      {
        rows: [{
          auth_user_id: "auth-helper-1",
          id: "helper-1",
          is_active: true,
        }],
      },
      { rows: [settlement] },
      { rows: [] },
      { rows: [] },
      {
        rows: [{
          ...settlement,
          status: "pending_admin_review",
          transport_claim_jpy: 500,
          transport_claim_note: "Shinjuku to Ikebukuro",
        }],
      },
      { rows: [] },
    ],
    queries,
  );

  await service.submitSettlementPrecheck(database, {
    authUserId: "auth-helper-1",
    helperNote: "",
    idempotencyKey: "settlement-submit-1",
    receipt: {
      byteSize: 10,
      contentType: "image/jpeg",
      originalFilename: "receipt.jpg",
      storageKey: "receipt-key",
    },
    settlementId: "settlement-1",
    transportClaimNote: "Shinjuku to Ikebukuro",
    transportJpy: 500,
    transportProof: {
      byteSize: 12,
      contentType: "image/jpeg",
      originalFilename: "transport.jpg",
      storageKey: "transport-key",
    },
  });

  const mediaInsert = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.media_objects") &&
    String(query.sql).includes("unnest")
  );
  const evidenceInsert = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.settlement_evidence") &&
    String(query.sql).includes("unnest")
  );
  assert.deepEqual(mediaInsert.params[0], ["receipt-key", "transport-key"]);
  assert.deepEqual(evidenceInsert.params[2], ["daily_receipt", "transport_proof"]);
  assert.equal(
    queries.filter((query) => String(query.sql).includes("settlement_evidence")).length,
    1,
  );
});

test("ending an eligible trip records quote warnings and creates a staging-based settlement", async () => {
  const queries = [];
  const endedTrip = {
    assigned_helper_id: "helper-1",
    departed_at: "2026-06-28T01:00:00.000Z",
    ended_at: "2026-06-28T03:00:00.000Z",
    id: "trip-1",
    status: "ended",
    version: 4,
  };
  const database = fakeDatabase(
    [
      {
        rows: [{
          compensation_mode: "hourly",
          hourly_rate_twd: 200,
          id: "helper-1",
          is_active: true,
        }],
      },
      {
        rows: [{
          assigned_helper_id: "helper-1",
          departed_at: "2026-06-28T01:00:00.000Z",
          id: "trip-1",
          status: "active",
          version: 3,
        }],
      },
      { rows: [{ count: 0 }] },
      { rows: [{ count: 2 }] },
      { rows: [endedTrip] },
      { rows: [] },
      { rows: [{ product_total_jpy: 12_000 }] },
      {
        rows: [{
          id: "settlement-1",
          product_total_jpy: 12_000,
          status: "pending_helper_precheck",
          trip_id: "trip-1",
        }],
      },
      { rows: [] },
    ],
    queries,
  );

  const result = await service.markHelperEnded(database, {
    authUserId: "auth-helper-1",
    expectedVersion: 3,
    tripId: "trip-1",
  });

  assert.equal(result.trip.status, "ended");
  assert.equal(result.settlement.id, "settlement-1");
  const audit = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.equal(JSON.parse(audit.params[6]).unfinishedQuoteSubtasks, 2);
  assert.equal(
    queries.some((query) => String(query.sql).includes("from helper_app.staging_order_previews")),
    true,
  );
});

test("admin settlement review calculates source-derived totals and split state", async () => {
  const queries = [];
  const settlement = {
    compensation_mode: "hourly",
    helper_id: "helper-1",
    hourly_rate_twd: 200,
    id: "settlement-1",
    product_total_jpy: 100_000,
    status: "pending_admin_review",
    transport_claim_jpy: 1_000,
    transport_status: "pending",
    trip_id: "trip-1",
    work_minutes: 120,
  };
  const database = fakeDatabase(
    [
      { rows: [settlement] },
      {
        rows: [{
          ...settlement,
          approved_transport_twd: 220,
          is_split_payment: true,
          item_advance_twd: 22_000,
          status: "pending_helper_confirmation",
          total_payable_twd: 22_620,
          work_pay_twd: 400,
        }],
      },
      { rows: [] },
    ],
    queries,
  );

  const result = await service.reviewSettlement(database, {
    action: "approve",
    actorUserId: "admin-1",
    jpyToTwdRate: "0.22",
    settlementId: "settlement-1",
    transportDecision: "approve",
  });

  assert.equal(result.item_advance_twd, 22_000);
  assert.equal(result.total_payable_twd, 22_620);
  assert.equal(result.is_split_payment, true);
  const update = queries.find((query) =>
    String(query.sql).includes("set status = 'pending_helper_confirmation'"),
  );
  assert.deepEqual(update.params.slice(1, 8), [0.22, 22_000, 400, 220, 22_620, true, true]);
});

test("admin can set settlement exchange rate before helper precheck", async () => {
  const queries = [];
  const settlement = {
    id: "settlement-1",
    item_advance_twd: null,
    jpy_to_twd_rate: null,
    product_total_jpy: 10_000,
    status: "pending_helper_precheck",
    trip_id: "trip-1",
  };
  const database = fakeDatabase(
    [
      {
        rows: [{
          ...settlement,
          item_advance_twd: 2_200,
          jpy_to_twd_rate: 0.22,
        }],
      },
    ],
    queries,
  );

  const result = await service.setSettlementExchangeRate(database, {
    actorUserId: "admin-1",
    jpyToTwdRate: "0.22",
    settlementId: "settlement-1",
  });

  assert.equal(result.status, "pending_helper_precheck");
  assert.equal(result.item_advance_twd, 2_200);
  const update = queries.find((query) =>
    String(query.sql).includes("set jpy_to_twd_rate = $2"),
  );
  assert.match(update.sql, /with target as/);
  assert.match(update.sql, /insert into helper_app\.trip_audit_events/);
  assert.doesNotMatch(update.sql, /for update/);
  assert.deepEqual(update.params, ["settlement-1", 0.22, "admin-1"]);
});

test("public rebuy claim locks version and records ownership atomically", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      { rows: [{ id: "helper-1", is_active: true }] },
      { rows: [] },
      {
        rows: [{
          id: "rebuy-1",
          source_trip_id: "trip-1",
          status: "open",
          version: 4,
          visibility: "public",
        }],
      },
      {
        rows: [{
          claimed_helper_id: "helper-1",
          id: "rebuy-1",
          status: "claimed",
          version: 5,
        }],
      },
      { rows: [] },
    ],
    queries,
  );

  const result = await service.claimPublicRebuyTask(database, {
    authUserId: "user-1",
    expectedVersion: "4",
    idempotencyKey: "claim-key-1",
    rebuyTaskId: "rebuy-1",
  });

  assert.equal(result.status, "claimed");
  const update = queries.find((query) =>
    String(query.sql).includes("set status = 'claimed'"),
  );
  assert.deepEqual(update.params, ["rebuy-1", "helper-1", "claim-key-1", 4]);
  assert.equal(
    queries.some((query) => query.params?.includes("helper_rebuy_claimed")),
    true,
  );
});

test("rebuy partial report requires a remaining-quantity reason", async () => {
  const database = fakeDatabase([
    { rows: [{ id: "helper-1", is_active: true }] },
    {
      rows: [{
        assigned_helper_id: "helper-1",
        claimed_helper_id: null,
        id: "rebuy-1",
        quantity: 3,
        status: "open",
        visibility: "private",
      }],
    },
  ]);

  await assert.rejects(
    () =>
      service.reportRebuyTask(database, {
        authUserId: "user-1",
        idempotencyKey: "report-key-1",
        rebuyTaskId: "rebuy-1",
        reportPhotosOmitted: true,
        reportedQuantity: "1",
      }),
    /remaining-quantity reason/,
  );
});

test("private rebuy report keeps claimed ownership empty", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      { rows: [{ id: "helper-1", is_active: true }] },
      {
        rows: [{
          assigned_helper_id: "helper-1",
          claimed_helper_id: null,
          id: "rebuy-1",
          quantity: 3,
          source_trip_id: null,
          status: "open",
          visibility: "private",
        }],
      },
      {
        rows: [{
          assigned_helper_id: "helper-1",
          claimed_helper_id: null,
          id: "rebuy-1",
          report_photos_omitted: true,
          status: "reported",
        }],
      },
      { rows: [] },
    ],
    queries,
  );

  const result = await service.reportRebuyTask(database, {
    authUserId: "user-1",
    idempotencyKey: "report-key-1",
    rebuyTaskId: "rebuy-1",
    reportPhotosOmitted: true,
    reportedQuantity: "3",
  });

  assert.equal(result.status, "reported");
  const update = queries.find((query) =>
    String(query.sql).includes("set status = 'reported'"),
  );
  assert.match(String(update.sql), /when visibility = 'public'/);
  assert.deepEqual(
    update.params.slice(0, 5),
    ["rebuy-1", "helper-1", "report-key-1", 3, 0],
  );
});

test("staging review can start only after a trip ends", async () => {
  const database = fakeDatabase([
    {
      rows: [{
        id: "trip-1",
        status: "active",
      }],
    },
  ]);

  await assert.rejects(
    () =>
      service.prepareStagingReview(database, {
        actorUserId: "admin-1",
        tripId: "trip-1",
      }),
    /Only ended trips/,
  );
});

test("staging merge approval blocks unconfirmed unknown customers", async () => {
  const database = fakeDatabase([
    {
      rows: [{
        id: "merge-1",
        status: "pending_review",
        trip_id: "trip-1",
        version: 3,
      }],
    },
    {
      rows: [{
        id: "trip-1",
        status: "ended",
      }],
    },
    { rows: [{ id: "order-1", line_community_name: "小明", product_name: "測試商品" }] },
  ]);

  await assert.rejects(
    () =>
      service.approveStagingMergeJob(database, {
        actorUserId: "admin-1",
        expectedVersion: 3,
        mergeJobId: "merge-1",
      }),
    /以下訂單的客戶暱稱尚未特別確認：.*小明.*測試商品/,
  );
});

test("reviewed staging photo edits update labels, include flags, and revoke approval", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [{
          id: "reviewed-order-1",
          merge_job_id: "merge-1",
          trip_id: "trip-1",
        }],
      },
      {
        rows: [{
          id: "merge-1",
          status: "approved",
        }],
      },
      {
        rows: [{ id: "photo-1" }],
      },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      {
        rows: [{
          id: "merge-1",
          reviewed_orders: [],
        }],
      },
    ],
    queries,
  );

  await service.editReviewedStagingOrderPhotos(database, {
    actorUserId: "admin-1",
    photos: [{ id: "photo-1", includeInMerge: false, label: "不合併" }],
    reviewedOrderId: "reviewed-order-1",
  });

  assert.equal(
    queries.some((query) => String(query.sql).includes("jsonb_to_recordset($2::jsonb)")),
    true,
  );
  assert.equal(
    queries.some((query) => String(query.sql).includes("set status = 'pending_review'")),
    true,
  );
});

test("admin can select only the reviewed staging orders to merge", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      {
        rows: [{
          id: "merge-1",
          status: "pending_review",
          trip_id: "trip-1",
          version: 4,
        }],
      },
      {
        rows: [{ total_count: 2, selected_count: 1 }],
      },
      { rows: [{ id: "order-2" }], rowCount: 1 },
      { rows: [] },
    ],
    queries,
  );

  const result = await service.setReviewedStagingOrderSelection(database, {
    actorUserId: "admin-1",
    exclusionReason: "客戶取消其中一筆",
    expectedVersion: 4,
    mergeJobId: "merge-1",
    selectedOrderIds: ["order-1", "order-1"],
  });

  assert.deepEqual(result, {
    approvalRevoked: false,
    changedCount: 1,
    excludedCount: 1,
    mergeJobId: "merge-1",
    selectedCount: 1,
  });
  assert.equal(
    queries.some((query) => String(query.sql).includes("is_excluded = not (id = any($2::uuid[]))")),
    true,
  );
  assert.equal(
    queries.some((query) => query.params?.includes("admin_reviewed_staging_order_selection_changed")),
    true,
  );
});

test("approved staging merge writes main order, source link, and selected photos", async () => {
  const queries = [];
  const copied = [];
  const approvedSnapshot = {
    orders: [
      {
        appearanceNotes: "",
        customerConfirmed: false,
        customerExists: true,
        helperId: "helper-1",
        lineCommunityName: "小明",
        originalPriceJpy: 1200,
        photos: [
          {
            id: "review-photo-1",
            label: "正面",
            photoRole: "manual_reference",
            sourcePurchaseTaskPhotoId: "purchase-photo-1",
            storageKey: "helper-app/trip-1/purchase/a.jpg",
          },
        ],
        productName: "測試商品",
        purchaseTaskId: "purchase-1",
        quantity: 2,
        reviewedOrderId: "reviewed-order-1",
        salePriceTwd: 300,
        sourceQuoteTaskId: null,
        sourceQuoteTaskPhotoId: null,
        sourceRebuyTaskId: null,
        stagingOrderPreviewId: "preview-1",
      },
    ],
    trip: {
      business_date: "2026-07-01",
      timezone: "Asia/Tokyo",
      trip_name: "Slice 7 Trip",
    },
  };
  const database = fakeDatabase(
    [
      {
        rows: [{
          approved_snapshot: approvedSnapshot,
          id: "merge-1",
          status: "approved",
          trip_id: "trip-1",
          version: 4,
        }],
      },
      { rows: [] },
      { rows: [{ id: "merge-1", status: "merging", merge_idempotency_key: "merge-key-1" }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      {
        rows: [{
          id: "merge-1",
          main_order_ids: ["helper_order_x"],
          status: "merged",
        }],
      },
      { rows: [] },
      { rows: [] },
    ],
    queries,
  );

  const result = await service.mergeApprovedStagingJob(database, {
    actorUserId: "admin-1",
    expectedVersion: 4,
    idempotencyKey: "merge-key-1",
    mergeJobId: "merge-1",
    r2Store: {
      async copyObject(sourceKey, destinationKey) {
        copied.push({ destinationKey, sourceKey });
      },
    },
  });

  assert.equal(result.status, "merged");
  assert.equal(queries.some((query) => String(query.sql).includes("insert into main.orders")), true);
  assert.equal(queries.some((query) => String(query.sql).includes("insert into main.order_source_links")), true);
  assert.equal(queries.some((query) => String(query.sql).includes("insert into main.order_photos")), true);
  assert.deepEqual(copied, [{
    destinationKey: "main-orders/merge-1/helper_order_748d4ca109ce9a5e6d6eeaff/helper_photo_d6aee960526e48d4a67c9801.jpg",
    sourceKey: "helper-app/trip-1/purchase/a.jpg",
  }]);
});

function fakeDatabase(results, queries = []) {
  let index = 0;
  async function nextQuery(sql, params) {
    queries.push({ params, sql });
    if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [] };
    const result = results[index];
    index += 1;
    if (!result) throw new Error(`Unexpected query: ${sql}`);
    return result;
  }
  return {
    query: nextQuery,
    async connect() {
      return {
        query: nextQuery,
        release() {},
      };
    },
  };
}
