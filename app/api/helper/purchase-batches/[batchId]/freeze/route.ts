import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../../src/server/current-session";
import database from "../../../../../../src/server/database";
import service from "../../../../../../src/server/helper-app-service";

function errorStatus(error: unknown) {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: string }).code || "")
    : "";
  if (code === "helper_inactive" || code === "helper_not_found") return 401;
  if (code === "forbidden") return 403;
  if (code === "purchase_batch_not_found") return 404;
  if (["invalid_input", "invalid_status", "trip_not_active"].includes(code)) return 400;
  return 500;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  try {
    const { batchId } = await params;
    const batch = await service.freezePurchaseBatch(database.getDatabasePool(), {
      authUserId: user.id,
      purchaseBatchId: batchId,
    });
    return NextResponse.json(
      { ok: true, batch },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "無法凍結扭蛋批次。" },
      { status: errorStatus(error) },
    );
  }
}
