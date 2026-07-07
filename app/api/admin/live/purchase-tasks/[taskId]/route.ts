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
  if (!tripId) {
    return NextResponse.json({ error: "缺少行程資訊。" }, { status: 400 });
  }

  const { taskId } = await params;
  const tasks = await (service.listPurchaseTasks as any)(database.getDatabasePool(), {
    taskIds: [taskId],
    tripIds: [tripId],
  });
  if (!tasks[0]) {
    return NextResponse.json({ error: "找不到這個採買任務。" }, { status: 404 });
  }

  const [task] = await service.attachSignedPurchaseTaskUrls(
    tasks,
    createR2ObjectStore(),
  );

  return NextResponse.json(
    { task },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
