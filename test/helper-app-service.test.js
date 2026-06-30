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
  assert.match(queries[0].sql, /order by line_community_name asc/);
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
  assert.equal(auditQuery.params[4], "admin_quote_task_created");
});

test("admin detail task creation requires uploaded photos and stores them as task evidence", async () => {
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
      { rows: [{ id: "quote-task-detail-1", task_type: "detail" }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          {
            id: "quote-task-detail-1",
            photos: [
              {
                id: "quote-photo-detail-1",
                source_site_photo_id: null,
                storage_key: "helper-app/trip-1/admin-task-photos/upload-1.jpg",
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
    taskType: "detail",
    tripId: "trip-1",
    uploadedPhotos: [
      {
        byteSize: 1024,
        contentType: "image/jpeg",
        originalFilename: "detail-source.jpg",
        sortOrder: 0,
        storageKey: "helper-app/trip-1/admin-task-photos/upload-1.jpg",
      },
    ],
  });

  assert.equal(task.id, "quote-task-detail-1");
  const mediaQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.media_objects"),
  );
  assert.ok(mediaQuery);
  assert.equal(mediaQuery.params[0], "helper-app/trip-1/admin-task-photos/upload-1.jpg");
  const taskPhotoQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.quote_task_photos"),
  );
  assert.ok(taskPhotoQuery);
  assert.equal(taskPhotoQuery.params[3], null);
});

test("quote and detail reply validates active ownership and writes durable detail media", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      { rows: [{ id: "helper-1", is_active: true }] },
      {
        rows: [
          {
            helper_id: "helper-1",
            id: "quote-photo-1",
            quote_task_id: "quote-task-1",
            reply_status: "open",
            task_type: "quote_and_detail",
            trip_id: "trip-1",
          },
        ],
      },
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
      { rows: [] },
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
      { rows: [{ total: 1, replied: 1, has_review: false }] },
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
    queries.some((query) => String(query.sql).includes("insert into helper_app.quote_photo_replies")),
    true,
  );
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.equal(auditQuery.params[4], "helper_quote_photo_replied");
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
            requires_face_check: false,
            status: "open",
            trip_id: "trip-1",
          },
        ],
      },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          {
            id: "purchase-task-1",
            photos: [
              {
                photo_role: "manual_reference",
                storage_key: "purchase-reference-1",
              },
            ],
            requires_face_check: false,
            status: "open",
            trip_id: "trip-1",
          },
        ],
      },
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
  const auditQuery = queries.find((query) =>
    String(query.sql).includes("insert into helper_app.trip_audit_events"),
  );
  assert.ok(auditQuery);
  assert.equal(auditQuery.params[4], "admin_purchase_task_created");
});

test("helper completes a purchase task and creates completed-only staging preview", async () => {
  const queries = [];
  const database = fakeDatabase(
    [
      { rows: [{ id: "helper-1", is_active: true }] },
      {
        rows: [
          {
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
            assigned_helper_id: "helper-1",
            id: "trip-1",
            status: "active",
            version: 3,
            ...todayTripFields(),
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
    completedQuantity: "2",
    idempotencyKey: "purchase-response-1",
    purchaseTaskId: "purchase-task-1",
    unavailableQuantity: "1",
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
      { rows: [settlement] },
      {
        rows: [{
          ...settlement,
          item_advance_twd: 2_200,
          jpy_to_twd_rate: 0.22,
        }],
      },
      { rows: [] },
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
  assert.deepEqual(update.params, ["settlement-1", 0.22, 2_200]);
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

function fakeDatabase(results, queries = []) {
  return {
    async connect() {
      let index = 0;
      return {
        async query(sql, params) {
          queries.push({ params, sql });
          if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [] };
          const result = results[index];
          index += 1;
          if (!result) throw new Error(`Unexpected query: ${sql}`);
          return result;
        },
        release() {},
      };
    },
  };
}
