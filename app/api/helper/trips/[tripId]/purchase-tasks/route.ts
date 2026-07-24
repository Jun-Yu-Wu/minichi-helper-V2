import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../src/server/current-session";
import database from "../../../../../../src/server/database";
import service from "../../../../../../src/server/helper-app-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }

  const { tripId } = await params;
  const tasks = await (service.listHelperPurchaseBatches as any)(database.getDatabasePool(), {
    activeOnly: true,
    authUserId: user.id,
    tripIds: [tripId],
  });

  return NextResponse.json(
    { tasks },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
