"use server";

import { revalidatePath } from "next/cache";

import adminAuthorization from "../../src/server/admin-authorization";
import database from "../../src/server/database";
import service from "../../src/server/helper-app-service";
import { createServerSupabaseClient } from "../../src/server/supabase";

export type AdminActionResult = {
  error?: string;
  ok?: true;
};

async function requireAdmin() {
  return adminAuthorization.authorizeAdminByAllowlist(
    await createServerSupabaseClient(),
  );
}

function formText(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}

function formVersion(formData: FormData) {
  return Number(formData.get("expectedVersion"));
}

function actionError(error: unknown): AdminActionResult {
  console.error("Admin action failed", error);
  return { error: error instanceof Error ? error.message : "操作失敗，請稍後再試。" };
}

export async function createHelperAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  try {
    await requireAdmin();
    await service.createHelperProfile(database.getDatabasePool(), {
      authUserId: formText(formData, "authUserId"),
      bankAccountName: formText(formData, "bankAccountName"),
      bankAccountNumber: formText(formData, "bankAccountNumber"),
      bankCode: formText(formData, "bankCode"),
      compensationMode: formText(formData, "compensationMode") || "hourly",
      displayName: formText(formData, "displayName"),
      email: formText(formData, "email"),
      helperFxRate: formText(formData, "helperFxRate"),
      hourlyRateTwd: formText(formData, "hourlyRateTwd"),
      region: formText(formData, "region"),
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function deactivateHelperAction(formData: FormData) {
  try {
    await requireAdmin();
    await service.deactivateHelperProfile(
      database.getDatabasePool(),
      formText(formData, "helperId"),
    );
    revalidatePath("/admin");
  } catch (error) {
    console.error("Deactivate helper action failed", error);
  }
}

export async function updateHelperAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  try {
    await requireAdmin();
    await service.updateHelperProfile(
      database.getDatabasePool(),
      formText(formData, "helperId"),
      {
        authUserId: formText(formData, "authUserId"),
        bankAccountName: formText(formData, "bankAccountName"),
        bankAccountNumber: formText(formData, "bankAccountNumber"),
        bankCode: formText(formData, "bankCode"),
        compensationMode: formText(formData, "compensationMode") || "hourly",
        displayName: formText(formData, "displayName"),
        email: formText(formData, "email"),
        helperFxRate: formText(formData, "helperFxRate"),
        hourlyRateTwd: formText(formData, "hourlyRateTwd"),
        region: formText(formData, "region"),
      },
    );
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function createTripAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  try {
    await requireAdmin();
    await service.createTrip(database.getDatabasePool(), {
      assignedHelperId: formText(formData, "assignedHelperId"),
      businessDate: formText(formData, "businessDate"),
      location: formText(formData, "location"),
      scheduledTime: formText(formData, "scheduledTime"),
      timezone: formText(formData, "timezone") || "Asia/Tokyo",
      tripName: formText(formData, "tripName"),
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function createQuoteTaskAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  try {
    const admin = await requireAdmin();
    const uploadedPhotosJson = formText(formData, "uploadedPhotosJson");
    await service.createQuoteTask(database.getDatabasePool(), {
      actorUserId: admin.user.id,
      instruction: formText(formData, "instruction"),
      photoIds: formData.getAll("photoIds").map((value) => String(value)),
      productName: formText(formData, "productName"),
      taskType: formText(formData, "taskType"),
      tripId: formText(formData, "tripId"),
      uploadedPhotos: uploadedPhotosJson ? JSON.parse(uploadedPhotosJson) : [],
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function createPurchaseTaskAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  try {
    const admin = await requireAdmin();
    const referencePhotosJson = formText(formData, "referencePhotosJson");
    await service.createPurchaseTask(database.getDatabasePool(), {
      actorUserId: admin.user.id,
      lineCommunityName: formText(formData, "lineCommunityName"),
      note: formText(formData, "note"),
      originalPriceJpy: formText(formData, "originalPriceJpy"),
      productName: formText(formData, "productName"),
      quantity: formText(formData, "quantity"),
      referencePhotos: referencePhotosJson ? JSON.parse(referencePhotosJson) : [],
      requiresFaceCheck: formData.get("requiresFaceCheck") === "on",
      salePriceTwd: formText(formData, "salePriceTwd"),
      tripId: formText(formData, "tripId"),
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function createRebuyTaskAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  try {
    const admin = await requireAdmin();
    const referencePhotosJson = formText(formData, "referencePhotosJson");
    await service.createRebuyTask(database.getDatabasePool(), {
      actorUserId: admin.user.id,
      assignedHelperId: formText(formData, "assignedHelperId"),
      instructions: formText(formData, "instructions"),
      lineCommunityName: formText(formData, "lineCommunityName"),
      originalPriceJpy: formText(formData, "originalPriceJpy"),
      productName: formText(formData, "productName"),
      quantity: formText(formData, "quantity"),
      referencePhotos: referencePhotosJson ? JSON.parse(referencePhotosJson) : [],
      salePriceTwd: formText(formData, "salePriceTwd"),
      sourcePurchaseTaskId: formText(formData, "sourcePurchaseTaskId"),
      visibility: formText(formData, "visibility") || "private",
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function quickPublishPurchaseTaskAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  try {
    const admin = await requireAdmin();
    await service.quickPublishPurchaseTask(database.getDatabasePool(), {
      actorUserId: admin.user.id,
      lineCommunityName: formText(formData, "lineCommunityName"),
      note: formText(formData, "note"),
      originalPriceJpy: formText(formData, "originalPriceJpy"),
      productName: formText(formData, "productName"),
      quantity: formText(formData, "quantity"),
      quoteTaskPhotoId: formText(formData, "quoteTaskPhotoId"),
      requiresFaceCheck: formData.get("requiresFaceCheck") === "on",
      salePriceTwd: formText(formData, "salePriceTwd"),
      tripId: formText(formData, "tripId"),
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function reviewFaceCheckPurchaseAction(formData: FormData) {
  try {
    const admin = await requireAdmin();
    await service.reviewFaceCheckPurchaseTask(database.getDatabasePool(), {
      action: formText(formData, "reviewAction"),
      actorUserId: admin.user.id,
      adminReviewNote: formText(formData, "adminReviewNote"),
      purchaseTaskId: formText(formData, "purchaseTaskId"),
    });
    revalidatePath("/admin");
  } catch (error) {
    console.error("Face-check review action failed", error);
  }
}

export async function reviewSettlementAction(formData: FormData) {
  const admin = await requireAdmin();
  await service.reviewSettlement(database.getDatabasePool(), {
    action: formText(formData, "reviewAction"),
    actorUserId: admin.user.id,
    adminReviewNote: formText(formData, "adminReviewNote"),
    jpyToTwdRate: formText(formData, "jpyToTwdRate"),
    settlementId: formText(formData, "settlementId"),
    transportDecision: formText(formData, "transportDecision"),
  });
  revalidatePath("/admin");
}

export async function setSettlementExchangeRateAction(formData: FormData) {
  const admin = await requireAdmin();
  await service.setSettlementExchangeRate(database.getDatabasePool(), {
    actorUserId: admin.user.id,
    jpyToTwdRate: formText(formData, "jpyToTwdRate"),
    settlementId: formText(formData, "settlementId"),
  });
  revalidatePath("/admin");
}

export async function recordSettlementPaymentAction(formData: FormData) {
  const admin = await requireAdmin();
  await service.recordSettlementPayment(database.getDatabasePool(), {
    actorUserId: admin.user.id,
    settlementId: formText(formData, "settlementId"),
    transferNotification: formText(formData, "transferNotification"),
  });
  revalidatePath("/admin");
}

export async function reviewWarehouseProofAction(formData: FormData) {
  const admin = await requireAdmin();
  await service.reviewWarehouseProof(database.getDatabasePool(), {
    actorUserId: admin.user.id,
    settlementId: formText(formData, "settlementId"),
  });
  revalidatePath("/admin");
}

export async function activateTripAction(formData: FormData) {
  try {
    const admin = await requireAdmin();
    await service.activateTrip(database.getDatabasePool(), {
      actorUserId: admin.user.id,
      expectedVersion: formVersion(formData),
      tripId: formText(formData, "tripId"),
    });
    revalidatePath("/admin");
  } catch (error) {
    console.error("Activate trip action failed", error);
  }
}

export async function cancelTripAction(formData: FormData) {
  try {
    const admin = await requireAdmin();
    await service.cancelTrip(database.getDatabasePool(), {
      actorUserId: admin.user.id,
      expectedVersion: formVersion(formData),
      reason: formText(formData, "reason"),
      tripId: formText(formData, "tripId"),
    });
    revalidatePath("/admin");
  } catch (error) {
    console.error("Cancel trip action failed", error);
  }
}

export async function repairTripAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  try {
    const admin = await requireAdmin();
    await service.repairTrip(database.getDatabasePool(), {
      actorUserId: admin.user.id,
      expectedVersion: formVersion(formData),
      patch: {
        admin_activated_at: formText(formData, "adminActivatedAt"),
        arrived_at: formText(formData, "arrivedAt"),
        canceled_at: formText(formData, "canceledAt"),
        departed_at: formText(formData, "departedAt"),
        ended_at: formText(formData, "endedAt"),
        status: formText(formData, "status"),
      },
      reason: formText(formData, "reason"),
      tripId: formText(formData, "tripId"),
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function saveSitePhotoAction(formData: FormData) {
  try {
    const admin = await requireAdmin();
    await service.markSitePhotoSaved(database.getDatabasePool(), {
      actorUserId: admin.user.id,
      photoId: formText(formData, "photoId"),
    });
    revalidatePath("/admin");
  } catch (error) {
    console.error("Save site photo action failed", error);
  }
}
