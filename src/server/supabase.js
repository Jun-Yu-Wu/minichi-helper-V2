import "server-only";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import config from "./config";

const ACCESS_COOKIE = "minichi_helper_access";
const REFRESH_COOKIE = "minichi_helper_refresh";

export function createPrivilegedSupabaseClient() {
  const { secretKey, url } = config.authServerConfig();
  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const client = createPrivilegedSupabaseClient();

  return {
    auth: {
      async getUser() {
        const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
        if (!accessToken) return { data: { user: null }, error: null };
        const current = await client.auth.getUser(accessToken);
        if (!current.error && current.data.user) return current;

        const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
        if (!refreshToken) return current;
        const refreshed = await client.auth.refreshSession({
          refresh_token: refreshToken,
        });
        if (refreshed.error || !refreshed.data.session) {
          clearAuthCookies(cookieStore);
          return { data: { user: null }, error: refreshed.error };
        }
        setAuthCookies(cookieStore, refreshed.data.session);
        return { data: { user: refreshed.data.user }, error: null };
      },
    },
  };
}

export function setAuthCookies(cookieStore, session, { requestUrl } = {}) {
  const common = {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureCookies(requestUrl),
  };
  try {
    cookieStore.set(ACCESS_COOKIE, session.access_token, {
      ...common,
      maxAge: session.expires_in || 3600,
    });
    cookieStore.set(REFRESH_COOKIE, session.refresh_token, {
      ...common,
      maxAge: 60 * 60 * 24 * 30,
    });
    return true;
  } catch {
    return false;
  }
}

export function clearAuthCookies(cookieStore, { requestUrl } = {}) {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
    try {
      cookieStore.set(name, "", {
        httpOnly: true,
        maxAge: 0,
        path: "/",
        sameSite: "lax",
        secure: shouldUseSecureCookies(requestUrl),
      });
    } catch {
      // Server Components can read but not mutate cookies.
    }
  }
}

function shouldUseSecureCookies(requestUrl) {
  const override = String(process.env.MINICHI_AUTH_COOKIE_SECURE || "").trim();
  if (override) return override === "true";
  if (requestUrl) return new URL(requestUrl).protocol === "https:";
  return process.env.VERCEL === "1";
}
