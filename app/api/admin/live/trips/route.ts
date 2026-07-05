import { NextResponse } from "next/server";

import { getCurrentAdmin } from "../../../../../src/server/current-session";
import database from "../../../../../src/server/database";
import service from "../../../../../src/server/helper-app-service";

export async function GET() {
  try {
    await getCurrentAdmin();
  } catch {
    return NextResponse.json({ error: "請先登入管理員帳號。" }, { status: 401 });
  }

  const dashboard = await service.listAdminDashboard(database.getDatabasePool(), {
    sections: ["trips"],
    tripStatuses: ["active"],
  });

  return NextResponse.json(
    { trips: dashboard.trips },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
