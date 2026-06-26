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
  return `CodexSlice2-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
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
    admin: await createAuthUser(supabase, `codex-slice2-admin-${stamp}@example.com`, randomPassword()),
    helper: await createAuthUser(supabase, `codex-slice2-helper-${stamp}@example.com`, randomPassword()),
    inactive: await createAuthUser(supabase, `codex-slice2-inactive-${stamp}@example.com`, randomPassword()),
    other: await createAuthUser(supabase, `codex-slice2-other-${stamp}@example.com`, randomPassword()),
  };

  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const helper = await insertHelper(client, users.helper, "Codex Slice 2 Helper", true);
    const other = await insertHelper(client, users.other, "Codex Slice 2 Other", true);
    const inactive = await insertHelper(client, users.inactive, "Codex Slice 2 Inactive", false);
    const today = todayInTokyo();
    const trips = {
      activeCandidate: await insertTrip(client, helper.id, today, "scheduled", "Codex Slice 2 Main"),
      canceled: await insertTrip(client, helper.id, today, "canceled", "Codex Slice 2 Canceled"),
      ended: await insertTrip(client, helper.id, today, "ended", "Codex Slice 2 Ended"),
      inactive: await insertTrip(client, inactive.id, today, "active", "Codex Slice 2 Inactive"),
      other: await insertTrip(client, other.id, today, "active", "Codex Slice 2 Other"),
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
        canceled_at, ended_at, admin_activated_at)
     values ($1, $2, '10:30', 'Tokyo Station', 'Asia/Tokyo', $3, $4,
        case when $4 = 'canceled' then now() else null end,
        case when $4 = 'ended' then now() else null end,
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

    const workspace = await service.getHelperWorkspace(pool, fixture.users.helper.id);
    assert(
      workspace.groups.today.some((trip) => trip.id === activeTrip.id),
      "Helper cannot see the assigned active trip.",
    );
    assert(
      !workspace.groups.today.some((trip) => trip.id === fixture.trips.other.id),
      "Helper can see another helper's trip.",
    );

    const basePresign = {
      contentType: "image/png",
      fileName: "codex-slice2.png",
      tripId: activeTrip.id,
    };
    const otherBlocked = await presign(appBaseUrl, otherAuth.session, {
      ...basePresign,
      clientPhotoId: `other-${Date.now()}`,
    });
    assert(!otherBlocked.ok, "Other helper was allowed to presign this trip.");

    const inactiveBlocked = await presign(appBaseUrl, inactiveAuth.session, {
      ...basePresign,
      clientPhotoId: `inactive-${Date.now()}`,
      tripId: fixture.trips.inactive.id,
    });
    assert(!inactiveBlocked.ok, "Inactive helper was allowed to presign.");

    for (const blockedTrip of [fixture.trips.canceled, fixture.trips.ended]) {
      const blocked = await presign(appBaseUrl, helperAuth.session, {
        ...basePresign,
        clientPhotoId: `blocked-${blockedTrip.id}`,
        tripId: blockedTrip.id,
      });
      assert(!blocked.ok, `Upload was allowed for blocked trip ${blockedTrip.id}.`);
    }

    const photoA = await presign(appBaseUrl, helperAuth.session, {
      ...basePresign,
      clientPhotoId: `codex-slice2-a-${Date.now()}`,
    });
    const photoB = await presign(appBaseUrl, helperAuth.session, {
      ...basePresign,
      clientPhotoId: `codex-slice2-b-${Date.now()}`,
      fileName: "codex-slice2-retry.png",
    });
    assert(photoA.ok && photoB.ok, `Presign failed: ${JSON.stringify({ photoA, photoB })}`);

    for (const photo of [photoA, photoB]) {
      const upload = await fetch(photo.json.uploadUrl, {
        body: PNG,
        headers: { "content-type": "image/png" },
        method: "PUT",
      });
      assert(upload.ok, `R2 upload failed for ${photo.json.storageKey}: ${upload.status}`);
      uploadedStorageKeys.push(photo.json.storageKey);
    }

    const submissionId = `codex-slice2-submission-${Date.now()}`;
    const payload = {
      authUserId: fixture.users.helper.id,
      note: "Codex Slice 2 product acceptance",
      photos: [
        {
          byteSize: PNG.length,
          clientPhotoId: "codex-slice2-client-b",
          contentType: "image/png",
          originalFilename: "codex-slice2-retry.png",
          sortOrder: 1,
          storageKey: photoB.json.storageKey,
        },
        {
          byteSize: PNG.length,
          clientPhotoId: "codex-slice2-client-a",
          contentType: "image/png",
          originalFilename: "codex-slice2.png",
          sortOrder: 0,
          storageKey: photoA.json.storageKey,
        },
      ],
      submissionId,
      tripId: activeTrip.id,
    };
    const first = await service.submitSitePhotoBatch(pool, payload);
    const duplicate = await service.submitSitePhotoBatch(pool, payload);
    assert(first.id === duplicate.id, "Duplicate submission_id created a second batch.");
    assert(first.photos.length === 2, "Submitted batch did not keep exactly two photos.");
    assert(
      first.photos.map((photo) => photo.sort_order).join(",") === "0,1",
      "Photo ordering was not preserved.",
    );
    assert(
      first.photos.every((photo) => photo.storage_key && !/^https?:\/\//.test(photo.storage_key)),
      "A signed URL was persisted as a storage key.",
    );

    const photoCount = await pool.query(
      "select count(*)::int as count from helper_app.site_photos where batch_id = $1",
      [first.id],
    );
    assert(photoCount.rows[0].count === 2, "Duplicate submit or retry created extra photo rows.");

    const signed = await service.attachSignedPhotoUrls([first], createR2ObjectStore());
    assert(
      signed[0].photos.every((photo) => /^https?:\/\//.test(photo.signed_url || "")),
      "Display/share/download signed URLs were not generated.",
    );
    const displayFetch = await fetch(signed[0].photos[0].signed_url);
    assert(displayFetch.ok, `Signed display/download URL failed: ${displayFetch.status}`);

    const saved = await service.markSitePhotoSaved(pool, {
      actorUserId: fixture.users.admin.id,
      photoId: first.photos[0].id,
    });
    assert(saved.saved_by_admin === true, "Admin save did not mark the photo saved.");
    const retention = await pool.query(
      `select retention_status
       from helper_app.media_objects
       where storage_key = $1`,
      [saved.storage_key],
    );
    assert(retention.rows[0]?.retention_status === "admin_saved", "Admin save did not retain media.");

    const audit = await pool.query(
      `select count(*)::int as count
       from helper_app.trip_audit_events
       where trip_id = $1 and action = 'admin_site_photo_saved'`,
      [activeTrip.id],
    );
    assert(audit.rows[0].count >= 1, "Admin save audit event was not written.");

    const urlColumns = await pool.query(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'helper_app'
         and table_name in ('media_objects', 'site_photo_batches', 'site_photos')
         and column_name in ('signed_url', 'upload_url', 'download_url', 'share_url')`,
    );
    assert(urlColumns.rows.length === 0, "Temporary signed URL columns exist in durable tables.");

    console.log(
      JSON.stringify(
        {
          activeTripId: activeTrip.id,
          adminSaveVerified: true,
          batchId: first.id,
          duplicateStable: true,
          helperIsolationVerified: true,
          inactiveHelperBlocked: true,
          nonActiveTripsBlocked: true,
          photoCount: photoCount.rows[0].count,
          productAcceptance: "slice2",
          r2ObjectsUploaded: uploadedStorageKeys.length,
          signedUrlsDisplayOnly: true,
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
