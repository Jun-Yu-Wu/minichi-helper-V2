import { NextResponse } from "next/server";

import { getCurrentAdmin } from "../../../../../../src/server/current-session";
import database from "../../../../../../src/server/database";
import service from "../../../../../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../../../../../src/server/r2-object-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    await getCurrentAdmin();
  } catch {
    return NextResponse.json({ error: "請先登入管理員帳號。" }, { status: 401 });
  }

  const { batchId } = await params;
  const tripId = String(new URL(request.url).searchParams.get("tripId") || "").trim();
  if (!tripId || !batchId) {
    return NextResponse.json({ error: "缺少照片批次資訊。" }, { status: 400 });
  }

  const batches = await (service as any).listSitePhotoBatches(database.getDatabasePool(), {
    batchId,
    includePhotos: true,
    tripIds: [tripId],
  });
  if (!batches[0]) {
    return NextResponse.json({ error: "找不到這個照片批次。" }, { status: 404 });
  }

  const [batch] = await service.attachSignedPhotoUrls(
    batches,
    createR2ObjectStore(),
  );
  return NextResponse.json(
    { batch },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
