const APPLICATION_SCHEMAS = Object.freeze([
  "audit",
  "helper_app",
  "integration",
  "main",
  "staging",
]);

function parseUrl(value, label) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
}

function projectRefsFromUrl(value, label) {
  const parsed = parseUrl(value, label);
  const refs = new Set();
  const directHostMatch = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  const projectHostMatch = parsed.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
  const usernameMatch = decodeURIComponent(parsed.username).match(/^postgres\.([a-z0-9]+)$/i);
  for (const match of [directHostMatch, projectHostMatch, usernameMatch]) {
    if (match) refs.add(match[1].toLowerCase());
  }
  return [...refs];
}

function assertExpectedProjectRef({ expectedRef, databaseUrl, projectUrl }) {
  const expected = String(expectedRef || "").trim().toLowerCase();
  if (!/^[a-z0-9]{20}$/.test(expected)) {
    throw new Error("MINICHI_EXPECTED_SUPABASE_PROJECT_REF must be a 20-character Project Ref.");
  }

  const configured = [];
  if (databaseUrl) {
    const refs = projectRefsFromUrl(databaseUrl, "Supabase migration database URL");
    if (refs.length === 0) {
      throw new Error(
        "Could not determine the Project Ref from the migration database URL. " +
          "Use the Supabase direct connection or session pooler connection string.",
      );
    }
    configured.push(...refs.map((ref) => ({ label: "database URL", ref })));
  } else {
    throw new Error("SUPABASE_MIGRATION_DB_URL is required for migrations.");
  }

  if (projectUrl) {
    const refs = projectRefsFromUrl(projectUrl, "NEXT_PUBLIC_SUPABASE_URL");
    if (refs.length === 0) {
      throw new Error("Could not determine the Project Ref from NEXT_PUBLIC_SUPABASE_URL.");
    }
    configured.push(...refs.map((ref) => ({ label: "project URL", ref })));
  }

  const mismatches = configured.filter(({ ref }) => ref !== expected);
  if (mismatches.length > 0) {
    const details = mismatches.map(({ label, ref }) => `${label}=${ref}`).join(", ");
    throw new Error(`Migration target mismatch: expected ${expected}; received ${details}.`);
  }
  return expected;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function inspectApplicationDatabase(client) {
  const result = await client.query(
    `select table_schema, table_name
       from information_schema.tables
      where table_type = 'BASE TABLE'
        and table_schema = any($1::text[])
      order by table_schema, table_name`,
    [APPLICATION_SCHEMAS],
  );
  const tables = [];
  for (const row of result.rows) {
    const qualifiedName = `${quoteIdentifier(row.table_schema)}.${quoteIdentifier(row.table_name)}`;
    const countResult = await client.query(`select count(*)::bigint as count from ${qualifiedName}`);
    tables.push({
      count: Number(countResult.rows[0].count),
      schema: row.table_schema,
      table: row.table_name,
    });
  }
  return {
    nonemptyTables: tables.filter(({ count }) => count > 0),
    tables,
  };
}

function assertEmptyApplicationDatabase(inspection) {
  if (inspection.nonemptyTables.length === 0) return;
  const details = inspection.nonemptyTables
    .map(({ schema, table, count }) => `${schema}.${table} (${count})`)
    .join(", ");
  throw new Error(`Bootstrap requires an empty application database; found data in ${details}.`);
}

function migrationDatabaseUrl() {
  return String(process.env.SUPABASE_MIGRATION_DB_URL || "").trim();
}

function verifyConfiguredMigrationTarget() {
  const databaseUrl = migrationDatabaseUrl();
  const projectRef = assertExpectedProjectRef({
    databaseUrl,
    expectedRef: process.env.MINICHI_EXPECTED_SUPABASE_PROJECT_REF,
    projectUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  return { databaseUrl, projectRef };
}

module.exports = {
  APPLICATION_SCHEMAS,
  assertEmptyApplicationDatabase,
  assertExpectedProjectRef,
  inspectApplicationDatabase,
  migrationDatabaseUrl,
  projectRefsFromUrl,
  verifyConfiguredMigrationTarget,
};
