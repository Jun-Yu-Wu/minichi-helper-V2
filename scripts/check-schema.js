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
      "purchase_tasks",
      "quote_photo_replies",
      "quote_task_photos",
      "quote_tasks",
      "settlement_evidence",
      "settlement_line_items",
      "settlement_payments",
      "settlements",
      "site_photo_batches",
      "site_photos",
      "staging_order_previews",
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
    console.log(
      JSON.stringify(
        {
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
