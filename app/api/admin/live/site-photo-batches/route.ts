import { NextResponse } from "next/server";

import { getCurrentAdmin } from "../../../../../src/server/current-session";
import database from "../../../../../src/server/database";
import service from "../../../../../src/server/helper-app-service";

export async function GET(request: Request) {
  try {
    await getCurrentAdmin();
  } catch {
    return NextResponse.json({ error: "請先登入管理員帳號。" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tripId = String(searchParams.get("tripId") || "").trim();
  if (!tripId) {
    return NextResponse.json({ error: "缺少行程資訊。" }, { status: 400 });
  }

  const batches = await (service as any).listSitePhotoBatches(database.getDatabasePool(), {
    includePhotos: false,
    tripIds: [tripId],
  });

  return NextResponse.json(
    { batches },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
