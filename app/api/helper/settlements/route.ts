import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../src/server/current-session";
import database from "../../../../src/server/database";
import service from "../../../../src/server/helper-app-service";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  }

  const settlementId = new URL(request.url).searchParams.get("settlementId");
  const workspace = await service.getHelperWorkspace(
    database.getDatabasePool(),
    user.id,
    new Date(),
    {
      sections: ["settlements"],
      settlementIds: settlementId ? [settlementId] : null,
      settlementIncludeDetails: false,
    },
  );

  return NextResponse.json(
    {
      settlements: (workspace.settlements || []).map((settlement: any) => ({
        id: settlement.id,
        status: settlement.status,
        totalPayableTwd: settlement.total_payable_twd,
        updatedAt: settlement.updated_at,
      })),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
