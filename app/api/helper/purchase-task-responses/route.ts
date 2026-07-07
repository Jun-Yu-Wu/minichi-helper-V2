import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../src/server/current-session";
import database from "../../../../src/server/database";
import service from "../../../../src/server/helper-app-service";

function durationSince(startedAt: number) {
  return Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10);
}

function timingHeader(timing: Record<string, number>) {
  return Object.entries(timing)
    .map(([name, duration]) => `${name};dur=${duration}`)
    .join(", ");
}

function errorStatus(error: unknown) {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: string }).code || "")
    : "";
  if (code === "helper_inactive" || code === "helper_not_found") return 401;
  if (code === "forbidden") return 403;
  if (code === "purchase_task_not_found") return 404;
  if (code === "invalid_input" || code === "invalid_status" || code === "trip_not_active") return 400;
  return 500;
}

export async function POST(request: Request) {
  const totalStartedAt = performance.now();
  const authStartedAt = performance.now();
  const user = await getCurrentUser();
  const authMs = durationSince(authStartedAt);
  if (!user) {
    return NextResponse.json(
      { error: "請先登入。" },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Server-Timing": timingHeader({
            auth: authMs,
            total: durationSince(totalStartedAt),
          }),
        },
        status: 401,
      },
    );
  }

  const body = await request.json();
  const dbStartedAt = performance.now();
  try {
    const task = await service.respondPurchaseTask(database.getDatabasePool(), {
      action: body.purchaseAction || "complete",
      authUserId: user.id,
      completedQuantity: body.completedQuantity,
      faceCheckNote: body.faceCheckNote,
      faceCheckPhoto: body.faceCheckPhoto || null,
      helperNote: body.helperNote,
      idempotencyKey: body.idempotencyKey,
      purchaseTaskId: body.purchaseTaskId,
      remainingResolution: body.remainingResolution,
      unavailableQuantity: body.unavailableQuantity,
    });
    const dbMs = durationSince(dbStartedAt);
    return NextResponse.json(
      { ok: true, submissionId: body.idempotencyKey, task },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Server-Timing": timingHeader({
            auth: authMs,
            db: dbMs,
            total: durationSince(totalStartedAt),
          }),
        },
      },
    );
  } catch (error) {
    console.error("Helper purchase response route failed", error);
    const dbMs = durationSince(dbStartedAt);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失敗，請稍後再試。" },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Server-Timing": timingHeader({
            auth: authMs,
            db: dbMs,
            total: durationSince(totalStartedAt),
          }),
        },
        status: errorStatus(error),
      },
    );
  }
}
