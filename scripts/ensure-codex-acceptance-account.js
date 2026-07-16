const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const { authServerConfig, databaseConfig } = require("../src/server/config");
const { loadLocalEnv } = require("../src/server/load-local-env");

loadLocalEnv(path.join(__dirname, ".."));

const acceptancePassword = String(process.env.CODEX_ACCEPTANCE_PASSWORD || "").trim();
if (!acceptancePassword) {
  throw new Error("CODEX_ACCEPTANCE_PASSWORD must be set outside the repository before running this script.");
}

const ACCOUNT = {
  displayName: "Codex 驗收小幫手",
  email: process.env.CODEX_ACCEPTANCE_EMAIL || "codex.acceptance@minichi.test",
  password: acceptancePassword,
  region: "Tokyo",
};

async function findUserByEmail(supabase, email) {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = (data.users || []).find(
      (user) => String(user.email || "").trim().toLowerCase() === normalized,
    );
    if (found) return found;
    if (!data.users || data.users.length < 1000) return null;
  }
  throw new Error("Could not scan all Supabase Auth users within the page limit.");
}

async function ensureAuthUser(supabase) {
  const existing = await findUserByEmail(supabase, ACCOUNT.email);
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      email: ACCOUNT.email,
      email_confirm: true,
      password: ACCOUNT.password,
      user_metadata: {
        ...existing.user_metadata,
        acceptance_account: "codex",
        display_name: ACCOUNT.displayName,
      },
    });
    if (error) throw error;
    return { created: false, user: data.user };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: ACCOUNT.email,
    email_confirm: true,
    password: ACCOUNT.password,
    user_metadata: {
      acceptance_account: "codex",
      display_name: ACCOUNT.displayName,
    },
  });
  if (error) throw error;
  return { created: true, user: data.user };
}

async function ensureHelperProfile(userId) {
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    const result = await client.query(
      `insert into helper_app.helper_profiles
         (auth_user_id, display_name, email, compensation_mode, hourly_rate_twd,
          helper_fx_rate, bank_account_name, bank_code, bank_account_number,
          region, is_active)
       values ($1, $2, $3, 'hourly', 250, null, null, null, null, $4, true)
       on conflict (auth_user_id) do update set
         display_name = excluded.display_name,
         email = excluded.email,
         compensation_mode = excluded.compensation_mode,
         hourly_rate_twd = excluded.hourly_rate_twd,
         helper_fx_rate = excluded.helper_fx_rate,
         region = excluded.region,
         is_active = true,
         updated_at = now()
       returning id, auth_user_id, display_name, email, region, is_active`,
      [userId, ACCOUNT.displayName, ACCOUNT.email, ACCOUNT.region],
    );
    return result.rows[0];
  } finally {
    await client.end();
  }
}

async function main() {
  const supabase = createClient(authServerConfig().url, authServerConfig().secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const auth = await ensureAuthUser(supabase);
  const helperProfile = await ensureHelperProfile(auth.user.id);

  console.log(
    JSON.stringify(
      {
        authUser: {
          created: auth.created,
          email: ACCOUNT.email,
          id: auth.user.id,
        },
        helperProfile,
        login: {
          email: ACCOUNT.email,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
