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
  const client = new Client(databaseConfig({ connectionString: target.databaseUrl }));
  await client.connect();
  try {
    const inspection = await inspectApplicationDatabase(client);
    assertEmptyApplicationDatabase(inspection);
    console.log(
      JSON.stringify(
        {
          applicationTableCount: inspection.tables.length,
          empty: true,
          projectRef: target.projectRef,
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
  console.error(error.message);
  process.exit(1);
});
