const path = require("node:path");

const { loadLocalEnv } = require("./load-local-env");

const appRoot = process.cwd();
loadLocalEnv(appRoot);
loadLocalEnv(path.resolve(appRoot, ".."));

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function databaseConfig() {
  const connectionString = String(
    process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "",
  ).trim();
  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL or DATABASE_URL is required.");
  }
  const sslMode = optionalEnv("SUPABASE_DB_SSL", "require").toLowerCase();
  if (["0", "false", "disable"].includes(sslMode)) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Database TLS cannot be disabled in production.");
    }
    return { connectionString, ssl: false };
  }
  if (sslMode === "verify-full") {
    return {
      connectionString,
      ssl: {
        ca: requiredEnv("SUPABASE_DB_SSL_CA"),
        rejectUnauthorized: true,
      },
    };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Production database connections require SUPABASE_DB_SSL=verify-full and SUPABASE_DB_SSL_CA.",
    );
  }
  // Local compatibility mode. Production must use verify-full above.
  return { connectionString, ssl: { rejectUnauthorized: false } };
}

function authServerConfig() {
  return {
    secretKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    url: requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  };
}

function optionalEnv(name, fallback = "") {
  const value = String(process.env[name] || "").trim();
  return value || fallback;
}

function optionalNumberEnv(name, fallback, { min = 0 } = {}) {
  const value = Number(optionalEnv(name, String(fallback)));
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`${name} must be a number >= ${min}.`);
  }
  return value;
}

function r2Config() {
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  return {
    accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
    bucket: requiredEnv("R2_BUCKET"),
    endpoint: optionalEnv("R2_ENDPOINT", `https://${accountId}.r2.cloudflarestorage.com`),
    region: optionalEnv("R2_REGION", "auto"),
    secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    signedUrlTtlSeconds: optionalNumberEnv("R2_SIGNED_URL_TTL_SECONDS", 900, { min: 1 }),
  };
}

function uploadConfig() {
  return {
    allowedContentTypes: new Set([
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]),
    maxBytes: optionalNumberEnv("MINICHI_UPLOAD_MAX_BYTES", 8 * 1024 * 1024, { min: 1 }),
  };
}

function adminEmails() {
  return new Set(
    String(process.env.MINICHI_ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

module.exports = {
  adminEmails,
  authServerConfig,
  databaseConfig,
  r2Config,
  uploadConfig,
};
