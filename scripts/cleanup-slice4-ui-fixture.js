const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const { authServerConfig, databaseConfig } = require("../src/server/config");
const { createR2ObjectStore } = require("../src/server/r2-object-store");

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
  const storageKeys = Array.isArray(payload.storageKeys) ? payload.storageKeys : [];

  const client = new Client(databaseConfig());
  await client.connect();
  try {
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
