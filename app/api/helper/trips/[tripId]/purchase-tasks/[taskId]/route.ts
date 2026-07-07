import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../../src/server/current-session";
import database from "../../../../../../../src/server/database";
import service from "../../../../../../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../../../../../../src/server/r2-object-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string; tripId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }

  const { taskId, tripId } = await params;
  const tasks = await (service.listPurchaseTasks as any)(database.getDatabasePool(), {
    activeOnly: true,
    authUserId: user.id,
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
