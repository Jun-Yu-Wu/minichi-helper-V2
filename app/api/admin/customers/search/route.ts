import { NextResponse } from "next/server";

import adminAuthorization from "../../../../../src/server/admin-authorization";
import database from "../../../../../src/server/database";
import service from "../../../../../src/server/helper-app-service";
import { createServerSupabaseClient } from "../../../../../src/server/supabase";

export async function GET(request: Request) {
  try {
    await adminAuthorization.authorizeAdminByAllowlist(
      await createServerSupabaseClient(),
    );
    const query = new URL(request.url).searchParams.get("q") || "";
    const nicknames = await service.searchCustomerNicknames(
      database.getDatabasePool(),
      query,
      8,
    );
    return NextResponse.json({ nicknames });
  } catch (error) {
    console.error("Customer nickname search failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "無法搜尋客戶暱稱。" },
      { status: 400 },
    );
  }
}
