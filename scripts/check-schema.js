const path = require("node:path");
const { Client } = require("pg");

const { databaseConfig } = require("../src/server/config");
const { loadLocalEnv } = require("../src/server/load-local-env");

loadLocalEnv(path.join(__dirname, ".."));

async function main() {
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const expectedTables = [
      "helper_profiles",
      "media_objects",
      "purchase_task_photos",
      "purchase_task_results",
      "purchase_batches",
      "purchase_tasks",
      "quote_photo_replies",
      "quote_task_photos",
      "quote_tasks",
      "rebuy_task_photos",
      "rebuy_tasks",
      "reviewed_staging_order_photos",
      "reviewed_staging_orders",
      "reviewed_staging_order_items",
      "settlement_evidence",
      "settlement_line_items",
      "settlement_payments",
      "settlements",
      "site_photo_batches",
      "site_photos",
      "staging_order_previews",
      "staging_order_preview_items",
      "staging_merge_jobs",
      "trip_audit_events",
      "trips",
    ];
    const tables = await client.query(
      `select table_name
       from information_schema.tables
       where table_schema = 'helper_app'
         and table_name = any($1::text[])
       order by table_name`,
      [expectedTables],
    );
    const rls = await client.query(
      `select relname as table_name, relrowsecurity as rls_enabled
       from pg_class
       join pg_namespace on pg_namespace.oid = pg_class.relnamespace
       where nspname = 'helper_app'
         and relname = any($1::text[])
       order by relname`,
      [expectedTables],
    );
    const columns = await client.query(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'helper_app'
       and table_name in ('purchase_batches', 'purchase_tasks', 'purchase_task_results', 'reviewed_staging_orders', 'reviewed_staging_order_items', 'settlements', 'staging_order_previews', 'staging_order_preview_items', 'trips')
       and column_name = any($1::text[])
       order by column_name`,
      [[
        "connection_paused_at",
        "connection_paused_seconds",
        "intake_status",
        "product_type",
        "purchase_batch_id",
        "result_photo_storage_key",
        "source_rebuy_task_id",
        "transport_claim_note",
        "unboxing_status",
        "workflow_version",
      ]],
    );
    console.log(
      JSON.stringify(
        {
          columns: columns.rows,
          rls: rls.rows,
          tables: tables.rows.map((row) => row.table_name),
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
