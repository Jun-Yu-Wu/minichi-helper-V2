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
  if (code === "photo_not_found") return 404;
  if (code === "already_converted" || code === "invalid_input" || code === "trip_not_active") {
    return 400;
  }
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
    await service.submitQuotePhotoReply(database.getDatabasePool(), {
      authUserId: user.id,
      detailPhotos: Array.isArray(body.detailPhotos) ? body.detailPhotos : [],
      idempotencyKey: body.idempotencyKey,
      note: body.note,
      priceJpy: body.priceJpy,
      quoteTaskPhotoId: body.quoteTaskPhotoId,
    });
    const dbMs = durationSince(dbStartedAt);
    return NextResponse.json(
      { ok: true, submissionId: body.idempotencyKey },
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
    console.error("Helper quote reply route failed", error);
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
