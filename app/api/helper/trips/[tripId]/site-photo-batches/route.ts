import { NextResponse } from "next/server";

import database from "../../../../../../src/server/database";
import service from "../../../../../../src/server/helper-app-service";
import { getCurrentUser } from "../../../../../../src/server/current-session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }

  const { tripId } = await params;
  const result = await service.listAuthorizedHelperSitePhotoBatchSummaries(
    database.getDatabasePool(),
    {
      authUserId: user.id,
      tripId,
    },
  );
  if (!result.authorized) {
    return NextResponse.json(
      { error: "找不到可操作的連線行程。" },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { batches: result.batches },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
