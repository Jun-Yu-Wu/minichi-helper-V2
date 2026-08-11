import { NextResponse } from "next/server";

import { getCurrentAdmin } from "../../../../../../../src/server/current-session";
import database from "../../../../../../../src/server/database";
import service from "../../../../../../../src/server/helper-app-service";

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
  const quoteTaskPhotoId = String(searchParams.get("quoteTaskPhotoId") || "").trim();
  if (!tripId || !quoteTaskPhotoId) {
    return NextResponse.json({ error: "缺少詢價照片資訊。" }, { status: 400 });
  }

  const { taskId } = await params;
  try {
    const tasks = await service.listQuoteTasks(database.getDatabasePool(), {
      taskIds: [taskId],
      tripIds: [tripId],
    });
    const task = tasks[0];
    const photo = (task?.photos || []).find((item: any) => item.id === quoteTaskPhotoId);
    if (!task || !photo) {
      return NextResponse.json({ error: "找不到這張詢價照片。" }, { status: 404 });
    }

    const history = await service.listQuickPublishPurchaseHistory(
      database.getDatabasePool(),
      { quoteTaskPhotoId, tripId },
    );
    return NextResponse.json(
      { history },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "無法載入快速發布紀錄。" },
      { status: 400 },
    );
  }
}
