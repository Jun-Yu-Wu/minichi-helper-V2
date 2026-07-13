import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../../src/server/current-session";
import database from "../../../../../src/server/database";
import service from "../../../../../src/server/helper-app-service";
import { createR2ObjectStore } from "../../../../../src/server/r2-object-store";

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
  if (code === "rebuy_task_not_found") return 404;
  if (["claim_conflict", "release_conflict", "version_conflict"].includes(code)) return 409;
  if (["invalid_input", "invalid_status"].includes(code)) return 400;
  return 500;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
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

  const { taskId } = await params;
  const dbStartedAt = performance.now();
  try {
    const tasks = await service.listAuthorizedHelperRebuyTasks(
      database.getDatabasePool(),
      {
        authUserId: user.id,
        includePhotos: true,
        rebuyTaskIds: [taskId],
      },
    );
    const dbMs = durationSince(dbStartedAt);
    if (!tasks[0]) {
      return NextResponse.json(
        { error: "找不到這筆補買任務。" },
        {
          headers: {
            "Cache-Control": "private, no-store",
            "Server-Timing": timingHeader({ auth: authMs, db: dbMs, total: durationSince(totalStartedAt) }),
          },
          status: 404,
        },
      );
    }

    const signStartedAt = performance.now();
    const [task] = await service.attachSignedRebuyTaskUrls(
      tasks,
      createR2ObjectStore(),
    );
    const signMs = durationSince(signStartedAt);
    return NextResponse.json(
      { task },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Server-Timing": timingHeader({
            auth: authMs,
            db: dbMs,
            sign: signMs,
            total: durationSince(totalStartedAt),
          }),
        },
      },
    );
  } catch (error) {
    console.error("Helper rebuy detail route failed", error);
    const dbMs = durationSince(dbStartedAt);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "補買任務載入失敗。" },
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
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

  const { taskId } = await params;
  const body = await request.json();
  const dbStartedAt = performance.now();
  try {
    let task;
    if (body.action === "claim") {
      task = await service.claimPublicRebuyTask(database.getDatabasePool(), {
        authUserId: user.id,
        expectedVersion: body.expectedVersion,
        idempotencyKey: body.idempotencyKey,
        rebuyTaskId: taskId,
      });
    } else if (body.action === "release") {
      task = await service.releasePublicRebuyTask(database.getDatabasePool(), {
        authUserId: user.id,
        expectedVersion: body.expectedVersion,
        idempotencyKey: body.idempotencyKey,
        reason: body.reason,
        rebuyTaskId: taskId,
      });
    } else if (body.action === "report") {
      task = await service.reportRebuyTask(database.getDatabasePool(), {
        authUserId: user.id,
        helperNote: body.helperNote,
        idempotencyKey: body.idempotencyKey,
        rebuyTaskId: taskId,
        remainingReason: body.remainingReason,
        reportPhotos: body.reportPhotos || [],
        reportPhotosOmitted: Boolean(body.reportPhotosOmitted),
        reportedQuantity: body.reportedQuantity,
      });
    } else {
      return NextResponse.json({ error: "未知的補買操作。" }, { status: 400 });
    }
    const dbMs = durationSince(dbStartedAt);
    return NextResponse.json(
      { ok: true, submissionId: body.idempotencyKey, task },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Server-Timing": timingHeader({ auth: authMs, db: dbMs, total: durationSince(totalStartedAt) }),
        },
      },
    );
  } catch (error) {
    console.error("Helper rebuy action route failed", error);
    const dbMs = durationSince(dbStartedAt);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "補買操作失敗，請稍後再試。" },
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
