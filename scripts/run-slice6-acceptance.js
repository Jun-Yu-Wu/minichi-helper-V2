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
  return `CodexSlice6-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
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

async function signIn(supabase, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

function authCookie(session) {
  return [
    `minichi_helper_access=${session.access_token}`,
    `minichi_helper_refresh=${session.refresh_token}`,
  ].join("; ");
}

async function createFixture(supabase) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const users = {
    helper: await createAuthUser(supabase, `codex-slice6-helper-${stamp}@example.com`, randomPassword()),
    inactive: await createAuthUser(supabase, `codex-slice6-inactive-${stamp}@example.com`, randomPassword()),
    other: await createAuthUser(supabase, `codex-slice6-other-${stamp}@example.com`, randomPassword()),
  };
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const helpers = {
      helper: await insertHelper(client, users.helper, "Codex Slice 6 Helper", true),
      inactive: await insertHelper(client, users.inactive, "Codex Slice 6 Inactive", false),
      other: await insertHelper(client, users.other, "Codex Slice 6 Other", true),
    };
    return { helpers, users };
  } catch (error) {
    await cleanupFixture(supabase, { users }, []);
    throw error;
  } finally {
    await client.end();
  }
}

async function insertHelper(client, user, displayName, isActive) {
  const result = await client.query(
    `insert into helper_app.helper_profiles
       (auth_user_id, display_name, email, compensation_mode, hourly_rate_twd,
        bank_account_name, bank_code, bank_account_number, region, is_active)
     values ($1, $2, $3, 'hourly', 250, $2, '812', '9876543210', 'Tokyo', $4)
     returning id`,
    [user.id, displayName, user.email, isActive],
  );
  return result.rows[0];
}

async function uploadDirect(r2, label, uploadedStorageKeys) {
  const storageKey = [
    "helper-app",
    "rebuy",
    "slice6-acceptance",
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
  ].join("/");
  const uploadUrl = await r2.signedPutUrl(storageKey, "image/png");
  await uploadPng(storageKey, uploadUrl);
  uploadedStorageKeys.push(storageKey);
  return {
    byteSize: PNG.length,
    contentType: "image/png",
    originalFilename: `${label}.png`,
    sortOrder: 0,
    storageKey,
  };
}

async function presign(appBaseUrl, session, body) {
  const response = await fetch(`${appBaseUrl}/api/uploads/presign`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      cookie: authCookie(session),
    },
    method: "POST",
  });
  let json = {};
  try {
    json = await response.json();
  } catch {}
  return { json, ok: response.ok, status: response.status };
}

async function uploadPng(storageKey, uploadUrl) {
  const upload = await fetch(uploadUrl, {
    body: PNG,
    headers: { "content-type": "image/png" },
    method: "PUT",
  });
  assert(upload.ok, `R2 upload failed for ${storageKey}: ${upload.status}`);
}

async function mainCounts(client) {
  const counts = {};
  for (const table of ["orders", "order_source_links", "order_photos"]) {
    const result = await client.query(`select count(*)::int as count from main.${table}`);
    counts[table] = result.rows[0].count;
  }
  return counts;
}

function assertCountsEqual(before, after) {
  for (const table of Object.keys(before)) {
    assert(before[table] === after[table], `main.${table} changed during Slice 6 acceptance.`);
  }
}

async function cleanupFixture(supabase, fixture, storageKeys = []) {
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const helperIds = [
      fixture.helpers?.helper?.id,
      fixture.helpers?.inactive?.id,
      fixture.helpers?.other?.id,
    ].filter(Boolean);
    const rebuyTaskIds = fixture.rebuyTaskIds || [];
    const userIds = Object.values(fixture.users || {}).map((user) => user?.id).filter(Boolean);
    if (helperIds.length) {
      const tripIdsResult = await client.query(
        `select id from helper_app.trips where assigned_helper_id = any($1::uuid[])`,
        [helperIds],
      );
      const tripIds = tripIdsResult.rows.map((row) => row.id);
      const settlementIdsResult = await client.query(
        `select id from helper_app.settlements
         where helper_id = any($1::uuid[]) or trip_id = any($2::uuid[])`,
        [helperIds, tripIds],
      );
      const settlementIds = settlementIdsResult.rows.map((row) => row.id);
      if (settlementIds.length) {
        await client.query("delete from helper_app.settlement_payments where settlement_id = any($1::uuid[])", [settlementIds]);
        await client.query("delete from helper_app.settlement_evidence where settlement_id = any($1::uuid[])", [settlementIds]);
        await client.query("delete from helper_app.settlement_line_items where settlement_id = any($1::uuid[])", [settlementIds]);
        await client.query("delete from helper_app.settlements where id = any($1::uuid[])", [settlementIds]);
      }
      await client.query(
        `delete from helper_app.rebuy_tasks
         where id = any($2::uuid[])
            or coalesce(claimed_helper_id, assigned_helper_id) = any($1::uuid[])
            or assigned_helper_id = any($1::uuid[])
            or claimed_helper_id = any($1::uuid[])`,
        [helperIds, rebuyTaskIds],
      );
      if (tripIds.length) {
        await client.query("delete from helper_app.staging_order_previews where trip_id = any($1::uuid[])", [tripIds]);
        await client.query("delete from helper_app.purchase_task_photos where trip_id = any($1::uuid[])", [tripIds]);
        await client.query("delete from helper_app.purchase_tasks where trip_id = any($1::uuid[])", [tripIds]);
        await client.query("delete from helper_app.trip_audit_events where trip_id = any($1::uuid[])", [tripIds]);
        await client.query("delete from helper_app.trips where id = any($1::uuid[])", [tripIds]);
      }
      await client.query(
        `delete from helper_app.trip_audit_events
         where actor_helper_id = any($1::uuid[])
            or actor_user_id = any($2::uuid[])`,
        [helperIds, userIds],
      );
      if (storageKeys.length) {
        await client.query("delete from helper_app.media_objects where storage_key = any($1::text[])", [
          storageKeys,
        ]);
      }
      await client.query("delete from helper_app.helper_profiles where id = any($1::uuid[])", [
        helperIds,
      ]);
    }
  } finally {
    await client.end();
  }

  const r2 = createR2ObjectStore();
  for (const storageKey of storageKeys) {
    try {
      await r2.deleteObject(storageKey);
    } catch (error) {
      console.error(`Failed to delete R2 object ${storageKey}:`, error.message);
    }
  }

  for (const user of Object.values(fixture.users || {})) {
    if (!user?.id) continue;
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) console.error(`Failed to delete auth user ${user.id}:`, error.message);
  }
}

async function main() {
  const appBaseUrl = process.env.ACCEPTANCE_APP_BASE_URL || "http://127.0.0.1:4300";
  const supabase = createClient(authServerConfig().url, authServerConfig().secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const fixture = await createFixture(supabase);
  fixture.rebuyTaskIds = [];
  const uploadedStorageKeys = [];

  try {
    const pool = database.getDatabasePool();
    const r2 = createR2ObjectStore();
    const helperAuth = await signIn(supabase, fixture.users.helper.email, fixture.users.helper.password);
    const otherAuth = await signIn(supabase, fixture.users.other.email, fixture.users.other.password);
    const inactiveAuth = await signIn(supabase, fixture.users.inactive.email, fixture.users.inactive.password);
    const client = new Client(databaseConfig());
    await client.connect();
    const beforeMainCounts = await mainCounts(client);
    await client.end();

    const referencePhoto = await uploadDirect(r2, "public-reference", uploadedStorageKeys);
    const publicTask = await service.createRebuyTask(pool, {
      actorUserId: fixture.users.helper.id,
      instructions: "公共池只顯示必要補買資訊",
      lineCommunityName: "不應公開顯示的客人",
      originalPriceJpy: "1280",
      productName: "Slice 6 Public Rebuy",
      quantity: "2",
      referencePhotos: [referencePhoto],
      salePriceTwd: "580",
      visibility: "public",
    });
    fixture.rebuyTaskIds.push(publicTask.id);
    assert(publicTask.visibility === "public", "Public rebuy task was not created.");
    assert(publicTask.photos?.[0]?.storage_key === referencePhoto.storageKey, "Reference photo storage key was not persisted.");

    const newestPublicTask = await service.createRebuyTask(pool, {
      actorUserId: fixture.users.helper.id,
      originalPriceJpy: "980",
      productName: "Slice 6 Newest Public Rebuy",
      quantity: "1",
      visibility: "public",
    });
    fixture.rebuyTaskIds.push(newestPublicTask.id);

    const helperWorkspaceBeforeClaim = await service.getHelperWorkspace(pool, fixture.users.helper.id);
    const publicListing = helperWorkspaceBeforeClaim.rebuyTasks.find((task) => task.id === publicTask.id);
    const publicTaskIndex = helperWorkspaceBeforeClaim.rebuyTasks.findIndex((task) => task.id === publicTask.id);
    const newestPublicTaskIndex = helperWorkspaceBeforeClaim.rebuyTasks.findIndex((task) => task.id === newestPublicTask.id);
    assert(publicListing, "Public rebuy task was not visible to active helper.");
    assert(
      newestPublicTaskIndex >= 0 && newestPublicTaskIndex < publicTaskIndex,
      "Newest public rebuy task was not listed before the older publication.",
    );
    assert(publicListing.line_community_name === null, "Public listing leaked customer nickname.");
    assert(publicListing.sale_price_twd === null, "Public listing leaked TWD sale price.");

    const inactiveWorkspace = await service.getHelperWorkspace(pool, fixture.users.inactive.id);
    assert(!inactiveWorkspace.rebuyTasks?.length, "Inactive helper received rebuy tasks.");

    const claimKey = `slice6-claim-${Date.now()}`;
    const [claimA, claimB] = await Promise.allSettled([
      service.claimPublicRebuyTask(pool, {
        authUserId: fixture.users.helper.id,
        expectedVersion: publicTask.version,
        idempotencyKey: claimKey,
        rebuyTaskId: publicTask.id,
      }),
      service.claimPublicRebuyTask(pool, {
        authUserId: fixture.users.other.id,
        expectedVersion: publicTask.version,
        idempotencyKey: `slice6-other-claim-${Date.now()}`,
        rebuyTaskId: publicTask.id,
      }),
    ]);
    const fulfilledClaims = [claimA, claimB].filter((result) => result.status === "fulfilled");
    assert(fulfilledClaims.length === 1, "Concurrent public claim did not leave exactly one winner.");
    const claimed = fulfilledClaims[0].value;
    assert(claimed.claimed_helper_id === fixture.helpers.helper.id, "Unexpected helper won the public claim.");
    const duplicateClaim = await service.claimPublicRebuyTask(pool, {
      authUserId: fixture.users.helper.id,
      expectedVersion: publicTask.version,
      idempotencyKey: claimKey,
      rebuyTaskId: publicTask.id,
    });
    assert(duplicateClaim.claimed_helper_id === fixture.helpers.helper.id, "Duplicate claim was not idempotent.");

    const otherWorkspaceAfterClaim = await service.getHelperWorkspace(pool, fixture.users.other.id);
    assert(
      !otherWorkspaceAfterClaim.rebuyTasks.some((task) => task.id === publicTask.id),
      "Claimed public task remained visible to another helper.",
    );
    await assertRejects(
      () => service.releasePublicRebuyTask(pool, {
        authUserId: fixture.users.other.id,
        expectedVersion: claimed.version,
        idempotencyKey: `slice6-other-release-${Date.now()}`,
        reason: "不應可退回",
        rebuyTaskId: publicTask.id,
      }),
      "Non-claiming helper released a claimed public task.",
    );
    await assertRejects(
      () => service.releasePublicRebuyTask(pool, {
        authUserId: fixture.users.helper.id,
        expectedVersion: publicTask.version,
        idempotencyKey: `slice6-stale-release-${Date.now()}`,
        reason: "舊版本不應覆蓋",
        rebuyTaskId: publicTask.id,
      }),
      "Stale release version was accepted.",
    );
    const releaseKey = `slice6-release-${Date.now()}`;
    const released = await service.releasePublicRebuyTask(pool, {
      authUserId: fixture.users.helper.id,
      expectedVersion: claimed.version,
      idempotencyKey: releaseKey,
      reason: "現場無法購買，退回公開池",
      rebuyTaskId: publicTask.id,
    });
    assert(released.status === "open" && !released.claimed_helper_id, "Public release did not reopen and clear ownership.");
    const duplicateRelease = await service.releasePublicRebuyTask(pool, {
      authUserId: fixture.users.helper.id,
      expectedVersion: claimed.version,
      idempotencyKey: releaseKey,
      reason: "重送退回",
      rebuyTaskId: publicTask.id,
    });
    assert(duplicateRelease.status === "open", "Duplicate release was not idempotent.");

    const reclaimed = await service.claimPublicRebuyTask(pool, {
      authUserId: fixture.users.helper.id,
      expectedVersion: released.version,
      idempotencyKey: `slice6-reclaim-${Date.now()}`,
      rebuyTaskId: publicTask.id,
    });

    const privateReference = await uploadDirect(r2, "private-reference", uploadedStorageKeys);
    const privateTask = await service.createRebuyTask(pool, {
      actorUserId: fixture.users.helper.id,
      assignedHelperId: fixture.helpers.helper.id,
      lineCommunityName: "指定補買客人",
      originalPriceJpy: "900",
      productName: "Slice 6 Private Rebuy",
      quantity: "3",
      referencePhotos: [privateReference],
      salePriceTwd: "480",
      visibility: "private",
    });
    fixture.rebuyTaskIds.push(privateTask.id);
    await assertRejects(
      () => service.releasePublicRebuyTask(pool, {
        authUserId: fixture.users.helper.id,
        expectedVersion: privateTask.version,
        idempotencyKey: `slice6-private-release-${Date.now()}`,
        reason: "指定任務不能退公開池",
        rebuyTaskId: privateTask.id,
      }),
      "Private rebuy task was released into public pool.",
    );
    await assertRejects(
      () => service.reportRebuyTask(pool, {
        authUserId: fixture.users.helper.id,
        idempotencyKey: `slice6-partial-without-reason-${Date.now()}`,
        rebuyTaskId: privateTask.id,
        reportPhotosOmitted: true,
        reportedQuantity: "1",
      }),
      "Partial rebuy report without reason was accepted.",
    );

    const reportPresign = await presign(appBaseUrl, helperAuth.session, {
      clientPhotoId: `slice6-report-${Date.now()}`,
      contentType: "image/png",
      fileName: "slice6-report.png",
      rebuyTaskId: publicTask.id,
      uploadPurpose: "rebuy_report",
    });
    assert(reportPresign.ok, `Rebuy report presign failed: ${reportPresign.status}`);
    await uploadPng(reportPresign.json.storageKey, reportPresign.json.uploadUrl);
    uploadedStorageKeys.push(reportPresign.json.storageKey);
    const forbiddenPresign = await presign(appBaseUrl, otherAuth.session, {
      clientPhotoId: `slice6-forbidden-report-${Date.now()}`,
      contentType: "image/png",
      fileName: "forbidden.png",
      rebuyTaskId: publicTask.id,
      uploadPurpose: "rebuy_report",
    });
    assert(!forbiddenPresign.ok, "Other helper presigned a claimed rebuy report photo.");
    const inactivePresign = await presign(appBaseUrl, inactiveAuth.session, {
      clientPhotoId: `slice6-inactive-report-${Date.now()}`,
      contentType: "image/png",
      fileName: "inactive.png",
      rebuyTaskId: publicTask.id,
      uploadPurpose: "rebuy_report",
    });
    assert(!inactivePresign.ok, "Inactive helper presigned a rebuy report photo.");

    const reportedPublic = await service.reportRebuyTask(pool, {
      authUserId: fixture.users.helper.id,
      helperNote: "公共補買已買到一件",
      idempotencyKey: `slice6-public-report-${Date.now()}`,
      rebuyTaskId: publicTask.id,
      remainingReason: "剩餘一件現場無貨",
      reportPhotos: [{
        byteSize: PNG.length,
        contentType: "image/png",
        originalFilename: "slice6-report.png",
        sortOrder: 0,
        storageKey: reportPresign.json.storageKey,
      }],
      reportedQuantity: "1",
    });
    assert(reportedPublic.status === "reported", "Public rebuy report did not complete.");
    assert(Number(reportedPublic.remaining_quantity) === 1, "Partial remaining quantity was not recorded.");

    const reportedPrivate = await service.reportRebuyTask(pool, {
      authUserId: fixture.users.helper.id,
      helperNote: "指定補買全數買到，無照片",
      idempotencyKey: `slice6-private-report-${Date.now()}`,
      rebuyTaskId: privateTask.id,
      reportPhotosOmitted: true,
      reportedQuantity: "3",
    });
    assert(reportedPrivate.status === "reported", "Private rebuy report did not complete.");
    assert(reportedPrivate.report_photos_omitted === true, "Photo omission confirmation was not persisted.");

    const checkoutKey = `slice6-checkout-${Date.now()}`;
    const checkout = await service.checkoutRebuyTasks(pool, {
      authUserId: fixture.users.helper.id,
      idempotencyKey: checkoutKey,
    });
    const duplicateCheckout = await service.checkoutRebuyTasks(pool, {
      authUserId: fixture.users.helper.id,
      idempotencyKey: checkoutKey,
    });
    assert(checkout.tripId === duplicateCheckout.tripId, "Duplicate checkout created a second trip.");
    assert(checkout.settlement?.work_minutes === 0, "Rebuy checkout settlement did not use zero work minutes.");
    assert(checkout.settlement?.status === "pending_helper_precheck", "Rebuy checkout settlement status was unexpected.");

    const verifyClient = new Client(databaseConfig());
    await verifyClient.connect();
    try {
      const staging = await verifyClient.query(
        `select sop.*, pt.source_rebuy_task_id
         from helper_app.staging_order_previews sop
         join helper_app.purchase_tasks pt on pt.id = sop.purchase_task_id
         where sop.trip_id = $1
         order by sop.created_at asc`,
        [checkout.tripId],
      );
      assert(staging.rows.length === 2, "Checkout did not create two staging previews.");
      assert(
        staging.rows.every((row) => row.source_rebuy_task_id),
        "Checkout staging previews did not preserve rebuy provenance.",
      );
      const checkedOutTasks = await verifyClient.query(
        `select count(*)::int as count
         from helper_app.rebuy_tasks
         where id = any($1::uuid[]) and status = 'checked_out' and checkout_trip_id = $2`,
        [[publicTask.id, privateTask.id], checkout.tripId],
      );
      assert(checkedOutTasks.rows[0].count === 2, "Reported rebuy tasks were not marked checked out.");
      const audit = await verifyClient.query(
        `select action from helper_app.trip_audit_events
         where action in ('helper_rebuy_claimed', 'helper_rebuy_released',
                          'helper_rebuy_reported', 'helper_rebuy_reported_without_photos',
                          'helper_rebuy_checkout_completed')`,
      );
      const actions = new Set(audit.rows.map((row) => row.action));
      for (const action of [
        "helper_rebuy_claimed",
        "helper_rebuy_released",
        "helper_rebuy_reported",
        "helper_rebuy_reported_without_photos",
        "helper_rebuy_checkout_completed",
      ]) {
        assert(actions.has(action), `Missing audit action ${action}.`);
      }
      const afterMainCounts = await mainCounts(verifyClient);
      assertCountsEqual(beforeMainCounts, afterMainCounts);
    } finally {
      await verifyClient.end();
    }

    console.log(JSON.stringify({
      checkoutTripId: checkout.tripId,
      productAcceptance: "slice6",
      publicTaskId: publicTask.id,
      storageKeyCount: uploadedStorageKeys.length,
    }, null, 2));
  } finally {
    await cleanupFixture(supabase, fixture, uploadedStorageKeys);
    await database.getDatabasePool().end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
