import { NextResponse } from "next/server";

import adminAuthorization from "../../../../../src/server/admin-authorization";
import config from "../../../../../src/server/config";
import database from "../../../../../src/server/database";
import { getCurrentUser } from "../../../../../src/server/current-session";
import { createR2ObjectStore } from "../../../../../src/server/r2-object-store";
import service from "../../../../../src/server/helper-app-service";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "請先登入。" }, { status: 401 });

    const storageKey = new URL(request.url).searchParams.get("storageKey")?.trim() || "";
    if (!storageKey || storageKey.length > 500 || storageKey.includes("..")) {
      return NextResponse.json({ error: "照片來源不正確。" }, { status: 400 });
    }

    const actorRole = isAdmin(user) ? "admin" : "helper";
    await service.authorizePhotoAnnotationSource(database.getDatabasePool(), {
      actorRole,
      authUserId: user.id,
      sourceStorageKey: storageKey,
    });

    const object = await createR2ObjectStore().getObject(storageKey);
    if (!config.uploadConfig().allowedContentTypes.has(object.contentType.toLowerCase())) {
      return NextResponse.json({ error: "來源不是支援的照片格式。" }, { status: 415 });
    }
    return new Response(object.body, {
      headers: {
        "cache-control": "private, no-store",
        "content-length": String(object.contentLength),
        "content-type": object.contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Photo annotation source load failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "原照片載入失敗。" },
      { status: 400 },
    );
  }
}

function isAdmin(user: { email?: string | null }) {
  try {
    adminAuthorization.authorizeAdminUserByAllowlist(user);
    return true;
  } catch {
    return false;
  }
}
