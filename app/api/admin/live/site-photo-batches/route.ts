import { NextResponse } from "next/server";

import { getCurrentAdmin } from "../../../../../src/server/current-session";
import database from "../../../../../src/server/database";
import service from "../../../../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../../../../src/server/r2-object-store";

const helperService = service as any;

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

  const batches = await helperService.listSitePhotoBatches(database.getDatabasePool(), {
    tripIds: [tripId],
  });
  const signedBatches = batches.length
    ? await helperService.attachSignedPhotoUrls(batches, createR2ObjectStore())
    : [];

  return NextResponse.json(
    { batches: signedBatches },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
