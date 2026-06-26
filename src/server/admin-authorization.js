const { adminEmails } = require("./config");

class AdminAuthorizationError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "AdminAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

async function authorizeAdminByAllowlist(authClient) {
  const { data, error } = await authClient.auth.getUser();
  if (error || !data?.user) {
    throw new AdminAuthorizationError("unauthenticated", 401, "Authentication is required.");
  }
  const allowed = adminEmails();
  const email = String(data.user.email || "").trim().toLowerCase();
  if (!email || !allowed.has(email)) {
    throw new AdminAuthorizationError("admin_access_required", 403, "Admin access is required.");
  }
  return { email, user: data.user };
}

function isAdminAuthorizationError(error) {
  return error instanceof AdminAuthorizationError;
}

module.exports = {
  AdminAuthorizationError,
  authorizeAdminByAllowlist,
  isAdminAuthorizationError,
};
