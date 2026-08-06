const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertEmptyApplicationDatabase,
  assertExpectedProjectRef,
  projectRefsFromUrl,
} = require("../scripts/migration-target");

const NEW_PROJECT_REF = "rxaqbgqucgflpezdbnyx";

test("extracts a Project Ref from project, direct, and session pooler URLs", () => {
  assert.deepEqual(
    projectRefsFromUrl(`https://${NEW_PROJECT_REF}.supabase.co`, "project URL"),
    [NEW_PROJECT_REF],
  );
  assert.deepEqual(
    projectRefsFromUrl(`postgresql://postgres:secret@db.${NEW_PROJECT_REF}.supabase.co:5432/postgres`, "DB URL"),
    [NEW_PROJECT_REF],
  );
  assert.deepEqual(
    projectRefsFromUrl(
      `postgresql://postgres.${NEW_PROJECT_REF}:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
      "pooler URL",
    ),
    [NEW_PROJECT_REF],
  );
});

test("rejects a migration URL for another Supabase project", () => {
  assert.throws(
    () =>
      assertExpectedProjectRef({
        databaseUrl:
          "postgresql://postgres.ymckczotlmoismsdnfoe:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
        expectedRef: NEW_PROJECT_REF,
        projectUrl: `https://${NEW_PROJECT_REF}.supabase.co`,
      }),
    /Migration target mismatch/,
  );
});

test("accepts matching project and database URLs", () => {
  assert.equal(
    assertExpectedProjectRef({
      databaseUrl: `postgresql://postgres.${NEW_PROJECT_REF}:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
      expectedRef: NEW_PROJECT_REF,
      projectUrl: `https://${NEW_PROJECT_REF}.supabase.co`,
    }),
    NEW_PROJECT_REF,
  );
});

test("empty-database assertion rejects application rows", () => {
  assert.doesNotThrow(() => assertEmptyApplicationDatabase({ nonemptyTables: [] }));
  assert.throws(
    () =>
      assertEmptyApplicationDatabase({
        nonemptyTables: [{ count: 1, schema: "main", table: "orders" }],
      }),
    /main\.orders \(1\)/,
  );
});
