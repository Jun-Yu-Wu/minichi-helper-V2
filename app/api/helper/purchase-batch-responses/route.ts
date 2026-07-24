import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../src/server/current-session";
import database from "../../../../src/server/database";
import service from "../../../../src/server/helper-app-service";

function errorStatus(error: unknown) {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: string }).code || "")
    : "";
  if (code === "helper_inactive" || code === "helper_not_found") return 401;
  if (code === "forbidden") return 403;
  if (code === "purchase_batch_not_found") return 404;
  if (code === "invalid_input" || code === "invalid_status" || code === "trip_not_active") return 400;
  return 500;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "請先登入。" }, { status: 401 });
  try {
    const body = await request.json();
    const task = await service.respondPurchaseBatch(database.getDatabasePool(), {
      action: body.purchaseAction || "complete",
      authUserId: user.id,
      completedQuantity: body.completedQuantity,
      helperNote: body.helperNote,
      idempotencyKey: body.idempotencyKey,
      purchaseBatchId: body.purchaseBatchId,
      purchaseTaskId: body.purchaseTaskId,
      reportPhotos: body.reportPhotos || [],
    });
    return NextResponse.json({ ok: true, submissionId: body.idempotencyKey, task });
  } catch (error) {
    console.error("Helper purchase batch response route failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失敗，請稍後再試。" },
      { status: errorStatus(error) },
    );
  }
}
