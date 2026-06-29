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

function randomPassword() {
  return `CodexSlice3-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
}

function todayInTokyo() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date());
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    admin: await createAuthUser(supabase, `codex-slice3-admin-${stamp}@example.com`, randomPassword()),
    helper: await createAuthUser(supabase, `codex-slice3-helper-${stamp}@example.com`, randomPassword()),
    inactive: await createAuthUser(supabase, `codex-slice3-inactive-${stamp}@example.com`, randomPassword()),
    other: await createAuthUser(supabase, `codex-slice3-other-${stamp}@example.com`, randomPassword()),
  };

  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const helper = await insertHelper(client, users.helper, "Codex Slice 3 Helper", true);
    const other = await insertHelper(client, users.other, "Codex Slice 3 Other", true);
    const inactive = await insertHelper(client, users.inactive, "Codex Slice 3 Inactive", false);
    const today = todayInTokyo();
    const trips = {
      activeCandidate: await insertTrip(client, helper.id, today, "scheduled", "Codex Slice 3 Main"),
      inactive: await insertTrip(client, inactive.id, today, "active", "Codex Slice 3 Inactive"),
      other: await insertTrip(client, other.id, today, "active", "Codex Slice 3 Other"),
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
    const helperAuth = await signIn(
      supabase,
      fixture.users.helper.email,
      fixture.users.helper.password,
    );
    const otherAuth = await signIn(supabase, fixture.users.other.email, fixture.users.other.password);
    const inactiveAuth = await signIn(
      supabase,
      fixture.users.inactive.email,
      fixture.users.inactive.password,
    );

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

    const sitePhotoPresigns = [];
    for (const suffix of ["a", "b"]) {
      const signed = await presign(appBaseUrl, helperAuth.session, {
        clientPhotoId: `codex-slice3-site-${suffix}-${Date.now()}`,
        contentType: "image/png",
        fileName: `codex-slice3-site-${suffix}.png`,
        tripId: activeTrip.id,
      });
      assert(signed.ok, `Site photo presign failed: ${JSON.stringify(signed)}`);
      await uploadPng(signed.json.storageKey, signed.json.uploadUrl);
      uploadedStorageKeys.push(signed.json.storageKey);
      sitePhotoPresigns.push(signed);
    }

    const batch = await service.submitSitePhotoBatch(pool, {
      authUserId: fixture.users.helper.id,
      note: "Codex Slice 3 source photos",
      photos: sitePhotoPresigns.map((signed, index) => ({
        byteSize: PNG.length,
        clientPhotoId: `codex-slice3-source-${index}`,
        contentType: "image/png",
        originalFilename: `codex-slice3-source-${index}.png`,
        sortOrder: index,
        storageKey: signed.json.storageKey,
      })),
      submissionId: `codex-slice3-site-submission-${Date.now()}`,
      tripId: activeTrip.id,
    });
    assert(batch.photos.length === 2, "Source site photo batch was not committed.");

    const task = await service.createQuoteTask(pool, {
      actorUserId: fixture.users.admin.id,
      instruction: "Please quote and capture label details.",
      photoIds: batch.photos.map((photo) => photo.id),
      productName: "Codex Slice 3 Product",
      taskType: "quote_and_detail",
      tripId: activeTrip.id,
    });
    assert(task.photos.length === 2, "Quote task did not create one subtask per photo.");

    const mediaRetention = await pool.query(
      `select count(*)::int as count
       from helper_app.media_objects
       where storage_key = any($1::text[])
         and media_kind = 'quote_task_photo'
         and retention_status = 'task_evidence'`,
      [batch.photos.map((photo) => photo.storage_key)],
    );
    assert(mediaRetention.rows[0].count === 2, "Task source photos were not retained as evidence.");

    const workspace = await service.getHelperWorkspace(pool, fixture.users.helper.id);
    const helperTasks = workspace.quoteTasksByTripId[activeTrip.id] || [];
    assert(helperTasks.some((item) => item.id === task.id), "Helper cannot see own quote task.");
    const otherWorkspace = await service.getHelperWorkspace(pool, fixture.users.other.id);
    assert(
      !(otherWorkspace.quoteTasksByTripId[activeTrip.id] || []).some((item) => item.id === task.id),
      "Other helper can see this helper's quote task.",
    );

    const replyPhoto = task.photos[0];
    const otherBlocked = await presign(appBaseUrl, otherAuth.session, {
      clientPhotoId: `codex-slice3-other-detail-${Date.now()}`,
      contentType: "image/png",
      fileName: "codex-slice3-other-detail.png",
      quoteTaskPhotoId: replyPhoto.id,
      uploadPurpose: "quote_detail_reply",
    });
    assert(!otherBlocked.ok, "Other helper was allowed to presign detail reply photo.");

    const inactiveBlocked = await presign(appBaseUrl, inactiveAuth.session, {
      clientPhotoId: `codex-slice3-inactive-detail-${Date.now()}`,
      contentType: "image/png",
      fileName: "codex-slice3-inactive-detail.png",
      quoteTaskPhotoId: replyPhoto.id,
      uploadPurpose: "quote_detail_reply",
    });
    assert(!inactiveBlocked.ok, "Inactive helper was allowed to presign detail reply photo.");

    const detailPresign = await presign(appBaseUrl, helperAuth.session, {
      clientPhotoId: `codex-slice3-detail-${Date.now()}`,
      contentType: "image/png",
      fileName: "codex-slice3-detail.png",
      quoteTaskPhotoId: replyPhoto.id,
      uploadPurpose: "quote_detail_reply",
    });
    assert(detailPresign.ok, `Detail photo presign failed: ${JSON.stringify(detailPresign)}`);
    await uploadPng(detailPresign.json.storageKey, detailPresign.json.uploadUrl);
    uploadedStorageKeys.push(detailPresign.json.storageKey);

    await assertRejects(
      () =>
        service.submitQuotePhotoReply(pool, {
          authUserId: fixture.users.helper.id,
          detailPhotos: [],
          idempotencyKey: `codex-slice3-invalid-${Date.now()}`,
          priceJpy: "1280",
          quoteTaskPhotoId: replyPhoto.id,
        }),
      "A quote-and-detail reply without detail photos was accepted.",
    );

    const replyPayload = {
      authUserId: fixture.users.helper.id,
      detailPhotos: [
        {
          byteSize: PNG.length,
          contentType: "image/png",
          originalFilename: "codex-slice3-detail.png",
          sortOrder: 0,
          storageKey: detailPresign.json.storageKey,
        },
      ],
      idempotencyKey: `codex-slice3-reply-${Date.now()}`,
      note: "Shelf label confirmed.",
      priceJpy: "1280",
      quoteTaskPhotoId: replyPhoto.id,
    };
    const reply = await service.submitQuotePhotoReply(pool, replyPayload);
    const duplicate = await service.submitQuotePhotoReply(pool, replyPayload);
    assert(reply.id === duplicate.id, "Duplicate idempotency key created another reply.");

    const replyCount = await pool.query(
      `select count(*)::int as count
       from helper_app.quote_photo_replies
       where quote_task_photo_id = $1`,
      [replyPhoto.id],
    );
    assert(replyCount.rows[0].count === 1, "Duplicate quote reply rows were created.");

    const secondDetailPresign = await presign(appBaseUrl, helperAuth.session, {
      clientPhotoId: `codex-slice3-detail-second-${Date.now()}`,
      contentType: "image/png",
      fileName: "codex-slice3-detail-second.png",
      quoteTaskPhotoId: task.photos[1].id,
      uploadPurpose: "quote_detail_reply",
    });
    assert(secondDetailPresign.ok, "Second detail photo presign failed.");
    await uploadPng(secondDetailPresign.json.storageKey, secondDetailPresign.json.uploadUrl);
    uploadedStorageKeys.push(secondDetailPresign.json.storageKey);
    await service.submitQuotePhotoReply(pool, {
      authUserId: fixture.users.helper.id,
      detailPhotos: [
        {
          byteSize: PNG.length,
          contentType: "image/png",
          originalFilename: "codex-slice3-detail-second.png",
          sortOrder: 0,
          storageKey: secondDetailPresign.json.storageKey,
        },
      ],
      idempotencyKey: `codex-slice3-reply-second-${Date.now()}`,
      note: "Second photo confirmed.",
      priceJpy: "1380",
      quoteTaskPhotoId: task.photos[1].id,
    });

    const completedTask = await pool.query(
      `select status
       from helper_app.quote_tasks
       where id = $1`,
      [task.id],
    );
    assert(completedTask.rows[0].status === "completed", "Task did not complete after all photos replied.");

    const signedFeed = await service.attachSignedQuoteTaskUrls(
      await service.listQuoteTasks(pool, { tripIds: [activeTrip.id] }),
      createR2ObjectStore(),
    );
    const signedTask = signedFeed.find((item) => item.id === task.id);
    assert(signedTask, "Admin feed could not list the quote task.");
    assert(
      signedTask.photos.every((photo) => /^https?:\/\//.test(photo.signed_url || "")),
      "Admin feed did not sign task source photos.",
    );
    assert(
      signedTask.photos.every((photo) =>
        (photo.latest_reply?.detail_photos || []).every((detailPhoto) =>
          /^https?:\/\//.test(detailPhoto.signed_url || ""),
        ),
      ),
      "Admin feed did not sign detail reply photos.",
    );
    const displayFetch = await fetch(signedTask.photos[0].latest_reply.detail_photos[0].signed_url);
    assert(displayFetch.ok, `Signed detail display URL failed: ${displayFetch.status}`);

    const detailMedia = await pool.query(
      `select count(*)::int as count
       from helper_app.media_objects
       where storage_key = any($1::text[])
         and media_kind = 'quote_detail_reply_photo'
         and retention_status = 'task_evidence'`,
      [uploadedStorageKeys.filter((key) => key.includes("quote-detail-replies"))],
    );
    assert(detailMedia.rows[0].count === 2, "Detail reply photos were not retained as task evidence.");

    const audit = await pool.query(
      `select action, count(*)::int as count
       from helper_app.trip_audit_events
       where trip_id = $1
         and action in ('admin_quote_task_created', 'helper_quote_photo_replied')
       group by action`,
      [activeTrip.id],
    );
    const auditCounts = Object.fromEntries(audit.rows.map((row) => [row.action, row.count]));
    assert(auditCounts.admin_quote_task_created >= 1, "Quote task creation audit event missing.");
    assert(auditCounts.helper_quote_photo_replied >= 2, "Quote reply audit events missing.");

    const urlColumns = await pool.query(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'helper_app'
         and table_name in ('quote_tasks', 'quote_task_photos', 'quote_photo_replies', 'media_objects')
         and column_name in ('signed_url', 'upload_url', 'download_url', 'share_url')`,
    );
    assert(urlColumns.rows.length === 0, "Temporary signed URL columns exist in durable quote tables.");

    console.log(
      JSON.stringify(
        {
          activeTripId: activeTrip.id,
          adminFeedSignedUrlsVerified: true,
          detailReplyMediaRetained: true,
          duplicateReplyStable: true,
          helperIsolationVerified: true,
          inactiveHelperBlocked: true,
          productAcceptance: "slice3",
          quoteTaskId: task.id,
          quoteTaskPhotoCount: task.photos.length,
          r2ObjectsUploaded: uploadedStorageKeys.length,
          storageKeys: uploadedStorageKeys,
          taskCompletedAfterAllReplies: true,
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
