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
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function randomPassword() {
  return `CodexSlice4-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
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
    admin: await createAuthUser(supabase, `codex-slice4-admin-${stamp}@example.com`, randomPassword()),
    helper: await createAuthUser(supabase, `codex-slice4-helper-${stamp}@example.com`, randomPassword()),
    inactive: await createAuthUser(supabase, `codex-slice4-inactive-${stamp}@example.com`, randomPassword()),
    other: await createAuthUser(supabase, `codex-slice4-other-${stamp}@example.com`, randomPassword()),
  };

  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const helper = await insertHelper(client, users.helper, "Codex Slice 4 Helper", true);
    const other = await insertHelper(client, users.other, "Codex Slice 4 Other", true);
    const inactive = await insertHelper(client, users.inactive, "Codex Slice 4 Inactive", false);
    const today = todayInTokyo();
    const trips = {
      activeCandidate: await insertTrip(client, helper.id, today, "scheduled", "Codex Slice 4 Main"),
      inactive: await insertTrip(client, inactive.id, today, "active", "Codex Slice 4 Inactive"),
      other: await insertTrip(client, other.id, today, "active", "Codex Slice 4 Other"),
    };
    return { helpers: { helper, inactive, other }, trips, users };
  } catch (error) {
    await cleanupFixture(supabase, { users });
    throw error;
  } finally {
    await client.end();
  }
}

async function insertHelper(client, user, displayName, isActive) {
  const result = await client.query(
    `insert into helper_app.helper_profiles
       (auth_user_id, display_name, email, compensation_mode, hourly_rate_twd, region, is_active)
     values ($1, $2, $3, 'hourly', 250, 'Tokyo', $4)
     returning id`,
    [user.id, displayName, user.email, isActive],
  );
  return { id: result.rows[0].id };
}

async function insertTrip(client, helperId, businessDate, status, tripName) {
  const result = await client.query(
    `insert into helper_app.trips
       (trip_name, business_date, scheduled_time, location, timezone, assigned_helper_id, status,
        admin_activated_at)
     values ($1, $2, '10:30', 'Tokyo Station', 'Asia/Tokyo', $3, $4,
        case when $4 = 'active' then now() else null end)
     returning id, version`,
    [tripName, businessDate, helperId, status],
  );
  return result.rows[0];
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
    if (helperIds.length) {
      await client.query("delete from helper_app.trips where assigned_helper_id = any($1::uuid[])", [
        helperIds,
      ]);
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

async function uploadDirect(r2, tripId, label, uploadedStorageKeys) {
  const storageKey = `helper-app/${tripId}/purchase-reference/codex-slice4-${label}-${Date.now()}.png`;
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
  const uploadedStorageKeys = [];

  try {
    const pool = database.getDatabasePool();
    const r2 = createR2ObjectStore();
    const helperAuth = await signIn(
      supabase,
      fixture.users.helper.email,
      fixture.users.helper.password,
    );
    const otherAuth = await signIn(supabase, fixture.users.other.email, fixture.users.other.password);

    const departed = await service.markHelperDeparted(pool, {
      authUserId: fixture.users.helper.id,
      expectedVersion: fixture.trips.activeCandidate.version,
      tripId: fixture.trips.activeCandidate.id,
    });
    const arrived = await service.markHelperArrived(pool, {
      authUserId: fixture.users.helper.id,
      expectedVersion: departed.version,
      tripId: fixture.trips.activeCandidate.id,
    });
    const activeTrip = await service.activateTrip(pool, {
      actorUserId: fixture.users.admin.id,
      expectedVersion: arrived.version,
      tripId: fixture.trips.activeCandidate.id,
    });

    await assertRejects(
      () =>
        service.createPurchaseTask(pool, {
          actorUserId: fixture.users.admin.id,
          lineCommunityName: "客人無照片",
          originalPriceJpy: "1000",
          productName: "缺照片商品",
          quantity: "1",
          salePriceTwd: "320",
          tripId: activeTrip.id,
        }),
      "Manual purchase task without reference photos was accepted.",
    );

    const manualPhoto = await uploadDirect(r2, activeTrip.id, "manual-reference", uploadedStorageKeys);
    const manualTask = await service.createPurchaseTask(pool, {
      actorUserId: fixture.users.admin.id,
      lineCommunityName: "客人A",
      originalPriceJpy: "1200",
      productName: "Codex Slice 4 Manual",
      quantity: "3",
      referencePhotos: [manualPhoto],
      salePriceTwd: "390",
      tripId: activeTrip.id,
    });
    assert(manualTask.photos.some((photo) => photo.photo_role === "manual_reference"), "Manual reference photo was not linked.");

    const signedManual = await service.attachSignedPurchaseTaskUrls(
      [manualTask],
      r2,
    );
    const signedManualPhoto = signedManual[0].photos.find((photo) => photo.photo_role === "manual_reference");
    assert(/^https?:\/\//.test(signedManualPhoto?.signed_url || ""), "Manual purchase photo was not signed.");
    const signedManualFetch = await fetch(signedManualPhoto.signed_url);
    assert(signedManualFetch.ok, `Signed manual purchase URL failed: ${signedManualFetch.status}`);

    const manualResponse = {
      action: "complete",
      authUserId: fixture.users.helper.id,
      completedQuantity: "2",
      helperNote: "Bought two, one unavailable.",
      idempotencyKey: `codex-slice4-manual-response-${Date.now()}`,
      purchaseTaskId: manualTask.id,
      unavailableQuantity: "1",
    };
    const completedManual = await service.respondPurchaseTask(pool, manualResponse);
    const duplicateManual = await service.respondPurchaseTask(pool, manualResponse);
    assert(completedManual.status === "completed", "Manual task was not completed.");
    assert(duplicateManual.status === "completed", "Duplicate manual response was not idempotent.");

    const cancelPhoto = await uploadDirect(r2, activeTrip.id, "cancel-reference", uploadedStorageKeys);
    const cancelTask = await service.createPurchaseTask(pool, {
      actorUserId: fixture.users.admin.id,
      lineCommunityName: "客人取消",
      originalPriceJpy: "980",
      productName: "Codex Slice 4 Cancel",
      quantity: "1",
      referencePhotos: [cancelPhoto],
      salePriceTwd: "300",
      tripId: activeTrip.id,
    });
    await assertRejects(
      () =>
        service.respondPurchaseTask(pool, {
          action: "cancel",
          authUserId: fixture.users.helper.id,
          idempotencyKey: `codex-slice4-cancel-missing-reason-${Date.now()}`,
          purchaseTaskId: cancelTask.id,
        }),
      "Cancel without reason was accepted.",
    );
    await service.respondPurchaseTask(pool, {
      action: "cancel",
      authUserId: fixture.users.helper.id,
      helperNote: "Customer canceled during live.",
      idempotencyKey: `codex-slice4-cancel-${Date.now()}`,
      purchaseTaskId: cancelTask.id,
    });

    const unavailablePhoto = await uploadDirect(r2, activeTrip.id, "unavailable-reference", uploadedStorageKeys);
    const unavailableTask = await service.createPurchaseTask(pool, {
      actorUserId: fixture.users.admin.id,
      lineCommunityName: "客人缺貨",
      originalPriceJpy: "780",
      productName: "Codex Slice 4 Unavailable",
      quantity: "1",
      referencePhotos: [unavailablePhoto],
      salePriceTwd: "250",
      tripId: activeTrip.id,
    });
    await service.respondPurchaseTask(pool, {
      action: "unavailable",
      authUserId: fixture.users.helper.id,
      helperNote: "Sold out.",
      idempotencyKey: `codex-slice4-unavailable-${Date.now()}`,
      purchaseTaskId: unavailableTask.id,
    });

    const notFoundPhoto = await uploadDirect(r2, activeTrip.id, "not-found-reference", uploadedStorageKeys);
    const notFoundTask = await service.createPurchaseTask(pool, {
      actorUserId: fixture.users.admin.id,
      lineCommunityName: "客人找不到",
      originalPriceJpy: "860",
      productName: "Codex Slice 4 Not Found",
      quantity: "1",
      referencePhotos: [notFoundPhoto],
      salePriceTwd: "270",
      tripId: activeTrip.id,
    });
    await service.respondPurchaseTask(pool, {
      action: "not_found",
      authUserId: fixture.users.helper.id,
      helperNote: "Could not find the shelf.",
      idempotencyKey: `codex-slice4-not-found-${Date.now()}`,
      purchaseTaskId: notFoundTask.id,
    });

    const facePhoto = await uploadDirect(r2, activeTrip.id, "face-reference", uploadedStorageKeys);
    const faceTask = await service.createPurchaseTask(pool, {
      actorUserId: fixture.users.admin.id,
      lineCommunityName: "客人挑臉",
      originalPriceJpy: "2200",
      productName: "Codex Slice 4 Face",
      quantity: "1",
      referencePhotos: [facePhoto],
      requiresFaceCheck: true,
      salePriceTwd: "720",
      tripId: activeTrip.id,
    });
    const otherFacePresign = await presign(appBaseUrl, otherAuth.session, {
      clientPhotoId: `codex-slice4-other-face-${Date.now()}`,
      contentType: "image/png",
      fileName: "other-face.png",
      purchaseTaskId: faceTask.id,
      uploadPurpose: "purchase_face_check",
    });
    assert(!otherFacePresign.ok, "Other helper was allowed to presign face-check photo.");
    const facePresign = await presign(appBaseUrl, helperAuth.session, {
      clientPhotoId: `codex-slice4-face-${Date.now()}`,
      contentType: "image/png",
      fileName: "face.png",
      purchaseTaskId: faceTask.id,
      uploadPurpose: "purchase_face_check",
    });
    assert(facePresign.ok, `Face-check presign failed: ${JSON.stringify(facePresign)}`);
    await uploadPng(facePresign.json.storageKey, facePresign.json.uploadUrl);
    uploadedStorageKeys.push(facePresign.json.storageKey);
    const reviewPending = await service.respondPurchaseTask(pool, {
      action: "complete",
      authUserId: fixture.users.helper.id,
      completedQuantity: "1",
      faceCheckNote: "Please review face.",
      faceCheckPhoto: {
        byteSize: PNG.length,
        contentType: "image/png",
        originalFilename: "face.png",
        storageKey: facePresign.json.storageKey,
      },
      idempotencyKey: `codex-slice4-face-submit-${Date.now()}`,
      purchaseTaskId: faceTask.id,
    });
    assert(reviewPending.status === "review_pending", "Face-check submit did not wait for admin review.");
    let previews = await service.listStagingOrderPreviews(pool, { tripIds: [activeTrip.id] });
    assert(!previews.some((preview) => preview.purchase_task_id === faceTask.id), "Face-check review_pending created staging preview.");

    const approved = await service.reviewFaceCheckPurchaseTask(pool, {
      action: "approve",
      actorUserId: fixture.users.admin.id,
      adminReviewNote: "Approved.",
      purchaseTaskId: faceTask.id,
    });
    assert(approved.status === "approved_pending_helper_confirmation", "Face-check approval completed too early.");
    previews = await service.listStagingOrderPreviews(pool, { tripIds: [activeTrip.id] });
    assert(!previews.some((preview) => preview.purchase_task_id === faceTask.id), "Face-check approval created staging preview before helper confirmation.");

    const faceConfirmPayload = {
      action: "complete",
      authUserId: fixture.users.helper.id,
      completedQuantity: "1",
      idempotencyKey: `codex-slice4-face-confirm-${Date.now()}`,
      purchaseTaskId: faceTask.id,
    };
    const completedFace = await service.respondPurchaseTask(pool, faceConfirmPayload);
    const duplicateFace = await service.respondPurchaseTask(pool, faceConfirmPayload);
    assert(completedFace.status === "completed", "Face-check final confirmation did not complete.");
    assert(duplicateFace.status === "completed", "Duplicate face-check final confirmation was not idempotent.");

    const sitePhotoPresign = await presign(appBaseUrl, helperAuth.session, {
      clientPhotoId: `codex-slice4-site-${Date.now()}`,
      contentType: "image/png",
      fileName: "site.png",
      tripId: activeTrip.id,
    });
    assert(sitePhotoPresign.ok, `Site photo presign failed: ${JSON.stringify(sitePhotoPresign)}`);
    await uploadPng(sitePhotoPresign.json.storageKey, sitePhotoPresign.json.uploadUrl);
    uploadedStorageKeys.push(sitePhotoPresign.json.storageKey);
    const batch = await service.submitSitePhotoBatch(pool, {
      authUserId: fixture.users.helper.id,
      note: "Slice 4 quick publish source.",
      photos: [
        {
          byteSize: PNG.length,
          clientPhotoId: "codex-slice4-source",
          contentType: "image/png",
          originalFilename: "site.png",
          sortOrder: 0,
          storageKey: sitePhotoPresign.json.storageKey,
        },
      ],
      submissionId: `codex-slice4-site-submission-${Date.now()}`,
      tripId: activeTrip.id,
    });
    const quoteTask = await service.createQuoteTask(pool, {
      actorUserId: fixture.users.admin.id,
      instruction: "Quote and detail for quick publish.",
      photoIds: [batch.photos[0].id],
      productName: "Codex Slice 4 Quick",
      taskType: "quote_and_detail",
      tripId: activeTrip.id,
    });
    const detailPresign = await presign(appBaseUrl, helperAuth.session, {
      clientPhotoId: `codex-slice4-detail-${Date.now()}`,
      contentType: "image/png",
      fileName: "detail.png",
      quoteTaskPhotoId: quoteTask.photos[0].id,
      uploadPurpose: "quote_detail_reply",
    });
    assert(detailPresign.ok, `Detail presign failed: ${JSON.stringify(detailPresign)}`);
    await uploadPng(detailPresign.json.storageKey, detailPresign.json.uploadUrl);
    uploadedStorageKeys.push(detailPresign.json.storageKey);
    const reply = await service.submitQuotePhotoReply(pool, {
      authUserId: fixture.users.helper.id,
      detailPhotos: [
        {
          byteSize: PNG.length,
          contentType: "image/png",
          originalFilename: "detail.png",
          sortOrder: 0,
          storageKey: detailPresign.json.storageKey,
        },
      ],
      idempotencyKey: `codex-slice4-quote-reply-${Date.now()}`,
      note: "Quote ready.",
      priceJpy: "1680",
      quoteTaskPhotoId: quoteTask.photos[0].id,
    });
    const quickTask = await service.quickPublishPurchaseTask(pool, {
      actorUserId: fixture.users.admin.id,
      lineCommunityName: "客人快速",
      productName: "Codex Slice 4 Quick",
      quantity: "1",
      quoteTaskPhotoId: quoteTask.photos[0].id,
      salePriceTwd: "560",
      tripId: activeTrip.id,
    });
    assert(quickTask.source_quote_task_id === quoteTask.id, "Quick publish did not preserve quote task provenance.");
    assert(quickTask.source_quote_reply_id === reply.id, "Quick publish did not preserve quote reply provenance.");
    assert(quickTask.original_price_jpy === 1680, "Quick publish did not carry quoted JPY price.");
    assert(quickTask.photos.some((photo) => photo.photo_role === "source"), "Quick publish did not carry source photo.");
    assert(quickTask.photos.some((photo) => photo.photo_role === "detail_reply"), "Quick publish did not carry detail reply photo.");
    await assertRejects(
      () =>
        service.submitQuotePhotoReply(pool, {
          authUserId: fixture.users.helper.id,
          detailPhotos: [
            {
              byteSize: PNG.length,
              contentType: "image/png",
              originalFilename: "detail.png",
              sortOrder: 0,
              storageKey: detailPresign.json.storageKey,
            },
          ],
          idempotencyKey: `codex-slice4-rewrite-after-convert-${Date.now()}`,
          priceJpy: "1700",
          quoteTaskPhotoId: quoteTask.photos[0].id,
        }),
      "Converted quote reply was still editable.",
    );

    previews = await service.listStagingOrderPreviews(pool, { tripIds: [activeTrip.id] });
    const previewIds = new Set(previews.map((preview) => preview.purchase_task_id));
    assert(previewIds.has(manualTask.id), "Completed manual task did not create staging preview.");
    assert(previewIds.has(faceTask.id), "Completed face-check task did not create staging preview.");
    assert(!previewIds.has(cancelTask.id), "Canceled task created staging preview.");
    assert(!previewIds.has(unavailableTask.id), "Unavailable task created staging preview.");
    assert(!previewIds.has(notFoundTask.id), "Not-found task created staging preview.");
    assert(previews.find((preview) => preview.purchase_task_id === manualTask.id)?.quantity === 2, "Partial completed quantity was not used in staging preview.");

    const signedFeed = await service.attachSignedPurchaseTaskUrls(
      await service.listPurchaseTasks(pool, { tripIds: [activeTrip.id] }),
      r2,
    );
    assert(
      signedFeed.flatMap((task) => task.photos || []).every((photo) => /^https?:\/\//.test(photo.signed_url || "")),
      "Admin purchase feed did not sign all task photos.",
    );

    const urlColumns = await pool.query(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'helper_app'
         and table_name in ('purchase_tasks', 'purchase_task_photos', 'staging_order_previews', 'media_objects')
         and column_name in ('signed_url', 'upload_url', 'download_url', 'share_url')`,
    );
    assert(urlColumns.rows.length === 0, "Temporary signed URL columns exist in durable purchase tables.");

    const mainTablesTouched = await pool.query(
      `select count(*)::int as count
       from information_schema.tables
       where table_schema = 'main'
         and table_name in ('orders', 'order_source_links', 'order_photos')`,
    );

    console.log(
      JSON.stringify(
        {
          activeTripId: activeTrip.id,
          completedPreviewCount: previews.length,
          faceCheckFinalConfirmationRequired: true,
          helperIsolationVerified: true,
          mainOrderTablesOnlyInspected: mainTablesTouched.rows[0].count,
          manualReferenceRequired: true,
          partialQuantityPreviewVerified: true,
          productAcceptance: "slice4",
          quickPublishProvenanceVerified: true,
          r2ObjectsUploaded: uploadedStorageKeys.length,
          storageKeys: uploadedStorageKeys,
        },
        null,
        2,
      ),
    );
  } finally {
    await cleanupFixture(supabase, fixture, uploadedStorageKeys);
    const pool = database.getDatabasePool();
    await pool.end();
  }
}

async function assertRejects(callback, message) {
  try {
    await callback();
  } catch {
    return;
  }
  throw new Error(message);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
