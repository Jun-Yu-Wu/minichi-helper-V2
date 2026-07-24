import { NextResponse } from "next/server";

import { getCurrentAdmin } from "../../../../../../src/server/current-session";
import database from "../../../../../../src/server/database";
import service from "../../../../../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../../../../../src/server/r2-object-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    await getCurrentAdmin();
  } catch {
    return NextResponse.json({ error: "請先登入管理員帳號。" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tripId = String(searchParams.get("tripId") || "").trim();
  const photoMode = String(searchParams.get("photoMode") || "report").trim();
  if (!tripId) {
    return NextResponse.json({ error: "缺少行程資訊。" }, { status: 400 });
  }

  const { taskId } = await params;
  const task = await (service.getPurchaseTaskDetail as any)(database.getDatabasePool(), {
    purchaseTaskId: taskId,
    photoMode,
    tripId,
  });
  if (!task) {
    return NextResponse.json({ error: "找不到這個採買任務。" }, { status: 404 });
  }
  const [signedTask] = await service.attachSignedPurchaseTaskUrls(
    [task],
    createR2ObjectStore(),
  );

  return NextResponse.json(
    { task: signedTask },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
