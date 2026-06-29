import { NextResponse } from "next/server";

import adminAuthorization from "../../../../src/server/admin-authorization";
import database from "../../../../src/server/database";
import { createR2ObjectStore } from "../../../../src/server/r2-object-store";
import service from "../../../../src/server/helper-app-service";
import { createServerSupabaseClient } from "../../../../src/server/supabase";

export async function POST(request: Request) {
  try {
    const authClient = await createServerSupabaseClient();
    const { data, error } = await authClient.auth.getUser();
    if (error || !data?.user) {
      return NextResponse.json({ error: "請先登入。" }, { status: 401 });
    }

    const body = await request.json();
    const tripId = String(body.tripId || "").trim();
    const purchaseTaskId = String(body.purchaseTaskId || "").trim();
    const settlementId = String(body.settlementId || "").trim();
    const evidenceType = String(body.evidenceType || "").trim();
    const quoteTaskPhotoId = String(body.quoteTaskPhotoId || "").trim();
    const uploadPurpose = String(body.uploadPurpose || "site_photo").trim();
    const contentType = String(body.contentType || "").trim();
    const fileName = String(body.fileName || "").trim();
    const clientPhotoId = String(body.clientPhotoId || "").trim();
    if (!contentType || !clientPhotoId) {
      return NextResponse.json({ error: "缺少上傳資訊。" }, { status: 400 });
    }
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "目前只支援圖片上傳。" }, { status: 400 });
    }

    let storageKeyTripId = tripId;
    if (uploadPurpose === "admin_quote_task_photo") {
      await adminAuthorization.authorizeAdminByAllowlist(authClient);
      if (!tripId) {
        return NextResponse.json({ error: "缺少行程資訊。" }, { status: 400 });
      }
      await service.authorizeAdminTaskPhotoUpload(database.getDatabasePool(), {
        tripId,
      });
    } else if (uploadPurpose === "quote_detail_reply") {
      if (!quoteTaskPhotoId) {
        return NextResponse.json({ error: "缺少任務照片資訊。" }, { status: 400 });
      }
      const authorization = await service.authorizeQuoteReplyUpload(database.getDatabasePool(), {
        authUserId: data.user.id,
        quoteTaskPhotoId,
      });
      storageKeyTripId = authorization.trip_id;
    } else if (uploadPurpose === "purchase_face_check") {
      if (!purchaseTaskId) {
        return NextResponse.json({ error: "缺少採買任務資訊。" }, { status: 400 });
      }
      const authorization = await service.authorizePurchaseFaceCheckUpload(database.getDatabasePool(), {
        authUserId: data.user.id,
        purchaseTaskId,
      });
      storageKeyTripId = authorization.trip_id;
    } else if (uploadPurpose === "settlement_evidence") {
      if (!settlementId || !evidenceType) {
        return NextResponse.json({ error: "缺少結帳證明資訊。" }, { status: 400 });
      }
      const authorization = await service.authorizeSettlementEvidenceUpload(
        database.getDatabasePool(),
        {
          authUserId: data.user.id,
          evidenceType,
          settlementId,
        },
      );
      storageKeyTripId = authorization.trip_id;
    } else {
      if (!tripId) {
        return NextResponse.json({ error: "缺少行程資訊。" }, { status: 400 });
      }
      await service.authorizeSitePhotoUpload(database.getDatabasePool(), {
        authUserId: data.user.id,
        tripId,
      });
    }

    const r2Store = createR2ObjectStore();
    const storageKey = uploadPurpose === "admin_quote_task_photo"
      ? buildAdminTaskPhotoKey({
          clientPhotoId,
          contentType,
          fileName,
          tripId: storageKeyTripId,
        })
      : uploadPurpose === "quote_detail_reply"
        ? buildQuoteReplyPhotoKey({
            clientPhotoId,
            contentType,
            fileName,
            quoteTaskPhotoId,
            tripId: storageKeyTripId,
          })
        : uploadPurpose === "purchase_face_check"
          ? buildPurchaseFaceCheckPhotoKey({
              clientPhotoId,
              contentType,
              fileName,
              purchaseTaskId,
              tripId: storageKeyTripId,
            })
          : uploadPurpose === "settlement_evidence"
            ? buildSettlementEvidenceKey({
                clientPhotoId,
                contentType,
                evidenceType,
                fileName,
                settlementId,
                tripId: storageKeyTripId,
              })
        : r2Store.buildSitePhotoKey({
            contentType,
            fileName,
            photoId: clientPhotoId,
            tripId,
          });
    const uploadUrl = await r2Store.signedPutUrl(storageKey, contentType);
    const expiresAt = new Date(Date.now() + r2Store.ttlSeconds * 1000).toISOString();

    return NextResponse.json({
      expiresAt,
      storageKey,
      uploadUrl,
    });
  } catch (error) {
    console.error("Presign upload failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "無法建立上傳網址。" },
      { status: 400 },
    );
  }
}

function buildSettlementEvidenceKey({
  clientPhotoId,
  contentType,
  evidenceType,
  fileName,
  settlementId,
  tripId,
}: {
  clientPhotoId: string;
  contentType: string;
  evidenceType: string;
  fileName: string;
  settlementId: string;
  tripId: string;
}) {
  const extension = extensionFromFile(fileName) || extensionFromContentType(contentType);
  return [
    "helper-app",
    tripId,
    "settlements",
    settlementId,
    evidenceType,
    `${clientPhotoId}${extension}`,
  ].join("/");
}

function buildPurchaseFaceCheckPhotoKey({
  clientPhotoId,
  contentType,
  fileName,
  purchaseTaskId,
  tripId,
}: {
  clientPhotoId: string;
  contentType: string;
  fileName: string;
  purchaseTaskId: string;
  tripId: string;
}) {
  const extension = extensionFromFile(fileName) || extensionFromContentType(contentType);
  return [
    "helper-app",
    tripId,
    "purchase-face-check",
    purchaseTaskId,
    `${clientPhotoId}${extension}`,
  ].join("/");
}

function buildAdminTaskPhotoKey({
  clientPhotoId,
  contentType,
  fileName,
  tripId,
}: {
  clientPhotoId: string;
  contentType: string;
  fileName: string;
  tripId: string;
}) {
  const extension = extensionFromFile(fileName) || extensionFromContentType(contentType);
  return [
    "helper-app",
    tripId,
    "admin-task-photos",
    `${clientPhotoId}${extension}`,
  ].join("/");
}

function buildQuoteReplyPhotoKey({
  clientPhotoId,
  contentType,
  fileName,
  quoteTaskPhotoId,
  tripId,
}: {
  clientPhotoId: string;
  contentType: string;
  fileName: string;
  quoteTaskPhotoId: string;
  tripId: string;
}) {
  const extension = extensionFromFile(fileName) || extensionFromContentType(contentType);
  return [
    "helper-app",
    tripId,
    "quote-detail-replies",
    quoteTaskPhotoId,
    `${clientPhotoId}${extension}`,
  ].join("/");
}

function extensionFromFile(fileName: string) {
  const match = fileName.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : "";
}

function extensionFromContentType(contentType: string) {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  return ".jpg";
}
