import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "minichi_helper_access";
const REFRESH_COOKIE = "minichi_helper_refresh";
const REFRESH_LEAD_SECONDS = 60;

function accessTokenNeedsRefresh(accessToken: string) {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return true;

  try {
    const encodedPayload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = encodedPayload.padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=");
    const payload = JSON.parse(atob(paddedPayload));
    const expiresAt = Number(payload.exp);
    return !Number.isFinite(expiresAt)
      || expiresAt <= Math.floor(Date.now() / 1000) + REFRESH_LEAD_SECONDS;
  } catch {
    return true;
  }
}

function shouldUseSecureCookies(request: NextRequest) {
  const override = String(process.env.MINICHI_AUTH_COOKIE_SECURE || "").trim();
  if (override) return override === "true";
  return request.nextUrl.protocol === "https:";
}

function setSessionCookies(
  response: NextResponse,
  request: NextRequest,
  session: { access_token: string; refresh_token: string; expires_in?: number },
) {
  const common = {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: shouldUseSecureCookies(request),
  };
  const accessMaxAge = session.expires_in || 3600;

  request.cookies.set(ACCESS_COOKIE, session.access_token);
  request.cookies.set(REFRESH_COOKIE, session.refresh_token);
  response.cookies.set(ACCESS_COOKIE, session.access_token, {
    ...common,
    maxAge: accessMaxAge,
  });
  response.cookies.set(REFRESH_COOKIE, session.refresh_token, {
    ...common,
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  // Normal requests stay on the fast path: no Auth network request and no
  // response cookie mutation while the access token is still fresh.
  if (!accessToken || !refreshToken || !accessTokenNeedsRefresh(accessToken)) {
    return NextResponse.next();
  }

  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.next();

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const refreshed = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (!refreshed.data.session) return NextResponse.next();

    const response = NextResponse.next({ request });
    setSessionCookies(response, request, refreshed.data.session);
    return response;
  } catch {
    // Leave the cookies intact on transient Auth/network failures. The
    // protected server boundary will decide whether the session is actually
    // invalid instead of turning a temporary outage into a logout.
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
