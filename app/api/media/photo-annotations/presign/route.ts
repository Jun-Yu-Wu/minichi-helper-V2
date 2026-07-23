import crypto from "node:crypto";

import { NextResponse } from "next/server";

import adminAuthorization from "../../../../../src/server/admin-authorization";
import config from "../../../../../src/server/config";
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
    const contentType = String(body.contentType || "").trim().toLowerCase();
    const fileName = String(body.fileName || "").trim();
    const clientPhotoId = String(body.clientPhotoId || crypto.randomUUID()).trim();
    const byteSize = body.byteSize == null || body.byteSize === "" ? null : Number(body.byteSize);
    const uploadConfig = config.uploadConfig();

    if (!sourceStorageKey || !contentType || !clientPhotoId) {
      return NextResponse.json({ error: "缺少照片編輯上傳資訊。" }, { status: 400 });
    }
    if (!uploadConfig.allowedContentTypes.has(contentType)) {
      return NextResponse.json({ error: "目前只支援圖片格式。" }, { status: 400 });
    }
    if (byteSize != null && (!Number.isInteger(byteSize) || byteSize < 0)) {
      return NextResponse.json({ error: "圖片大小格式不正確。" }, { status: 400 });
    }
    if (byteSize != null && byteSize > uploadConfig.maxBytes) {
      return NextResponse.json({ error: "編輯後圖片超過大小限制。" }, { status: 413 });
    }

    const actorRole = isAdmin(user) ? "admin" : "helper";
    await service.authorizePhotoAnnotationSource(database.getDatabasePool(), {
      actorRole,
      authUserId: user.id,
      sourceStorageKey,
    });

    const r2Store = createR2ObjectStore();
    const storageKey = r2Store.buildPhotoAnnotationKey({
      contentType,
      fileName,
      variantId: clientPhotoId,
    });
    const uploadUrl = await r2Store.signedPutUrl(storageKey, contentType);
    return NextResponse.json({
      actorRole,
      clientPhotoId,
      expiresAt: new Date(Date.now() + r2Store.ttlSeconds * 1000).toISOString(),
      storageKey,
      uploadUrl,
    });
  } catch (error) {
    console.error("Photo annotation presign failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "無法建立編輯照片上傳網址。" },
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
