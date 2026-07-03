const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const database = require("../src/server/database");
const { authServerConfig, databaseConfig } = require("../src/server/config");
const { loadLocalEnv } = require("../src/server/load-local-env");
const { createR2ObjectStore } = require("../src/server/r2-object-store");
const service = require("../src/server/helper-app-service");

loadLocalEnv(path.join(__dirname, ".."));

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertRejects(operation, message) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(message);
}

function randomPassword() {
  return `CodexSlice7-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
}

function todayInTokyo() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date());
}

async function createAuthUser(supabase, email, password) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (error) throw error;
  return { email, id: data.user.id, password };
}

async function createFixture(supabase) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await createAuthUser(
    supabase,
    `codex-slice7-helper-${stamp}@example.com`,
    randomPassword(),
  );
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const helper = await insertHelper(client, user, "Codex Slice 7 Helper");
    const trip = await insertActiveTrip(client, helper.id, todayInTokyo(), "Codex Slice 7 Merge");
    return { helper, trip, user };
  } catch (error) {
    await cleanupFixture(supabase, { user }, []);
    throw error;
  } finally {
    await client.end();
  }
}

async function insertHelper(client, user, displayName) {
  const result = await client.query(
    `insert into helper_app.helper_profiles
       (auth_user_id, display_name, email, compensation_mode, hourly_rate_twd,
        bank_account_name, bank_code, bank_account_number, region, is_active)
     values ($1, $2, $3, 'hourly', 240, $2, '812', '1234567890', 'Tokyo', true)
     returning id`,
    [user.id, displayName, user.email],
  );
  return result.rows[0];
}

async function insertActiveTrip(client, helperId, businessDate, tripName) {
  const result = await client.query(
    `insert into helper_app.trips
       (trip_name, business_date, scheduled_time, location, timezone,
        assigned_helper_id, status, departed_at, arrived_at, admin_activated_at)
     values ($1, $2, '10:00', 'Tokyo', 'Asia/Tokyo', $3, 'active',
        now() - interval '2 hours', now() - interval '100 minutes',
        now() - interval '90 minutes')
     returning id, version`,
    [tripName, businessDate, helperId],
  );
  return result.rows[0];
}

async function uploadFixturePhoto(r2, tripId, label, storageKeys) {
  const storageKey = [
    "helper-app",
    tripId,
    "slice7-acceptance",
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
  ].join("/");
  const uploadUrl = await r2.signedPutUrl(storageKey, "image/png");
  const response = await fetch(uploadUrl, {
    body: PNG,
    headers: { "content-type": "image/png" },
    method: "PUT",
  });
  assert(response.ok, `R2 upload failed for ${label}: ${response.status}`);
  storageKeys.push(storageKey);
  return {
    byteSize: PNG.length,
    contentType: "image/png",
    originalFilename: `${label}.png`,
    sortOrder: label.endsWith("secondary") ? 1 : 0,
    storageKey,
  };
}

async function cleanupFixture(supabase, fixture, storageKeys = []) {
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const tripId = fixture.trip?.id;
    const helperId = fixture.helper?.id;
    if (tripId) {
      const mainPhotos = await client.query(
        `select storage_key from main.order_photos
         where order_id in (
           select order_id from main.orders
           where merge_job_id in (select id::text from helper_app.staging_merge_jobs where trip_id = $1)
         )`,
        [tripId],
      );
      storageKeys.push(...mainPhotos.rows.map((row) => row.storage_key).filter(Boolean));
      await client.query("delete from audit.merge_object_copies where merge_job_id in (select id::text from helper_app.staging_merge_jobs where trip_id = $1)", [tripId]);
      await client.query("delete from main.order_photos where order_id in (select order_id from main.orders where merge_job_id in (select id::text from helper_app.staging_merge_jobs where trip_id = $1))", [tripId]);
      await client.query("delete from main.order_source_links where merge_job_id in (select id::text from helper_app.staging_merge_jobs where trip_id = $1)", [tripId]);
      await client.query("delete from main.orders where merge_job_id in (select id::text from helper_app.staging_merge_jobs where trip_id = $1)", [tripId]);
      await client.query("delete from helper_app.staging_merge_jobs where trip_id = $1", [tripId]);
      await client.query("delete from helper_app.settlement_line_items where settlement_id in (select id from helper_app.settlements where trip_id = $1)", [tripId]);
      await client.query("delete from helper_app.settlements where trip_id = $1", [tripId]);
      await client.query("delete from helper_app.staging_order_previews where trip_id = $1", [tripId]);
      await client.query("delete from helper_app.purchase_task_photos where trip_id = $1", [tripId]);
      await client.query("delete from helper_app.purchase_tasks where trip_id = $1", [tripId]);
      await client.query("delete from helper_app.trip_audit_events where trip_id = $1", [tripId]);
      await client.query("delete from helper_app.trips where id = $1", [tripId]);
      await client.query("delete from helper_app.media_objects where storage_key = any($1::text[])", [storageKeys]);
    }
    if (helperId) {
      await client.query("delete from helper_app.helper_profiles where id = $1", [helperId]);
    }
  } finally {
    await client.end();
  }

  const r2 = createR2ObjectStore();
  for (const storageKey of [...new Set(storageKeys)]) {
    try {
      await r2.deleteObject(storageKey);
    } catch (error) {
      console.error(`Failed to delete R2 object ${storageKey}:`, error.message);
    }
  }

  if (fixture.user?.id) {
    const { error } = await supabase.auth.admin.deleteUser(fixture.user.id);
    if (error) console.error(`Failed to delete auth user ${fixture.user.id}:`, error.message);
  }
}

async function main() {
  const supabase = createClient(authServerConfig().url, authServerConfig().secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const fixture = await createFixture(supabase);
  const storageKeys = [];

  try {
    const pool = database.getDatabasePool();
    const r2 = createR2ObjectStore();
    const primaryPhoto = await uploadFixturePhoto(r2, fixture.trip.id, "primary", storageKeys);
    const secondaryPhoto = await uploadFixturePhoto(r2, fixture.trip.id, "secondary", storageKeys);
    const purchase = await service.createPurchaseTask(pool, {
      actorUserId: fixture.user.id,
      lineCommunityName: `Slice7未知客人-${Date.now()}`,
      originalPriceJpy: "1200",
      productName: "Slice 7 Merge Product",
      quantity: "1",
      referencePhotos: [primaryPhoto, secondaryPhoto],
      salePriceTwd: "360",
      tripId: fixture.trip.id,
    });
    await service.respondPurchaseTask(pool, {
      action: "complete",
      authUserId: fixture.user.id,
      completedQuantity: "1",
      idempotencyKey: `slice7-complete-${Date.now()}`,
      purchaseTaskId: purchase.id,
    });
    await service.markHelperEnded(pool, {
      authUserId: fixture.user.id,
      expectedVersion: fixture.trip.version,
      tripId: fixture.trip.id,
    });

    const preparedJob = await service.prepareStagingReview(pool, {
      actorUserId: fixture.user.id,
      tripId: fixture.trip.id,
    });
    let [prepared] = (await service.listStagingMergeJobs(pool)).filter((item) => item.id === preparedJob.id);
    const order = prepared.reviewed_orders[0];
    assert(order, "Staging review did not create a reviewed order.");
    assert(order.photos.length === 2, "Reviewed order did not include purchase photos.");

    await assertRejects(
      () =>
        service.approveStagingMergeJob(pool, {
          actorUserId: fixture.user.id,
          expectedVersion: prepared.version,
          mergeJobId: prepared.id,
        }),
      "Unknown customer approval gate did not block.",
    );

    await service.editReviewedStagingOrderPhotos(pool, {
      actorUserId: fixture.user.id,
      photos: order.photos.map((photo, index) => ({
        id: photo.id,
        includeInMerge: index === 0,
        label: index === 0 ? "正面" : "排除備查",
      })),
      reviewedOrderId: order.id,
    });
    let [job] = (await service.listStagingMergeJobs(pool)).filter((item) => item.id === prepared.id);
    await service.editReviewedStagingOrder(pool, {
      actorUserId: fixture.user.id,
      appearanceNotes: "驗收外觀",
      customerConfirmed: true,
      exclusionReason: "",
      isExcluded: false,
      lineCommunityName: order.line_community_name,
      originalPriceJpy: String(order.original_price_jpy || 0),
      productName: order.product_name,
      quantity: String(order.quantity),
      reviewedOrderId: order.id,
      salePriceTwd: String(order.sale_price_twd),
    });
    [job] = (await service.listStagingMergeJobs(pool)).filter((item) => item.id === prepared.id);
    const approved = await service.approveStagingMergeJob(pool, {
      actorUserId: fixture.user.id,
      expectedVersion: job.version,
      mergeJobId: job.id,
    });
    assert(approved.status === "approved", "Merge job was not approved.");
    assert(approved.approved_snapshot.orders[0].photos.length === 1, "Approval snapshot did not freeze only selected photos.");

    const merged = await service.mergeApprovedStagingJob(pool, {
      actorUserId: fixture.user.id,
      expectedVersion: approved.version,
      idempotencyKey: `slice7-merge-${approved.id}-${approved.version}`,
      mergeJobId: approved.id,
      r2Store: r2,
    });
    assert(merged.status === "merged", "Merge job was not marked merged.");

    const client = new Client(databaseConfig());
    await client.connect();
    try {
      const mainOrder = await client.query(
        `select order_id, line_community_name, product_name, quantity, total_price
         from main.orders
         where merge_job_id = $1`,
        [approved.id],
      );
      assert(mainOrder.rows.length === 1, "Merge did not create exactly one main order.");
      assert(Number(mainOrder.rows[0].total_price) === 360, "Main order total price is incorrect.");
      const mainPhotos = await client.query(
        `select storage_key, staging_storage_key, label
         from main.order_photos
         where order_id = $1`,
        [mainOrder.rows[0].order_id],
      );
      assert(mainPhotos.rows.length === 1, "Excluded photo was merged unexpectedly.");
      const finalKey = mainPhotos.rows[0].storage_key;
      storageKeys.push(finalKey);
      assert(finalKey.startsWith(`main-orders/${approved.id}/`), "Final photo key is not deterministic under main-orders.");
      assert(mainPhotos.rows[0].staging_storage_key === primaryPhoto.storageKey, "Main photo did not preserve staging source key.");
      assert(mainPhotos.rows[0].label === "正面", "Main photo label was not preserved.");
      const copyAudit = await client.query(
        `select count(*)::int as count
         from audit.merge_object_copies
         where merge_job_id = $1 and destination_key = $2`,
        [approved.id, finalKey],
      );
      assert(copyAudit.rows[0].count === 1, "R2 copy audit row was not written.");
      const signed = await r2.signedGetUrl(finalKey);
      const copiedObject = await fetch(signed);
      assert(copiedObject.ok, `Copied R2 object was not readable: ${copiedObject.status}`);
    } finally {
      await client.end();
    }

    console.log(JSON.stringify({
      finalPhotoCopied: true,
      mergeJobId: approved.id,
      productAcceptance: "slice7",
      reviewedPhotoSelection: "one included, one excluded",
    }, null, 2));
  } finally {
    await cleanupFixture(supabase, fixture, storageKeys);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
