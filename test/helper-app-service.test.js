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

test("groups trips by each trip timezone", () => {
  const now = new Date("2026-06-22T15:30:00.000Z");
  const groups = service.groupTripsByLocalDate(
    [
      { business_date: "2026-06-23", status: "scheduled", timezone: "Asia/Tokyo" },
      { business_date: "2026-06-22", status: "scheduled", timezone: "Pacific/Honolulu" },
      { business_date: "2026-06-24", status: "scheduled", timezone: "Asia/Tokyo" },
      { business_date: "2026-06-23", status: "ended", timezone: "Asia/Tokyo" },
    ],
    now,
  );

  assert.equal(groups.today.length, 2);
  assert.equal(groups.today[0].timezone, "Asia/Tokyo");
  assert.equal(groups.upcoming.length, 1);
  assert.equal(groups.history.length, 1);
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

  assert.equal(groups.today.length, 1);
  assert.equal(service.dateOnly(new Date("2026-06-23T00:00:00.000Z"), "Asia/Tokyo"), "2026-06-23");
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

test("site photo batch commit rejects inactive trip states", async () => {
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
    /active trips/,
  );
});

test("site photo batch commit rejects non-today trips even when active", async () => {
  const database = fakeDatabase([
    { rows: [{ id: "helper-1", is_active: true }] },
    {
      rows: [
        {
          assigned_helper_id: "helper-1",
          id: "trip-1",
          status: "active",
          version: 3,
          ...tripFieldsWithDayOffset(1),
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
    /today/,
  );
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
