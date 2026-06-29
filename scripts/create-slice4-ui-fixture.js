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
  return `CodexUi-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
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
  const email = `codex-slice4-ui-${role}-${stamp}@example.com`;
  const password = randomPassword();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
  });
  if (error) throw error;
  return { email, password, userId: data.user.id };
}

async function main() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const supabase = createClient(authServerConfig().url, authServerConfig().secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const admin = await createAuthUser(supabase, "admin", stamp);
  const helperUser = await createAuthUser(supabase, "helper", stamp);
  const otherUser = await createAuthUser(supabase, "other", stamp);

  const client = new Client(databaseConfig());
  await client.connect();
  let helperId;
  let otherHelperId;
  let trip;
  try {
    let result = await client.query(
      `insert into helper_app.helper_profiles
         (auth_user_id, display_name, email, compensation_mode, hourly_rate_twd, region, is_active)
       values ($1, 'Codex Slice 4 UI Helper', $2, 'hourly', 250, 'Tokyo', true)
       returning id`,
      [helperUser.userId, helperUser.email],
    );
    helperId = result.rows[0].id;

    result = await client.query(
      `insert into helper_app.helper_profiles
         (auth_user_id, display_name, email, compensation_mode, hourly_rate_twd, region, is_active)
       values ($1, 'Codex Slice 4 UI Other', $2, 'hourly', 250, 'Osaka', true)
       returning id`,
      [otherUser.userId, otherUser.email],
    );
    otherHelperId = result.rows[0].id;

    result = await client.query(
      `insert into helper_app.trips
         (trip_name, business_date, scheduled_time, location, timezone,
          assigned_helper_id, status, departed_at, arrived_at, admin_activated_at, version)
       values ('Codex Slice 4 UI Trip', $1, '10:30', 'Tokyo Station', 'Asia/Tokyo',
          $2, 'active', now(), now(), now(), 4)
       returning id, version`,
      [todayInTokyo(), helperId],
    );
    trip = result.rows[0];

    await client.query(
      `insert into helper_app.trips
         (trip_name, business_date, scheduled_time, location, timezone, assigned_helper_id, status)
       values ('Codex Slice 4 UI Hidden', $1, '12:00', 'Osaka', 'Asia/Tokyo', $2, 'active')`,
      [todayInTokyo(), otherHelperId],
    );
  } finally {
    await client.end();
  }

  const storageKeys = [];
  const r2 = createR2ObjectStore();
  const referenceKey = `helper-app/${trip.id}/purchase-reference/codex-slice4-ui-helper-reference-${Date.now()}.png`;
  const referenceUrl = await r2.signedPutUrl(referenceKey, "image/png");
  const upload = await fetch(referenceUrl, {
    body: PNG,
    headers: { "content-type": "image/png" },
    method: "PUT",
  });
  if (!upload.ok) throw new Error(`Fixture R2 PUT failed: ${upload.status}`);
  storageKeys.push(referenceKey);

  const pool = database.getDatabasePool();
  const task = await service.createPurchaseTask(pool, {
    actorUserId: admin.userId,
    lineCommunityName: "UI驗收客人",
    originalPriceJpy: "1500",
    productName: "UI Helper Complete Product",
    quantity: "1",
    referencePhotos: [
      {
        byteSize: PNG.length,
        contentType: "image/png",
        originalFilename: "helper-reference.png",
        sortOrder: 0,
        storageKey: referenceKey,
      },
    ],
    salePriceTwd: "500",
    tripId: trip.id,
  });
  await pool.end();

  console.log(
    JSON.stringify(
      {
        admin,
        helper: {
          ...helperUser,
          helperProfileId: helperId,
        },
        otherHelper: {
          ...otherUser,
          helperProfileId: otherHelperId,
        },
        storageKeys,
        task: { id: task.id },
        trip,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
