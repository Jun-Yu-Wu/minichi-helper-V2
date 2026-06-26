const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const { authServerConfig, databaseConfig } = require("../src/server/config");
const { loadLocalEnv } = require("../src/server/load-local-env");

loadLocalEnv(path.join(__dirname, ".."));

function randomPassword() {
  return `CodexTest-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
}

async function main() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminEmail = `codex-admin-${stamp}@example.com`;
  const helperEmail = `codex-helper-${stamp}@example.com`;
  const otherEmail = `codex-other-${stamp}@example.com`;
  const adminPassword = randomPassword();
  const helperPassword = randomPassword();
  const otherPassword = randomPassword();

  const supabase = createClient(authServerConfig().url, authServerConfig().secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const createdUsers = [];
  for (const [email, password] of [
    [adminEmail, adminPassword],
    [helperEmail, helperPassword],
    [otherEmail, otherPassword],
  ]) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
    });
    if (error) throw error;
    createdUsers.push({ email, id: data.user.id, password });
  }

  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const helper = await client.query(
      `insert into helper_app.helper_profiles
         (auth_user_id, display_name, email, compensation_mode, hourly_rate_twd,
          region, is_active)
       values ($1, 'Codex 驗收小幫手', $2, 'hourly', 250, 'Tokyo', true)
       returning id`,
      [createdUsers[1].id, helperEmail],
    );
    const otherHelper = await client.query(
      `insert into helper_app.helper_profiles
         (auth_user_id, display_name, email, compensation_mode, hourly_rate_twd,
          region, is_active)
       values ($1, 'Codex 其他小幫手', $2, 'hourly', 250, 'Osaka', true)
       returning id`,
      [createdUsers[2].id, otherEmail],
    );
    const today = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "Asia/Tokyo",
      year: "numeric",
    }).format(new Date());
    const trip = await client.query(
      `insert into helper_app.trips
         (trip_name, business_date, scheduled_time, location, timezone,
          assigned_helper_id, status)
       values ('Codex 驗收行程', $1, '10:30', 'Tokyo Station', 'Asia/Tokyo',
          $2, 'scheduled')
       returning id, version`,
      [today, helper.rows[0].id],
    );
    const otherTrip = await client.query(
      `insert into helper_app.trips
         (trip_name, business_date, scheduled_time, location, timezone,
          assigned_helper_id, status)
       values ('Codex 不應顯示行程', $1, '12:00', 'Osaka', 'Asia/Tokyo',
          $2, 'scheduled')
       returning id`,
      [today, otherHelper.rows[0].id],
    );

    console.log(
      JSON.stringify(
        {
          admin: { email: adminEmail, password: adminPassword, userId: createdUsers[0].id },
          helper: {
            email: helperEmail,
            helperProfileId: helper.rows[0].id,
            password: helperPassword,
            userId: createdUsers[1].id,
          },
          otherHelper: {
            email: otherEmail,
            helperProfileId: otherHelper.rows[0].id,
            password: otherPassword,
            tripId: otherTrip.rows[0].id,
            userId: createdUsers[2].id,
          },
          trip: { id: trip.rows[0].id, version: trip.rows[0].version },
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
