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
