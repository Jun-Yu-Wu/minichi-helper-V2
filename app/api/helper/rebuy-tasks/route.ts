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
  if (code === "nothing_to_checkout") return 400;
  return 500;
}

export async function GET() {
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
          "Server-Timing": timingHeader({ auth: authMs, total: durationSince(totalStartedAt) }),
        },
        status: 401,
      },
    );
  }

  const dbStartedAt = performance.now();
  try {
    const tasks = await service.listAuthorizedHelperRebuyTasks(
      database.getDatabasePool(),
      {
        authUserId: user.id,
        includePhotos: false,
      },
    );
    const dbMs = durationSince(dbStartedAt);
    return NextResponse.json(
      { tasks },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Server-Timing": timingHeader({ auth: authMs, db: dbMs, total: durationSince(totalStartedAt) }),
        },
      },
    );
  } catch (error) {
    console.error("Helper rebuy list route failed", error);
    const dbMs = durationSince(dbStartedAt);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "補買列表載入失敗。" },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Server-Timing": timingHeader({ auth: authMs, db: dbMs, total: durationSince(totalStartedAt) }),
        },
        status: errorStatus(error),
      },
    );
  }
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
          "Server-Timing": timingHeader({ auth: authMs, total: durationSince(totalStartedAt) }),
        },
        status: 401,
      },
    );
  }

  const body = await request.json();
  const dbStartedAt = performance.now();
  try {
    if (body.action !== "checkout") {
      return NextResponse.json({ error: "未知的補買操作。" }, { status: 400 });
    }
    const result = await service.checkoutRebuyTasks(database.getDatabasePool(), {
      authUserId: user.id,
      idempotencyKey: body.idempotencyKey,
    });
    const dbMs = durationSince(dbStartedAt);
    return NextResponse.json(
      { ok: true, result },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Server-Timing": timingHeader({ auth: authMs, db: dbMs, total: durationSince(totalStartedAt) }),
        },
      },
    );
  } catch (error) {
    console.error("Helper rebuy checkout route failed", error);
    const dbMs = durationSince(dbStartedAt);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "補買結帳失敗。" },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Server-Timing": timingHeader({ auth: authMs, db: dbMs, total: durationSince(totalStartedAt) }),
        },
        status: errorStatus(error),
      },
    );
  }
}
