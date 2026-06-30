"use server";

import { revalidatePath } from "next/cache";

import database from "../../src/server/database";
import service from "../../src/server/helper-app-service";
import { createServerSupabaseClient } from "../../src/server/supabase";

export type HelperActionResult = {
  error?: string;
  ok?: true;
  submissionId?: string;
};

async function requireUserId() {
  const auth = await createServerSupabaseClient();
  const { data, error } = await auth.auth.getUser();
  if (error || !data?.user) throw new Error("請先登入。");
  return data.user.id;
}

function formText(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}

function formVersion(formData: FormData) {
  return Number(formData.get("expectedVersion"));
}

function actionError(error: unknown): HelperActionResult {
  console.error("Helper action failed", error);
  return { error: error instanceof Error ? error.message : "操作失敗，請稍後再試。" };
}

export async function departTripAction(formData: FormData) {
  const authUserId = await requireUserId();
  await service.markHelperDeparted(database.getDatabasePool(), {
    authUserId,
    expectedVersion: formVersion(formData),
    tripId: formText(formData, "tripId"),
  });
  revalidatePath("/helper");
}

export async function arriveTripAction(formData: FormData) {
  const authUserId = await requireUserId();
  await service.markHelperArrived(database.getDatabasePool(), {
    authUserId,
    expectedVersion: formVersion(formData),
    tripId: formText(formData, "tripId"),
  });
  revalidatePath("/helper");
}

export async function endTripAction(
  _previousState: HelperActionResult,
  formData: FormData,
): Promise<HelperActionResult> {
  try {
    const authUserId = await requireUserId();
    await service.markHelperEnded(database.getDatabasePool(), {
      authUserId,
      expectedVersion: formVersion(formData),
      tripId: formText(formData, "tripId"),
    });
    revalidatePath("/helper");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function submitSitePhotoBatchAction(
  _previousState: HelperActionResult,
  formData: FormData,
): Promise<HelperActionResult> {
  try {
    const authUserId = await requireUserId();
    const photosJson = formText(formData, "photosJson");
    const photos = photosJson ? JSON.parse(photosJson) : [];
    await service.submitSitePhotoBatch(database.getDatabasePool(), {
      authUserId,
      note: formText(formData, "note"),
      photos,
      submissionId: formText(formData, "submissionId"),
      tripId: formText(formData, "tripId"),
    });
    revalidatePath("/helper");
    return { ok: true, submissionId: formText(formData, "submissionId") };
  } catch (error) {
    return actionError(error);
  }
}

export async function submitQuotePhotoReplyAction(
  _previousState: HelperActionResult,
  formData: FormData,
): Promise<HelperActionResult> {
  try {
    const authUserId = await requireUserId();
    const detailPhotosJson = formText(formData, "detailPhotosJson");
    const detailPhotos = detailPhotosJson ? JSON.parse(detailPhotosJson) : [];
    await service.submitQuotePhotoReply(database.getDatabasePool(), {
      authUserId,
      detailPhotos,
      idempotencyKey: formText(formData, "idempotencyKey"),
      note: formText(formData, "note"),
      priceJpy: formText(formData, "priceJpy"),
      quoteTaskPhotoId: formText(formData, "quoteTaskPhotoId"),
    });
    revalidatePath("/helper");
    return { ok: true, submissionId: formText(formData, "idempotencyKey") };
  } catch (error) {
    return actionError(error);
  }
}

export async function respondPurchaseTaskAction(
  _previousState: HelperActionResult,
  formData: FormData,
): Promise<HelperActionResult> {
  try {
    const authUserId = await requireUserId();
    const faceCheckPhotoJson = formText(formData, "faceCheckPhotoJson");
    await service.respondPurchaseTask(database.getDatabasePool(), {
      action: formText(formData, "purchaseAction") || "complete",
      authUserId,
      completedQuantity: formText(formData, "completedQuantity"),
      faceCheckNote: formText(formData, "faceCheckNote"),
      faceCheckPhoto: faceCheckPhotoJson ? JSON.parse(faceCheckPhotoJson) : null,
      helperNote: formText(formData, "helperNote"),
      idempotencyKey: formText(formData, "idempotencyKey"),
      purchaseTaskId: formText(formData, "purchaseTaskId"),
      unavailableQuantity: formText(formData, "unavailableQuantity"),
    });
    revalidatePath("/helper");
    return { ok: true, submissionId: formText(formData, "idempotencyKey") };
  } catch (error) {
    return actionError(error);
  }
}

export async function claimRebuyTaskAction(formData: FormData) {
  const authUserId = await requireUserId();
  await service.claimPublicRebuyTask(database.getDatabasePool(), {
    authUserId,
    expectedVersion: formText(formData, "expectedVersion"),
    idempotencyKey: formText(formData, "idempotencyKey"),
    rebuyTaskId: formText(formData, "rebuyTaskId"),
  });
  revalidatePath("/helper");
}

export async function releaseRebuyTaskAction(formData: FormData) {
  const authUserId = await requireUserId();
  await service.releasePublicRebuyTask(database.getDatabasePool(), {
    authUserId,
    expectedVersion: formText(formData, "expectedVersion"),
    idempotencyKey: formText(formData, "idempotencyKey"),
    reason: formText(formData, "reason"),
    rebuyTaskId: formText(formData, "rebuyTaskId"),
  });
  revalidatePath("/helper");
}

export async function reportRebuyTaskAction(formData: FormData) {
  const authUserId = await requireUserId();
  const reportPhotosJson = formText(formData, "reportPhotosJson");
  await service.reportRebuyTask(database.getDatabasePool(), {
    authUserId,
    helperNote: formText(formData, "helperNote"),
    idempotencyKey: formText(formData, "idempotencyKey"),
    rebuyTaskId: formText(formData, "rebuyTaskId"),
    remainingReason: formText(formData, "remainingReason"),
    reportPhotos: reportPhotosJson ? JSON.parse(reportPhotosJson) : [],
    reportPhotosOmitted: formData.get("reportPhotosOmitted") === "on",
    reportedQuantity: formText(formData, "reportedQuantity"),
  });
  revalidatePath("/helper");
}

export async function checkoutRebuyTasksAction(formData: FormData) {
  const authUserId = await requireUserId();
  await service.checkoutRebuyTasks(database.getDatabasePool(), {
    authUserId,
    idempotencyKey: formText(formData, "idempotencyKey"),
  });
  revalidatePath("/helper");
}

export async function submitSettlementPrecheckAction(
  _previousState: HelperActionResult,
  formData: FormData,
): Promise<HelperActionResult> {
  try {
    const authUserId = await requireUserId();
    await service.submitSettlementPrecheck(database.getDatabasePool(), {
      authUserId,
      helperNote: formText(formData, "helperNote"),
      idempotencyKey: formText(formData, "idempotencyKey"),
      receipt: JSON.parse(formText(formData, "receiptJson") || "null"),
      settlementId: formText(formData, "settlementId"),
      transportClaimNote: formText(formData, "transportClaimNote"),
      transportJpy: formText(formData, "transportJpy"),
      transportProof: JSON.parse(formText(formData, "transportProofJson") || "null"),
    });
    revalidatePath("/helper");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function confirmSettlementAction(formData: FormData) {
  const authUserId = await requireUserId();
  await service.confirmSettlement(database.getDatabasePool(), {
    authUserId,
    settlementId: formText(formData, "settlementId"),
  });
  revalidatePath("/helper");
}

export async function submitWarehouseProofAction(
  _previousState: HelperActionResult,
  formData: FormData,
): Promise<HelperActionResult> {
  try {
    const authUserId = await requireUserId();
    await service.submitWarehouseProof(database.getDatabasePool(), {
      authUserId,
      idempotencyKey: formText(formData, "idempotencyKey"),
      note: formText(formData, "note"),
      proof: JSON.parse(formText(formData, "proofJson") || "null"),
      settlementId: formText(formData, "settlementId"),
    });
    revalidatePath("/helper");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}
