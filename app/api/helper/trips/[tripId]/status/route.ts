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
  const workspace = await service.getHelperWorkspace(
    database.getDatabasePool(),
    user.id,
    new Date(),
    {
      sections: [],
      loadTrips: true,
      tripIds: [tripId],
    },
  );
  const trip = Object.values(workspace.groups)
    .flat()
    .find((candidate: any) => candidate.id === tripId) as any;

  if (!trip) {
    return NextResponse.json({ error: "找不到這個行程。" }, { status: 404 });
  }

  return NextResponse.json(
    {
      trip: {
        id: trip.id,
        status: trip.status,
        version: trip.version,
        updatedAt: trip.updated_at,
        departedAt: trip.departed_at,
        connectionPausedAt: trip.connection_paused_at,
        connectionPausedSeconds: trip.connection_paused_seconds,
      },
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
