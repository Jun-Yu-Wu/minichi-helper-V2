import "server-only";

import { cache } from "react";

import adminAuthorization from "./admin-authorization";
import { createServerSupabaseClient } from "./supabase";

export const getCurrentUser = cache(async () => {
  const authClient = await createServerSupabaseClient();
  const { data, error } = await authClient.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
});

export const getCurrentAdmin = cache(async () => {
  const authClient = await createServerSupabaseClient();
  return adminAuthorization.authorizeAdminByAllowlist(authClient);
});
