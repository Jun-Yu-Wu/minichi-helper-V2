const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const { authServerConfig, databaseConfig } = require("../src/server/config");
const { createR2ObjectStore } = require("../src/server/r2-object-store");

async function main() {
  const payload = JSON.parse(process.argv[2] || "{}");
  const tripIds = [payload.trip?.id].filter(Boolean);
  const helperIds = [payload.helper?.helperProfileId].filter(Boolean);
  const userIds = [payload.admin?.userId, payload.helper?.userId].filter(isUuid);
  const storageKeys = Array.isArray(payload.storageKeys) ? payload.storageKeys : [];
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    if (tripIds.length) {
      await client.query(
        `delete from helper_app.settlement_payments
         where settlement_id in (select id from helper_app.settlements where trip_id = any($1::uuid[]))`,
        [tripIds],
      );
      await client.query("delete from helper_app.settlements where trip_id = any($1::uuid[])", [tripIds]);
      await client.query("delete from helper_app.purchase_task_photos where trip_id = any($1::uuid[])", [
        tripIds,
      ]);
      await client.query("delete from helper_app.staging_order_previews where trip_id = any($1::uuid[])", [
        tripIds,
      ]);
      await client.query("delete from helper_app.purchase_tasks where trip_id = any($1::uuid[])", [tripIds]);
      await client.query("delete from helper_app.trip_audit_events where trip_id = any($1::uuid[])", [tripIds]);
      await client.query("delete from helper_app.trips where id = any($1::uuid[])", [tripIds]);
    }
    if (storageKeys.length) {
      await client.query("delete from helper_app.media_objects where storage_key = any($1::text[])", [
        storageKeys,
      ]);
    }
    if (helperIds.length) {
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
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  for (const userId of userIds) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) console.error(`Failed to delete auth user ${userId}:`, error.message);
  }
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
