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
    await service.createQuoteTask(database.getDatabasePool(), {
      actorUserId: admin.user.id,
      instruction: formText(formData, "instruction"),
      photoIds: formData.getAll("photoIds").map((value) => String(value)),
      productName: formText(formData, "productName"),
      taskType: formText(formData, "taskType"),
      tripId: formText(formData, "tripId"),
    });
    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
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
