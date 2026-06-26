const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const { loadLocalEnv } = require("../src/server/load-local-env");

loadLocalEnv(path.join(__dirname, ".."));

const { databaseConfig } = require("../src/server/config");

async function main() {
  const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const client = new Client(databaseConfig());
  await client.connect();
  try {
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
