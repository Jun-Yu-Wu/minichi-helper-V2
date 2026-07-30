import { NextResponse } from "next/server";

import { getCurrentAdmin } from "../../../../src/server/current-session";
import database from "../../../../src/server/database";
import service from "../../../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../../../src/server/r2-object-store";

export async function GET(request: Request) {
  try {
    await getCurrentAdmin();
  } catch {
    return NextResponse.json({ error: "請先登入管理員帳號。" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tripId = String(searchParams.get("tripId") || "").trim();
  const query = String(searchParams.get("q") || "").trim();
  if (!tripId) {
    return NextResponse.json({ error: "缺少行程資訊。" }, { status: 400 });
  }

  try {
    const suggestions = await (service.listPurchaseProductSuggestions as any)(
      database.getDatabasePool(),
      { limit: 8, query, tripId },
    );
    const signedSuggestions = await service.attachSignedPurchaseTaskUrls(
      suggestions,
      createR2ObjectStore(),
    );
    return NextResponse.json(
      { suggestions: signedSuggestions },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "無法載入商品推薦。" },
      { status: 400 },
    );
  }
}
