"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  clearAuthCookies,
  createPrivilegedSupabaseClient,
  setAuthCookies,
} from "../../src/server/supabase";

export type LoginActionResult = {
  error?: "invalid_credentials" | "unavailable";
  ok?: true;
};

export async function loginAction(
  _previousState: LoginActionResult,
  formData: FormData,
): Promise<LoginActionResult> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) return { error: "invalid_credentials" };

  try {
    const supabase = createPrivilegedSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) return { error: "invalid_credentials" };
    setAuthCookies(await cookies(), data.session);
    return { ok: true };
  } catch (error) {
    console.error("Helper-system login unavailable", error);
    return { error: "unavailable" };
  }
}

export async function logoutAction() {
  clearAuthCookies(await cookies());
  redirect("/login");
}
