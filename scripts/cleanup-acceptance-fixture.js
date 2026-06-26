const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const { authServerConfig, databaseConfig } = require("../src/server/config");
const { loadLocalEnv } = require("../src/server/load-local-env");

loadLocalEnv(path.join(__dirname, ".."));

async function main() {
  const payload = JSON.parse(process.argv[2] || "{}");
  const userIds = [
    payload.admin?.userId,
    payload.helper?.userId,
    payload.otherHelper?.userId,
  ].filter(Boolean);
  const helperIds = [
    payload.helper?.helperProfileId,
    payload.otherHelper?.helperProfileId,
  ].filter(Boolean);

  const client = new Client(databaseConfig());
  await client.connect();
  try {
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

  const supabase = createClient(authServerConfig().url, authServerConfig().secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  for (const userId of userIds) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) console.error(`Failed to delete auth user ${userId}:`, error.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
