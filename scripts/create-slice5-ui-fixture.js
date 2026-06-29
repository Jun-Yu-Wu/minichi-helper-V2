const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const database = require("../src/server/database");
const { authServerConfig, databaseConfig } = require("../src/server/config");
const { createR2ObjectStore } = require("../src/server/r2-object-store");
const service = require("../src/server/helper-app-service");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function randomPassword() {
  return `CodexUi5-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
}

function todayInTokyo() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date());
}

async function createAuthUser(supabase, role, stamp) {
  const email = `codex-slice5-ui-${role}-${stamp}@example.com`;
  const password = randomPassword();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (error) throw error;
  return { email, password, userId: data.user.id };
}

async function uploadReference(r2, tripId, label, storageKeys) {
  const storageKey = `helper-app/${tripId}/slice5-ui/${label}-${Date.now()}.png`;
  const uploadUrl = await r2.signedPutUrl(storageKey, "image/png");
  const response = await fetch(uploadUrl, {
    body: PNG,
    headers: { "content-type": "image/png" },
    method: "PUT",
  });
  if (!response.ok) throw new Error(`Fixture R2 PUT failed: ${response.status}`);
  storageKeys.push(storageKey);
  return {
    byteSize: PNG.length,
    contentType: "image/png",
    originalFilename: `${label}.png`,
    sortOrder: 0,
    storageKey,
  };
}

async function main() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const supabase = createClient(authServerConfig().url, authServerConfig().secretKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const admin = await createAuthUser(supabase, "admin", stamp);
  const helper = await createAuthUser(supabase, "helper", stamp);
  const client = new Client(databaseConfig());
  await client.connect();
  let helperProfileId;
  let trip;
  try {
    const helperResult = await client.query(
      `insert into helper_app.helper_profiles
         (auth_user_id, display_name, email, compensation_mode, hourly_rate_twd,
          bank_account_name, bank_code, bank_account_number, region, is_active)
       values ($1, 'Codex Slice 5 UI Helper', $2, 'hourly', 240,
          'Codex Slice 5 UI Helper', '812', '1234567890', 'Tokyo', true)
       returning id`,
      [helper.userId, helper.email],
    );
    helperProfileId = helperResult.rows[0].id;
    const tripResult = await client.query(
      `insert into helper_app.trips
         (trip_name, business_date, scheduled_time, location, timezone,
          assigned_helper_id, status, departed_at, arrived_at, admin_activated_at, version)
       values ('Codex Slice 5 UI Trip', $1, '10:00', 'Tokyo Station', 'Asia/Tokyo',
          $2, 'active', now() - interval '2 hours', now() - interval '100 minutes',
          now() - interval '90 minutes', 4)
       returning id, version`,
      [todayInTokyo(), helperProfileId],
    );
    trip = tripResult.rows[0];
  } finally {
    await client.end();
  }

  const storageKeys = [];
  const r2 = createR2ObjectStore();
  const pool = database.getDatabasePool();
  try {
    const completedTask = await service.createPurchaseTask(pool, {
      actorUserId: admin.userId,
      lineCommunityName: "UI驗收完成客人",
      originalPriceJpy: "10000",
      productName: "UI 已完成商品",
      quantity: "1",
      referencePhotos: [await uploadReference(r2, trip.id, "completed", storageKeys)],
      salePriceTwd: "3000",
      tripId: trip.id,
    });
    await service.respondPurchaseTask(pool, {
      action: "complete",
      authUserId: helper.userId,
      completedQuantity: "1",
      idempotencyKey: `slice5-ui-completed-${Date.now()}`,
      purchaseTaskId: completedTask.id,
    });
    const openTask = await service.createPurchaseTask(pool, {
      actorUserId: admin.userId,
      lineCommunityName: "UI驗收待辦客人",
      originalPriceJpy: "500",
      productName: "UI 待完成商品",
      quantity: "1",
      referencePhotos: [await uploadReference(r2, trip.id, "open", storageKeys)],
      salePriceTwd: "200",
      tripId: trip.id,
    });
    console.log(
      JSON.stringify(
        {
          admin,
          helper: { ...helper, helperProfileId },
          openTask: { id: openTask.id },
          storageKeys,
          trip,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
