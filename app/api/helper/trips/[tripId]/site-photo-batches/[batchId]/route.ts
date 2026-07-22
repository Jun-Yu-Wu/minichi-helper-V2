import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../../src/server/current-session";
import database from "../../../../../../../src/server/database";
import service from "../../../../../../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../../../../../../src/server/r2-object-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string; tripId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }

  const { batchId, tripId } = await params;
  const result = await service.getAuthorizedHelperSitePhotoBatchDetail(
    database.getDatabasePool(),
    {
      authUserId: user.id,
      batchId,
      tripId,
    },
  );
  if (!result.authorized || !result.batch) {
    return NextResponse.json({ error: "找不到這個照片批次。" }, { status: 404 });
  }

  const [batch] = await service.attachSignedPhotoUrls(
    [result.batch],
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
