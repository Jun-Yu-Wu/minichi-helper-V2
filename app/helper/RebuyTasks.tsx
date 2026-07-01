"use client";

import { useEffect, useRef, useState } from "react";
import { ImageUp, X } from "lucide-react";

import {
  checkoutRebuyTasksAction,
  claimRebuyTaskAction,
  releaseRebuyTaskAction,
  reportRebuyTaskAction,
} from "../actions/helper";
import { ActionButtonForm } from "../components/ActionButtonForm";
import { Button } from "../components/ui/button";

type RebuyUploadPhoto = {
  byteSize: number;
  clientPhotoId: string;
  contentType: string;
  error?: string;
  file: File;
  objectUrl: string;
  originalFilename: string;
  sortOrder: number;
  status: "selected" | "uploading" | "uploaded" | "failed";
  storageKey?: string;
};

const MAX_REBUY_REPORT_PHOTO_BYTES = 8 * 1024 * 1024;

export function RebuyTasks({ tasks }: { tasks: any[] }) {
  const publicOpen = tasks.filter((task) => task.visibility === "public" && task.status === "open");
  const mine = tasks.filter((task) => !(task.visibility === "public" && task.status === "open"));
  const readyToCheckout = mine.filter((task) => task.status === "reported").length;
  return (
    <section className="grid gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader eyebrow="補買" title="補買區" />
        {readyToCheckout ? (
          <form action={checkoutRebuyTasksAction}>
            <input name="idempotencyKey" type="hidden" value={`rebuy-checkout-${Date.now()}`} />
            <Button type="submit">結帳 {readyToCheckout} 筆補買</Button>
          </form>
        ) : null}
      </div>
      <RebuyTaskGroup empty="目前沒有自己的補買任務。" tasks={mine} title="我的補買" />
      <RebuyTaskGroup empty="目前沒有公開補買。" isPublicPool tasks={publicOpen} title="公開補買池" />
    </section>
  );
}

function RebuyTaskGroup({
  empty,
  isPublicPool = false,
  tasks,
  title,
}: {
  empty: string;
  isPublicPool?: boolean;
  tasks: any[];
  title: string;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        <span className="text-sm text-muted-foreground">{tasks.length} 筆</span>
      </div>
      {tasks.length ? (
        <div className="grid gap-3">
          {tasks.map((task) => (
            <article className="rounded-lg border bg-card p-4 shadow-sm" key={task.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h4 className="font-semibold">{task.product_name}</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {rebuyStatusLabel(task.status)} · JPY {task.original_price_jpy ?? "-"}
                  </p>
                  <p className="mt-2 inline-flex rounded-md bg-muted/70 px-3 py-1.5 text-sm font-medium text-foreground">
                    需要補買：{task.quantity} 件
                  </p>
                  {task.reported_quantity != null ? (
                    <p className="mt-2 text-sm font-medium text-foreground">
                      已回報買到：{task.reported_quantity} / {task.quantity} 件
                    </p>
                  ) : null}
                  {task.instructions ? <p className="mt-2 text-sm">{task.instructions}</p> : null}
                  {task.line_community_name ? (
                    <p className="mt-1 text-sm text-muted-foreground">客人：{task.line_community_name}</p>
                  ) : null}
                </div>
              </div>
              {task.photos?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {task.photos.map((photo: any) => (
                    <a href={photo.signed_url} key={photo.id} rel="noreferrer" target="_blank">
                      <img alt={photo.photo_role} className="size-20 rounded-md border object-cover" src={photo.signed_url} />
                    </a>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 grid gap-3">
                {isPublicPool ? (
                  <ActionButtonForm
                    action={claimRebuyTaskAction}
                    fields={[
                      { name: "rebuyTaskId", value: task.id },
                      { name: "expectedVersion", value: task.version },
                      { name: "idempotencyKey", value: `claim-${task.id}-${Date.now()}` },
                    ]}
                    label="認領補買"
                  />
                ) : task.status === "claimed" && task.visibility === "public" ? (
                  <form action={releaseRebuyTaskAction} className="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[1fr_auto]">
                    <input name="rebuyTaskId" type="hidden" value={task.id} />
                    <input name="expectedVersion" type="hidden" value={task.version} />
                    <input name="idempotencyKey" type="hidden" value={`release-${task.id}-${Date.now()}`} />
                    <input name="reason" placeholder="退回公開池原因" required />
                    <Button type="submit" variant="outline">退回公開池</Button>
                  </form>
                ) : null}
                {["open", "claimed"].includes(task.status) && !isPublicPool ? (
                  <RebuyReportForm task={task} />
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-sm">{empty}</p>
      )}
    </section>
  );
}

function RebuyReportForm({ task }: { task: any }) {
  const [photos, setPhotos] = useState<RebuyUploadPhoto[]>([]);
  const photosRef = useRef<RebuyUploadPhoto[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.objectUrl);
    },
    [],
  );

  function addFiles(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => ({
        byteSize: file.size,
        clientPhotoId: createClientId("rebuy-report"),
        contentType: file.type || "image/jpeg",
        error:
          file.size > MAX_REBUY_REPORT_PHOTO_BYTES
            ? "照片超過 8MB，請縮小後再上傳。"
            : undefined,
        file,
        objectUrl: URL.createObjectURL(file),
        originalFilename: file.name || "rebuy-report.jpg",
        sortOrder: 0,
        status: file.size > MAX_REBUY_REPORT_PHOTO_BYTES ? "failed" as const : "selected" as const,
      }));
    setPhotos((current) => [
      ...current,
      ...selected.map((photo, index) => ({ ...photo, sortOrder: current.length + index })),
    ]);
  }

  function removePhoto(clientPhotoId: string) {
    setPhotos((current) => {
      const removed = current.find((photo) => photo.clientPhotoId === clientPhotoId);
      if (removed) URL.revokeObjectURL(removed.objectUrl);
      return current
        .filter((photo) => photo.clientPhotoId !== clientPhotoId)
        .map((photo, index) => ({ ...photo, sortOrder: index }));
    });
  }

  function updatePhoto(clientPhotoId: string, patch: Partial<RebuyUploadPhoto>) {
    setPhotos((current) =>
      current.map((photo) =>
        photo.clientPhotoId === clientPhotoId ? { ...photo, ...patch } : photo,
      ),
    );
  }

  async function submitReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    if (!photos.length && formData.get("reportPhotosOmitted") !== "on") {
      setError("若沒有照片，請勾選確認略過照片。");
      return;
    }
    if (photos.some((photo) => photo.error)) {
      setError("請移除或重選超過大小限制的照片。");
      return;
    }
    setPending(true);
    setError("");
    try {
      const uploadedPhotos = await Promise.all(
        photos.map(async (photo) => {
          if (photo.storageKey) return photo;
          updatePhoto(photo.clientPhotoId, { error: undefined, status: "uploading" });
          try {
            const uploaded = await uploadRebuyReportPhoto(photo, task.id);
            updatePhoto(photo.clientPhotoId, uploaded);
            return { ...photo, ...uploaded };
          } catch (uploadError) {
            const message = uploadError instanceof Error ? uploadError.message : "照片上傳失敗。";
            updatePhoto(photo.clientPhotoId, { error: message, status: "failed" });
            throw uploadError;
          }
        }),
      );
      setPhotos(uploadedPhotos);
      formData.set(
        "reportPhotosJson",
        JSON.stringify(
          uploadedPhotos.map((photo) => ({
            byteSize: photo.byteSize,
            contentType: photo.contentType,
            originalFilename: photo.originalFilename,
            sortOrder: photo.sortOrder,
            storageKey: photo.storageKey,
          })),
        ),
      );
      await reportRebuyTaskAction(formData);
      for (const photo of uploadedPhotos) URL.revokeObjectURL(photo.objectUrl);
      setPhotos([]);
      form.reset();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "補買回報失敗，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-3 rounded-md border bg-background p-3" onSubmit={submitReport}>
      <input name="rebuyTaskId" type="hidden" value={task.id} />
      <input name="idempotencyKey" type="hidden" value={`report-${task.id}-${Date.now()}`} />
      <div className="grid gap-2 sm:grid-cols-2">
        <input defaultValue={task.quantity} inputMode="numeric" name="reportedQuantity" placeholder={`買到數量，最多 ${task.quantity} 件`} required disabled={pending} />
        <input name="remainingReason" placeholder="若部分買到，填剩餘原因" disabled={pending} />
      </div>
      <textarea name="helperNote" placeholder="補買回報備註" disabled={pending} />
      <div className="grid gap-2">
        <p className="text-sm font-medium">補買回報照</p>
        <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-center">
          <ImageUp className="size-5" aria-hidden="true" />
          <span className="text-sm">選擇補買現場照或收據截圖</span>
          <input
            accept="image/*"
            className="sr-only"
            disabled={pending}
            multiple
            type="file"
            onChange={(uploadEvent) => {
              addFiles(uploadEvent.currentTarget.files);
              uploadEvent.currentTarget.value = "";
            }}
          />
        </label>
        {photos.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {photos.map((photo) => (
              <div className="rounded-md border bg-card p-2" key={photo.clientPhotoId}>
                <img
                  alt={photo.originalFilename}
                  className="aspect-square w-full rounded-md object-cover"
                  src={photo.objectUrl}
                />
                <div className="mt-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{photo.originalFilename}</p>
                    <p className="text-xs text-muted-foreground">{uploadStatusLabel(photo.status)}</p>
                  </div>
                  {!pending ? (
                    <button
                      aria-label="移除照片"
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                      type="button"
                      onClick={() => removePhoto(photo.clientPhotoId)}
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </div>
                {photo.error ? <p className="mt-1 text-xs text-destructive">{photo.error}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input name="reportPhotosOmitted" type="checkbox" disabled={pending || photos.length > 0} />
        沒有補買回報照片，確認略過
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button disabled={pending || photos.some((photo) => Boolean(photo.error))} type="submit">
        {pending ? "上傳並回報中..." : "送出補買回報"}
      </Button>
    </form>
  );
}

async function uploadRebuyReportPhoto(photo: RebuyUploadPhoto, rebuyTaskId: string) {
  const presign = await fetch("/api/uploads/presign", {
    body: JSON.stringify({
      clientPhotoId: photo.clientPhotoId,
      contentType: photo.contentType,
      fileName: photo.originalFilename,
      rebuyTaskId,
      uploadPurpose: "rebuy_report",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const presignBody = await presign.json();
  if (!presign.ok) throw new Error(presignBody.error || "無法建立上傳網址。");
  const upload = await fetch(presignBody.uploadUrl, {
    body: photo.file,
    headers: { "content-type": photo.contentType },
    method: "PUT",
  });
  if (!upload.ok) throw new Error(`R2 上傳失敗 (${upload.status})。`);
  return { error: undefined, status: "uploaded" as const, storageKey: presignBody.storageKey };
}

function uploadStatusLabel(status: RebuyUploadPhoto["status"]) {
  if (status === "uploading") return "上傳中";
  if (status === "uploaded") return "已上傳";
  if (status === "failed") return "上傳失敗";
  return "等待送出";
}

function createClientId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}-${randomUuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rebuyStatusLabel(status: string) {
  const labels: Record<string, string> = {
    canceled: "已取消",
    checked_out: "已結帳",
    claimed: "已認領",
    open: "待補買",
    reported: "已回報",
  };
  return labels[status] || status;
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
    </div>
  );
}
