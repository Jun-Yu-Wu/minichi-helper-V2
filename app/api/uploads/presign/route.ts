import crypto from "node:crypto";

import { NextResponse } from "next/server";

import adminAuthorization from "../../../../src/server/admin-authorization";
import config from "../../../../src/server/config";
import database from "../../../../src/server/database";
import { getCurrentUser } from "../../../../src/server/current-session";
import { createR2ObjectStore } from "../../../../src/server/r2-object-store";
import service from "../../../../src/server/helper-app-service";

export async function POST(request: Request) {
  const startedAt = performance.now();
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "請先登入。" }, { status: 401 });
    }
    const authenticatedAt = performance.now();

    const body = await request.json();
    const tripId = String(body.tripId || "").trim();
    const purchaseTaskId = String(body.purchaseTaskId || "").trim();
    const rebuyTaskId = String(body.rebuyTaskId || "").trim();
    const settlementId = String(body.settlementId || "").trim();
    const evidenceType = String(body.evidenceType || "").trim();
    const quoteTaskPhotoId = String(body.quoteTaskPhotoId || "").trim();
    const uploadPurpose = String(body.uploadPurpose || "site_photo").trim();
    const contentType = String(body.contentType || "").trim().toLowerCase();
    const fileName = String(body.fileName || "").trim();
    const clientPhotoId = String(body.clientPhotoId || "").trim();
    const byteSize = body.byteSize == null || body.byteSize === ""
      ? null
      : Number(body.byteSize);
    if (!contentType || !clientPhotoId) {
      return NextResponse.json({ error: "缺少上傳資訊。" }, { status: 400 });
    }
    const uploadConfig = config.uploadConfig();
    if (!uploadConfig.allowedContentTypes.has(contentType.toLowerCase())) {
      return NextResponse.json({ error: "目前只支援圖片上傳。" }, { status: 400 });
    }
    if (byteSize != null && (!Number.isInteger(byteSize) || byteSize < 0)) {
      return NextResponse.json({ error: "圖片大小格式不正確。" }, { status: 400 });
    }
    if (byteSize != null && byteSize > uploadConfig.maxBytes) {
      return NextResponse.json({ error: "圖片超過大小限制。" }, { status: 413 });
    }

    let storageKeyTripId = tripId;
    if (uploadPurpose === "admin_quote_task_photo" || uploadPurpose === "admin_purchase_task_photo") {
      adminAuthorization.authorizeAdminUserByAllowlist(user);
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
        authUserId: user.id,
        quoteTaskPhotoId,
      });
      storageKeyTripId = authorization.trip_id;
    } else if (uploadPurpose === "purchase_face_check") {
      if (!purchaseTaskId) {
        return NextResponse.json({ error: "缺少採買任務資訊。" }, { status: 400 });
      }
      const authorization = await service.authorizePurchaseFaceCheckUpload(database.getDatabasePool(), {
        authUserId: user.id,
        purchaseTaskId,
      });
      storageKeyTripId = authorization.trip_id;
    } else if (uploadPurpose === "purchase_report") {
      if (!purchaseTaskId) {
        return NextResponse.json({ error: "缺少採買任務資訊。" }, { status: 400 });
      }
      const authorization = await service.authorizePurchaseReportUpload(database.getDatabasePool(), {
        authUserId: user.id,
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
          authUserId: user.id,
          evidenceType,
          settlementId,
        },
      );
      storageKeyTripId = authorization.trip_id;
    } else if (uploadPurpose === "admin_rebuy_reference") {
      adminAuthorization.authorizeAdminUserByAllowlist(user);
      storageKeyTripId = "rebuy";
    } else if (uploadPurpose === "rebuy_report") {
      if (!rebuyTaskId) {
        return NextResponse.json({ error: "缺少補買任務資訊。" }, { status: 400 });
      }
      await service.authorizeRebuyReportUpload(database.getDatabasePool(), {
        authUserId: user.id,
        rebuyTaskId,
      });
      storageKeyTripId = "rebuy";
    } else {
      if (!tripId) {
        return NextResponse.json({ error: "缺少行程資訊。" }, { status: 400 });
      }
      await service.authorizeSitePhotoUpload(database.getDatabasePool(), {
        authUserId: user.id,
        tripId,
      });
    }
    const authorizedAt = performance.now();

    const r2Store = createR2ObjectStore();
    // The browser-provided id remains application metadata. Never use it as
    // the durable object name: object names must be server-generated so a
    // client cannot choose a predictable path or overwrite another upload.
    const objectId = crypto.randomUUID();
    const storageKey = uploadPurpose === "admin_quote_task_photo" || uploadPurpose === "admin_purchase_task_photo"
      ? buildAdminTaskPhotoKey({
          clientPhotoId: objectId,
          contentType,
          fileName,
          tripId: storageKeyTripId,
        })
      : uploadPurpose === "quote_detail_reply"
        ? buildQuoteReplyPhotoKey({
            clientPhotoId: objectId,
            contentType,
            fileName,
            quoteTaskPhotoId,
            tripId: storageKeyTripId,
          })
          : uploadPurpose === "purchase_face_check"
          ? buildPurchaseFaceCheckPhotoKey({
              clientPhotoId: objectId,
              contentType,
              fileName,
              purchaseTaskId,
              tripId: storageKeyTripId,
              })
          : uploadPurpose === "purchase_report"
            ? buildPurchaseReportPhotoKey({
                clientPhotoId: objectId,
                contentType,
                fileName,
                purchaseTaskId,
                tripId: storageKeyTripId,
              })
          : uploadPurpose === "settlement_evidence"
            ? buildSettlementEvidenceKey({
                clientPhotoId: objectId,
                contentType,
                evidenceType,
                fileName,
                settlementId,
                tripId: storageKeyTripId,
              })
            : uploadPurpose === "admin_rebuy_reference"
              ? buildAdminRebuyReferencePhotoKey({
                  clientPhotoId: objectId,
                  contentType,
                  fileName,
                })
              : uploadPurpose === "rebuy_report"
              ? buildRebuyReportPhotoKey({
                  clientPhotoId: objectId,
                  contentType,
                  fileName,
                  rebuyTaskId,
                })
        : r2Store.buildSitePhotoKey({
            contentType,
            fileName,
            photoId: objectId,
            tripId,
          });
    const uploadUrl = await r2Store.signedPutUrl(storageKey, contentType);
    const expiresAt = new Date(Date.now() + r2Store.ttlSeconds * 1000).toISOString();
    const completedAt = performance.now();

    return NextResponse.json({
      expiresAt,
      storageKey,
      uploadUrl,
    }, {
      headers: {
        "Server-Timing": [
          `auth;dur=${(authenticatedAt - startedAt).toFixed(1)}`,
          `authorize;dur=${(authorizedAt - authenticatedAt).toFixed(1)}`,
          `sign;dur=${(completedAt - authorizedAt).toFixed(1)}`,
          `total;dur=${(completedAt - startedAt).toFixed(1)}`,
        ].join(", "),
      },
    });
  } catch (error) {
    console.error("Presign upload failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "無法建立上傳網址。" },
      { status: 400 },
    );
  }
}

function buildAdminRebuyReferencePhotoKey({
  clientPhotoId,
  contentType,
  fileName,
}: {
  clientPhotoId: string;
  contentType: string;
  fileName: string;
}) {
  const extension = extensionFromContentType(contentType);
  return [
    "helper-app",
    "rebuy",
    "admin-reference",
    `${clientPhotoId}${extension}`,
  ].join("/");
}

function buildRebuyReportPhotoKey({
  clientPhotoId,
  contentType,
  fileName,
  rebuyTaskId,
}: {
  clientPhotoId: string;
  contentType: string;
  fileName: string;
  rebuyTaskId: string;
}) {
  const extension = extensionFromContentType(contentType);
  return [
    "helper-app",
    "rebuy",
    rebuyTaskId,
    "reports",
    `${clientPhotoId}${extension}`,
  ].join("/");
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
  const extension = extensionFromContentType(contentType);
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
  const extension = extensionFromContentType(contentType);
  return [
    "helper-app",
    tripId,
    "purchase-face-check",
    purchaseTaskId,
    `${clientPhotoId}${extension}`,
  ].join("/");
}

function buildPurchaseReportPhotoKey({
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
  const extension = extensionFromContentType(contentType);
  return [
    "helper-app",
    tripId,
    "purchase-reports",
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
  const extension = extensionFromContentType(contentType);
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
  const extension = extensionFromContentType(contentType);
  return [
    "helper-app",
    tripId,
    "quote-detail-replies",
    quoteTaskPhotoId,
    `${clientPhotoId}${extension}`,
  ].join("/");
}

function extensionFromContentType(contentType: string) {
  if (contentType === "image/avif") return ".avif";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "image/heic") return ".heic";
  if (contentType === "image/heif") return ".heif";
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  return ".jpg";
}
