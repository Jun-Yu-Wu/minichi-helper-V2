import "server-only";

import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import config from "./config";

const ACCESS_COOKIE = "minichi_helper_access";
const REFRESH_COOKIE = "minichi_helper_refresh";
const AUTH_CACHE_TTL_MS = 5_000;
const AUTH_CACHE_MAX_ENTRIES = 256;
const privilegedClient = createPrivilegedSupabaseClient();
const userCache = new Map();

function cachedUser(accessToken) {
  const entry = userCache.get(accessToken);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    userCache.delete(accessToken);
    return null;
  }
  return entry.promise;
}

function rememberUser(accessToken, promise) {
  if (userCache.size >= AUTH_CACHE_MAX_ENTRIES) {
    const oldestKey = userCache.keys().next().value;
    if (oldestKey) userCache.delete(oldestKey);
  }
  const cachedPromise = Promise.resolve(promise).then((result) => {
    if (result?.error) userCache.delete(accessToken);
    return result;
  });
  const entry = { expiresAt: Date.now() + AUTH_CACHE_TTL_MS, promise: cachedPromise };
  userCache.set(accessToken, entry);
  cachedPromise.catch(() => {
    if (userCache.get(accessToken) === entry) userCache.delete(accessToken);
  });
  return cachedPromise;
}

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

  return {
    auth: {
      async getUser() {
        const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
        if (!accessToken) return { data: { user: null }, error: null };
        // getUser() performs a server-side Auth check. Do not use getClaims()
        // here as the only guard: locally valid JWTs can outlive a logout or
        // account deactivation until their expiry time.
        const currentRequest = cachedUser(accessToken) || rememberUser(
          accessToken,
          privilegedClient.auth.getUser(accessToken),
        );
        const current = await currentRequest;
        if (!current.error && current.data?.user?.id) {
          return {
            data: {
              user: current.data.user,
            },
            error: null,
          };
        }

        // A transport error (for example a Supabase Auth connect timeout) is
        // not evidence that the refresh token is expired. Retrying refresh in
        // that case doubles the latency of every protected request.
        if (!shouldRefreshAfterAuthError(current.error)) {
          return { data: { user: null }, error: current.error };
        }
        const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
        if (!refreshToken) {
          return { data: { user: null }, error: current.error };
        }
        const refreshed = await privilegedClient.auth.refreshSession({
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

function shouldRefreshAfterAuthError(error) {
  const status = Number(error?.status || error?.context?.status || 0);
  return status === 401 || status === 403;
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
