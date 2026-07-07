import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../../src/server/current-session";
import database from "../../../../../../../src/server/database";
import service from "../../../../../../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../../../../../../src/server/r2-object-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string; tripId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }

  const { taskId, tripId } = await params;
  const { searchParams } = new URL(request.url);
  const photoMode = String(searchParams.get("photoMode") || "product").trim();
  const task = await (service.getPurchaseTaskDetail as any)(database.getDatabasePool(), {
    activeOnly: true,
    authUserId: user.id,
    purchaseTaskId: taskId,
    tripId,
  });
  if (!task) {
    return NextResponse.json({ error: "找不到這個採買任務。" }, { status: 404 });
  }
  const scopedTask = photoMode === "all"
    ? task
    : {
        ...task,
        photos: (task.photos || []).filter((photo: any) =>
          ["manual_reference", "source"].includes(String(photo.photo_role || "")),
        ),
      };

  const [signedTask] = await service.attachSignedPurchaseTaskUrls(
    [scopedTask],
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
