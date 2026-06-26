const { Pool } = require("pg");

const { databaseConfig } = require("./config");

const poolKey = Symbol.for("minichi.helper.databasePool");

function getDatabasePool() {
  if (!globalThis[poolKey]) {
    globalThis[poolKey] = new Pool(databaseConfig());
  }
  return globalThis[poolKey];
}

async function withTransaction(database, callback) {
  const client = await database.connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  getDatabasePool,
  withTransaction,
};
