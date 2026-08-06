const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const { loadLocalEnv } = require("../src/server/load-local-env");

loadLocalEnv(path.join(__dirname, ".."));

const { databaseConfig } = require("../src/server/config");
const {
  assertEmptyApplicationDatabase,
  inspectApplicationDatabase,
  verifyConfiguredMigrationTarget,
} = require("./migration-target");

async function main() {
  const target = verifyConfiguredMigrationTarget();
  const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const client = new Client(databaseConfig({ connectionString: target.databaseUrl }));
  await client.connect();
  try {
    if (String(process.env.MINICHI_REQUIRE_EMPTY_DATABASE || "").trim() === "true") {
      const inspection = await inspectApplicationDatabase(client);
      assertEmptyApplicationDatabase(inspection);
    }
    console.log(`Verified migration target ${target.projectRef}`);
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`Applying ${file}`);
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
