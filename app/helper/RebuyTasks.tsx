"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  ImageUp,
  PackageCheck,
  ShoppingBag,
  X,
} from "lucide-react";

import { EmptyState, StatusBadge, Surface } from "../components/OperationsUi";
import { BackButton } from "../components/BackButton";
import { RetryableError } from "../components/RetryableState";
import { Button } from "../components/ui/button";
import { useStaleResource } from "../../src/lib/client-resource-cache";

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
  uploadPromise?: Promise<RebuyUploadPhoto>;
};

const MAX_REBUY_REPORT_PHOTO_BYTES = 8 * 1024 * 1024;

export function RebuyTasks({
  rebuySection,
  selectedTaskId,
  tasks,
}: {
  rebuySection?: "public" | "mine";
  selectedTaskId?: string;
  tasks: any[];
}) {
  const [currentSection, setCurrentSection] = useState<"public" | "mine" | undefined>(rebuySection);
  const [activeTaskId, setActiveTaskId] = useState<string | undefined>(selectedTaskId);
  const [activeTask, setActiveTask] = useState<any | null>(selectedTaskId ? tasks[0] || null : null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);

  const loadTasks = useCallback(async (signal: AbortSignal) => {
    const response = await fetch("/api/helper/rebuy-tasks", { cache: "no-store", signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "補買列表載入失敗。");
    return (body.tasks || []) as any[];
  }, []);
  const taskResource = useStaleResource<any[]>({
    fetcher: loadTasks,
    initialData: tasks,
    key: "helper:rebuy-tasks",
    staleTimeMs: 5_000,
  });
  const taskList = taskResource.data || [];
  const reloadTasks = useCallback(async () => {
    return (await taskResource.refresh()) || [];
  }, [taskResource.refresh]);

  async function openTask(taskId: string) {
    setActiveTaskId(taskId);
    setActiveTask(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/helper/rebuy-tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "補買任務載入失敗。");
      setActiveTask(body.task || null);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "補買任務載入失敗。");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeTask() {
    setActiveTaskId(undefined);
    setActiveTask(null);
    setDetailError("");
  }

  if (activeTaskId) {
    const task = activeTask;
    return (
      <section className="grid gap-4">
        <BackButton label="返回補買列表" onClick={closeTask} type="button" />
        {detailLoading && !task ? (
          <Surface className="grid gap-3">
            <div className="grid gap-3" aria-label="正在載入補買任務" role="status">
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
              <div className="aspect-square animate-pulse rounded-lg bg-muted" />
            </div>
          </Surface>
        ) : detailError ? (
          <Surface>
            <RetryableError message={detailError} onRetry={() => openTask(activeTaskId)} />
          </Surface>
        ) : task ? (
          <RebuyTaskDetail task={task} onTaskChanged={(updatedTask) => {
            setActiveTask((previous: any) => ({ ...previous, ...updatedTask }));
            setCurrentSection(updatedTask.visibility === "public" && updatedTask.status === "open" ? "public" : "mine");
            taskResource.setData((current = []) =>
              current.map((item) => item.id === updatedTask.id ? { ...item, ...updatedTask } : item),
            );
          }} />
        ) : (
          <EmptyState title="找不到這筆補買" body="任務可能已被更新、結帳，或不屬於你的補買範圍。" />
        )}
      </section>
    );
  }
  const publicOpen = taskList.filter((task) => task.visibility === "public" && task.status === "open");
  const mine = taskList.filter((task) => !(task.visibility === "public" && task.status === "open"));
  const readyToCheckout = mine.filter((task) => task.status === "reported").length;
  const activeMine = mine.filter((task) => ["open", "claimed"].includes(task.status)).length;
  if (!currentSection) {
    return (
      <Surface className="grid gap-4">
        <h5 className="text-xl font-semibold tracking-tight">補買區</h5>
        <div className="grid gap-2">
          <RebuyEntryCard
            count={publicOpen.length}
            title="公共補買"
            onOpen={() => setCurrentSection("public")}
          />
          <RebuyEntryCard
            count={mine.length}
            title="我的補買"
            onOpen={() => setCurrentSection("mine")}
          />
        </div>
      </Surface>
    );
  }

  return (
    <Surface className="grid gap-4">
      <BackButton
        label="返回補買區"
        onClick={() => setCurrentSection(undefined)}
        type="button"
      />
      <div className="flex items-start justify-between gap-3">
        <h5 className="text-xl font-semibold tracking-tight">
          {currentSection === "public" ? "公共補買" : "我的補買"}
        </h5>
        <StatusBadge tone={currentSection === "public" ? "blue" : activeMine ? "amber" : "neutral"}>
          {currentSection === "public" ? publicOpen.length : activeMine}
        </StatusBadge>
      </div>
      {taskResource.error ? <RetryableError message={taskResource.error} onRetry={() => void reloadTasks()} /> : null}
      {currentSection === "mine" && readyToCheckout ? (
        <RebuyCheckoutButton readyToCheckout={readyToCheckout} onCheckedOut={reloadTasks} />
      ) : null}
      {currentSection === "public" ? (
        <RebuyTaskGroup empty="目前沒有公開補買。" isPublicPool tasks={publicOpen} title="未認領" onOpenTask={openTask} />
      ) : (
        <>
          <RebuyTaskGroup empty="目前沒有未完成補買。" tasks={mine.filter((task) => ["open", "claimed"].includes(task.status))} title="未完成" onOpenTask={openTask} />
          <RebuyTaskGroup empty="目前沒有等待結帳的補買。" tasks={mine.filter((task) => task.status === "reported")} title="等待結帳" onOpenTask={openTask} />
          <RebuyTaskGroup empty="目前沒有已結帳補買。" tasks={mine.filter((task) => task.status === "checked_out")} title="已結帳" onOpenTask={openTask} />
          <RebuyTaskGroup empty="目前沒有已取消補買。" tasks={mine.filter((task) => task.status === "canceled")} title="已取消" onOpenTask={openTask} />
        </>
      )}
    </Surface>
  );
}

function RebuyEntryCard({
  count,
  onOpen,
  title,
}: {
  count: number;
  onOpen: () => void;
  title: string;
}) {
  return (
    <button
      className="group flex items-center justify-between gap-3 rounded-2xl border bg-background px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-accent/30"
      type="button"
      onClick={onOpen}
    >
      <strong className="text-base">{title}</strong>
      <span className="flex items-center gap-2">
        <StatusBadge tone={count ? "blue" : "neutral"}>{count}</StatusBadge>
        <ChevronRight className="size-5 text-muted-foreground" />
      </span>
    </button>
  );
}

function RebuyTaskGroup({
  empty,
  isPublicPool = false,
  onOpenTask,
  tasks,
  title,
}: {
  empty: string;
  isPublicPool?: boolean;
  onOpenTask: (taskId: string) => void;
  tasks: any[];
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <p className={`text-sm font-semibold ${title === "已結帳" ? "text-emerald-700" : ""}`}>{title}</p>
      {tasks.length ? (
        <div className="grid gap-2">
          {tasks.map((task) => (
            <button
              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-accent/30 ${
                task.status === "reported" || task.status === "checked_out"
                  ? "border-emerald-200 bg-emerald-50/60"
                  : "bg-background"
              }`}
              key={task.id}
              type="button"
              onClick={() => onOpenTask(task.id)}
            >
              <span className="min-w-0">
                <strong className="block truncate text-base">{rebuyTaskName(task)}</strong>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {task.quantity} 件 · JPY {task.original_price_jpy ?? "-"}
                </span>
              </span>
              <StatusBadge tone={rebuyStatusTone(task.status)}>
                {isPublicPool ? "可認領" : rebuyStatusLabel(task.status)}
              </StatusBadge>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function RebuyTaskDetail({
  onTaskChanged,
  task,
}: {
  onTaskChanged: (task: any) => void;
  task: any;
}) {
  const [currentTask, setCurrentTask] = useState(task);
  const [actionError, setActionError] = useState("");
  const [actionPending, setActionPending] = useState<"" | "claim" | "release">("");
  const isPublicPool = currentTask.visibility === "public" && currentTask.status === "open";
  const canReport = ["open", "claimed"].includes(currentTask.status) && !isPublicPool;

  async function submitTaskAction(body: Record<string, unknown>) {
    setActionError("");
    const response = await fetch(`/api/helper/rebuy-tasks/${encodeURIComponent(currentTask.id)}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "補買操作失敗。");
    if (result.task) {
      setCurrentTask((previous: any) => ({ ...previous, ...result.task }));
      onTaskChanged(result.task);
    }
    return result.task;
  }

  async function claimTask() {
    setActionPending("claim");
    try {
      await submitTaskAction({
        action: "claim",
        expectedVersion: currentTask.version,
        idempotencyKey: createClientId("claim"),
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "認領補買失敗。");
    } finally {
      setActionPending("");
    }
  }

  async function releaseTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setActionPending("release");
    try {
      await submitTaskAction({
        action: "release",
        expectedVersion: currentTask.version,
        idempotencyKey: createClientId("release"),
        reason: String(formData.get("reason") || ""),
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "退回公開池失敗。");
    } finally {
      setActionPending("");
    }
  }

  return (
    <Surface className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-muted-foreground">補買</p>
          <p className="mt-2 text-xs font-semibold text-muted-foreground">商品名稱</p>
          <h5 className="mt-1 truncate text-xl font-semibold tracking-tight">{rebuyTaskName(currentTask)}</h5>
          {currentTask.instructions ? (
            <p className="mt-1 text-sm text-muted-foreground">{currentTask.instructions}</p>
          ) : null}
        </div>
        <StatusBadge tone={rebuyStatusTone(currentTask.status)}>{rebuyStatusLabel(currentTask.status)}</StatusBadge>
      </div>
      <p className="text-sm text-muted-foreground">
        {currentTask.quantity} 件 · JPY {currentTask.original_price_jpy ?? "-"}
      </p>
      {currentTask.remaining_quantity ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          尚缺 {currentTask.remaining_quantity} 件：{currentTask.remaining_reason}
        </p>
      ) : null}
      {currentTask.photos?.length ? (
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {currentTask.photos.map((photo: any) => (
              <a className="grid gap-1 text-xs text-muted-foreground" href={photo.signed_url} key={photo.id} rel="noreferrer" target="_blank">
                <img alt={photo.photo_role} className="aspect-square w-full rounded-md border object-cover" src={photo.signed_url} />
                <span>{photo.photo_role === "reference" ? "參考" : "回報"}</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
      {isPublicPool ? (
        <Button disabled={Boolean(actionPending)} type="button" onClick={claimTask}>
          {actionPending === "claim" ? "認領中..." : "認領補買"}
        </Button>
      ) : null}
      {currentTask.status === "claimed" && currentTask.visibility === "public" ? (
        <form className="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[1fr_auto]" onSubmit={releaseTask}>
          <input disabled={Boolean(actionPending)} name="reason" placeholder="退回公開池原因" required />
          <Button disabled={Boolean(actionPending)} type="submit" variant="outline">
            {actionPending === "release" ? "退回中..." : "退回公開池"}
          </Button>
        </form>
      ) : null}
      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      {canReport ? <RebuyReportForm task={currentTask} onReported={(reportedTask) => setCurrentTask((previous: any) => ({ ...previous, ...reportedTask }))} /> : null}
      {currentTask.status === "reported" ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="size-5 shrink-0" />
          已完成回報，等待補買結帳。
        </div>
      ) : null}
      {currentTask.status === "checked_out" ? (
        <div className="flex items-center gap-2 rounded-md bg-muted p-3 text-sm">
          <PackageCheck className="size-5 shrink-0" />
          這筆補買已納入結帳。
        </div>
      ) : null}
    </Surface>
  );
}

function RebuyCheckoutButton({
  onCheckedOut,
  readyToCheckout,
}: {
  onCheckedOut: () => Promise<any[]>;
  readyToCheckout: number;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function checkout() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/helper/rebuy-tasks", {
        body: JSON.stringify({
          action: "checkout",
          idempotencyKey: createClientId("rebuy-checkout"),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "補買結帳失敗。");
      await onCheckedOut();
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "補買結帳失敗。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Button className="w-full" disabled={pending} type="button" onClick={checkout}>
        <ShoppingBag className="mr-2 size-4" />
        {pending ? "結帳中..." : `結帳 ${readyToCheckout} 筆`}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function RebuyReportForm({ onReported, task }: { onReported: (task: any) => void; task: any }) {
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
    for (const photo of selected) {
      const uploadPromise = uploadSelectedPhoto(photo);
      updatePhoto(photo.clientPhotoId, { uploadPromise });
    }
  }

  async function uploadSelectedPhoto(photo: RebuyUploadPhoto) {
    updatePhoto(photo.clientPhotoId, { error: undefined, status: "uploading" });
    try {
      const uploaded = await uploadRebuyReportPhoto(photo, task.id);
      const nextPhoto = { ...photo, ...uploaded };
      updatePhoto(photo.clientPhotoId, nextPhoto);
      return nextPhoto;
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "照片上傳失敗。";
      updatePhoto(photo.clientPhotoId, { error: message, status: "failed", uploadPromise: undefined });
      throw uploadError;
    }
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
          if (photo.uploadPromise) return photo.uploadPromise;
          return uploadSelectedPhoto(photo);
        }),
      );
      setPhotos(uploadedPhotos);
      const response = await fetch(`/api/helper/rebuy-tasks/${encodeURIComponent(task.id)}`, {
        body: JSON.stringify({
          action: "report",
          helperNote: String(formData.get("helperNote") || ""),
          idempotencyKey: String(formData.get("idempotencyKey") || ""),
          remainingReason: String(formData.get("remainingReason") || ""),
          reportPhotos: uploadedPhotos.map((photo) => ({
            byteSize: photo.byteSize,
            contentType: photo.contentType,
            originalFilename: photo.originalFilename,
            sortOrder: photo.sortOrder,
            storageKey: photo.storageKey,
          })),
          reportPhotosOmitted: formData.get("reportPhotosOmitted") === "on",
          reportedQuantity: String(formData.get("reportedQuantity") || ""),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "補買回報失敗。");
      onReported(body.task);
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
    <form className="grid gap-4 border-t pt-5" onSubmit={submitReport}>
      <input name="rebuyTaskId" type="hidden" value={task.id} />
      <input name="idempotencyKey" type="hidden" value={`report-${task.id}-${Date.now()}`} />
      <div>
        <h2 className="font-semibold">回報補買結果</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span>實際買到數量</span>
          <input defaultValue={task.quantity} inputMode="numeric" max={task.quantity} min="0" name="reportedQuantity" required disabled={pending} />
        </label>
        <label className="grid gap-1">
          <span>未買足原因</span>
          <input name="remainingReason" placeholder="部分買到時必填" disabled={pending} />
        </label>
      </div>
      <label className="grid gap-1">
        <span>回報備註</span>
        <textarea name="helperNote" placeholder="例如：現場只剩最後兩件" disabled={pending} />
      </label>
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
      byteSize: photo.byteSize,
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

function rebuyStatusTone(status: string): "amber" | "blue" | "green" | "neutral" | "red" {
  if (status === "reported" || status === "checked_out") return "green";
  if (status === "claimed") return "amber";
  if (status === "open") return "blue";
  if (status === "canceled") return "red";
  return "neutral";
}

function rebuyTaskName(task: any) {
  return String(task?.product_name || "").trim() || "未命名補買";
}
