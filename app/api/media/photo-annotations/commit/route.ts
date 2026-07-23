import { NextResponse } from "next/server";

import adminAuthorization from "../../../../../src/server/admin-authorization";
import database from "../../../../../src/server/database";
import { getCurrentUser } from "../../../../../src/server/current-session";
import { createR2ObjectStore } from "../../../../../src/server/r2-object-store";
import service from "../../../../../src/server/helper-app-service";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "請先登入。" }, { status: 401 });

    const body = await request.json();
    const sourceStorageKey = String(body.sourceStorageKey || "").trim();
    const storageKey = String(body.storageKey || "").trim();
    const contentType = String(body.contentType || "").trim().toLowerCase();
    const originalFilename = String(body.originalFilename || "").trim();
    const idempotencyKey = String(body.idempotencyKey || "").trim();
    const byteSize = body.byteSize == null || body.byteSize === "" ? null : Number(body.byteSize);
    const annotationManifest = body.annotationManifest && typeof body.annotationManifest === "object"
      ? body.annotationManifest
      : {};
    if (!sourceStorageKey || !storageKey || !contentType || !idempotencyKey) {
      return NextResponse.json({ error: "缺少編輯照片保存資訊。" }, { status: 400 });
    }
    if (JSON.stringify(annotationManifest).length > 200_000) {
      return NextResponse.json({ error: "標註資料過大。" }, { status: 413 });
    }

    const actorRole = isAdmin(user) ? "admin" : "helper";
    const variant = await service.createPhotoAnnotation(database.getDatabasePool(), {
      actorRole,
      annotationManifest,
      authUserId: user.id,
      byteSize,
      contentType,
      idempotencyKey,
      originalFilename,
      sourceStorageKey,
      storageKey,
    });
    const signedUrl = await createR2ObjectStore().signedGetUrl(variant.storage_key);
    return NextResponse.json({
      media: {
        ...variant,
        annotation_manifest: parseJson(variant.annotation_manifest),
        signed_url: signedUrl,
      },
    });
  } catch (error) {
    console.error("Photo annotation commit failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "編輯照片保存失敗。" },
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

function parseJson(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value || {};
}
