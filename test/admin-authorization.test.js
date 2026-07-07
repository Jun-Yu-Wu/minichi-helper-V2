const assert = require("node:assert/strict");
const test = require("node:test");

const authorization = require("../src/server/admin-authorization");

test("known authenticated admin users can reuse the allowlist check without another auth request", () => {
  const previous = process.env.MINICHI_ADMIN_EMAILS;
  process.env.MINICHI_ADMIN_EMAILS = "owner@example.com";
  try {
    const result = authorization.authorizeAdminUserByAllowlist({
      email: "Owner@Example.com",
      id: "admin-user-1",
    });
    assert.equal(result.email, "owner@example.com");
    assert.equal(result.user.id, "admin-user-1");
  } finally {
    if (previous === undefined) delete process.env.MINICHI_ADMIN_EMAILS;
    else process.env.MINICHI_ADMIN_EMAILS = previous;
  }
});

test("reused admin allowlist checks still reject non-admin users", () => {
  const previous = process.env.MINICHI_ADMIN_EMAILS;
  process.env.MINICHI_ADMIN_EMAILS = "owner@example.com";
  try {
    assert.throws(
      () =>
        authorization.authorizeAdminUserByAllowlist({
          email: "helper@example.com",
          id: "helper-user-1",
        }),
      /Admin access is required/,
    );
  } finally {
    if (previous === undefined) delete process.env.MINICHI_ADMIN_EMAILS;
    else process.env.MINICHI_ADMIN_EMAILS = previous;
  }
});
