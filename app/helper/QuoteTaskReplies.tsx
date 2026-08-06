"use client";

import type { FormEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, ImageUp, Pencil, RefreshCw, X } from "lucide-react";

import { BackButton } from "../components/BackButton";
import { EmptyState, StatusBadge, Surface } from "../components/OperationsUi";
import { RetryableError } from "../components/RetryableState";
import { Button } from "../components/ui/button";
import { PhotoFileInput } from "../components/PhotoFileInput";
import { PhotoDraftEditor, PhotoViewerTrigger } from "../components/PhotoAnnotationEditor";
import { useStaleResource } from "../../src/lib/client-resource-cache";
import { useTripSectionNavigation } from "./TripSectionSwitcher";
import { preparePhotoForUpload } from "../../src/lib/client-photo-upload";

type UploadStatus = "selected" | "uploading" | "uploaded" | "failed";

type DetailPhoto = {
  byteSize: number;
  clientPhotoId: string;
  contentType: string;
  error?: string;
  file: File;
  objectUrl: string;
  originalFilename: string;
  sortOrder: number;
  status: UploadStatus;
  storageKey?: string;
};

type PendingDetailUpload = {
  file: File;
  promise: Promise<Partial<DetailPhoto>>;
};

export function QuoteTaskWorkspace({ tripId }: { tripId: string }) {
  const navigation = useTripSectionNavigation();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<any | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);

  const loadTasks = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(
      `/api/helper/trips/${encodeURIComponent(tripId)}/quote-tasks`,
      { cache: "no-store", signal },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "無法載入細圖／報價任務。");
    return (body.tasks || []) as any[];
  }, [tripId]);
  const taskResource = useStaleResource<any[]>({
    fetcher: loadTasks,
    key: `helper:quote-tasks:${tripId}`,
    staleTimeMs: 5_000,
  });
  const tasks = taskResource.data || [];

  const loadTask = useCallback(async (taskId: string, signal?: AbortSignal) => {
    setDetailError("");
    setDetailLoading(true);
    try {
      const response = await fetch(
        `/api/helper/trips/${encodeURIComponent(tripId)}/quote-tasks/${encodeURIComponent(taskId)}`,
        { cache: "no-store", signal },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "無法載入任務內容。");
      const task = body.task || null;
      setActiveTask(task);
      if (task?.photos?.length) {
        setPhotoIndex(firstUnrepliedPhotoIndex(task.photos));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDetailError(error instanceof Error ? error.message : "無法載入任務內容。");
    } finally {
      if (!signal?.aborted) setDetailLoading(false);
    }
  }, [tripId]);

  function openTask(taskId: string) {
    setActiveTaskId(taskId);
    setActiveTask(null);
    setPhotoIndex(0);
    void loadTask(taskId);
  }

  function closeTask() {
    setActiveTaskId(null);
    setActiveTask(null);
    setDetailError("");
    setPhotoIndex(0);
  }

  function handleReplySubmitted(photoId: string, replyPatch?: any) {
    const wasAlreadyReplied = activeTask?.photos?.some(
      (photo: any) =>
        photo.id === photoId &&
        ["converted_to_purchase", "replied"].includes(photo.reply_status),
    );
    setActiveTask((current: any) => {
      if (!current) return current;
      const photos = (current.photos || []).map((photo: any) =>
        photo.id === photoId
          ? {
              ...photo,
              latest_reply: replyPatch || photo.latest_reply,
              needs_review: false,
              reply_status: "replied",
            }
          : photo,
      );
      const isCompleted = completedPhotoCount(photos) === photos.length && photos.length > 0;
      return { ...current, photos, status: isCompleted ? "completed" : current.status };
    });
    taskResource.setData((current = []) =>
      current.map((task) => {
        if (task.id !== activeTaskId) return task;
        const repliedPhotoCount = Math.min(
          Number(task.replied_photo_count || 0) + (wasAlreadyReplied ? 0 : 1),
          Number(task.photo_count || 0),
        );
        return {
          ...task,
          replied_photo_count: repliedPhotoCount,
          status:
            repliedPhotoCount === Number(task.photo_count || 0)
              ? "completed"
              : task.status,
        };
      }),
    );
  }

  if (activeTaskId) {
    const summaryTask = tasks.find((task) => task.id === activeTaskId);
    return (
      <QuoteTaskDetail
        error={detailError}
        loading={detailLoading}
        name={taskDisplayName(summaryTask || activeTask, tasks)}
        photoIndex={photoIndex}
        task={activeTask}
        onBack={closeTask}
        onPhotoIndexChange={setPhotoIndex}
        onRefresh={() => loadTask(activeTaskId)}
        onSubmitted={handleReplySubmitted}
      />
    );
  }

  return (
    <QuoteTaskList
      error={taskResource.error}
      loading={taskResource.isLoading}
      tasks={tasks}
      onBack={() => navigation?.openWork()}
      onOpenTask={openTask}
      onRefresh={() => void taskResource.refresh()}
    />
  );
}

function QuoteTaskList({
  error,
  loading,
  onBack,
  onOpenTask,
  onRefresh,
  tasks,
}: {
  error: string;
  loading: boolean;
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
  onRefresh: () => void;
  tasks: any[];
}) {
  const unfinishedTasks = tasks.filter((task) => !isQuoteTaskCompleted(task));
  const completedTasks = tasks.filter(isQuoteTaskCompleted);
  const taskNames = buildTaskNames(tasks);

  return (
    <Surface className="trip-task-surface grid gap-4">
      <BackButton label="返回連線" onClick={onBack} type="button" variant="outline" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h5 className="text-xl font-semibold tracking-tight">報價／細圖</h5>
        </div>
        <StatusBadge tone={unfinishedTasks.length ? "amber" : "neutral"}>
          {unfinishedTasks.length}
        </StatusBadge>
      </div>
      {loading && !tasks.length ? (
        <div className="grid gap-2" aria-label="正在載入細圖報價任務" role="status">
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : error ? (
        <RetryableError message={error} onRetry={onRefresh} />
      ) : !tasks.length ? (
        <EmptyState title="目前沒有細圖／報價任務" body="管理員發布任務後會顯示在這裡。" />
      ) : (
        <div className="grid gap-4">
          <QuoteTaskLane
            completed={false}
            emptyText="目前沒有需要回覆的報價／細圖。"
            taskNames={taskNames}
            tasks={unfinishedTasks}
            title="未回覆"
            onOpenTask={onOpenTask}
          />
          {completedTasks.length ? (
            <QuoteTaskLane
              completed
              emptyText=""
              taskNames={taskNames}
              tasks={completedTasks}
              title="已回覆"
              onOpenTask={onOpenTask}
            />
          ) : null}
        </div>
      )}
    </Surface>
  );
}

function QuoteTaskLane({
  completed,
  emptyText,
  onOpenTask,
  taskNames,
  tasks,
  title,
}: {
  completed: boolean;
  emptyText: string;
  onOpenTask: (taskId: string) => void;
  taskNames: Map<string, string>;
  tasks: any[];
  title: string;
}) {
  return (
    <section className="trip-task-lane grid gap-2">
      <p className={`text-sm font-semibold ${completed ? "text-emerald-700" : ""}`}>{title}</p>
      {tasks.length ? tasks.map((task) => {
        const completedPhotos = Number(task.replied_photo_count || 0);
        const photoCount = Number(task.photo_count || task.photos?.length || 0);
        return (
          <button
            className={`trip-task-card flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left shadow-sm ${
              completed ? "trip-task-card--complete" : ""
            }`}
            key={task.id}
            type="button"
            onClick={() => onOpenTask(task.id)}
          >
            <span className="min-w-0">
              <strong className="block truncate text-base">
                {taskNames.get(task.id) || `${taskTypeLabel(task.task_type)}任務`}
              </strong>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {taskTypeLabel(task.task_type)}
              </span>
            </span>
            <StatusBadge tone={completed ? "green" : "blue"}>
              {completedPhotos}/{photoCount}
            </StatusBadge>
          </button>
        );
      }) : (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{emptyText}</p>
      )}
    </section>
  );
}

function QuoteTaskDetail({
  error,
  loading,
  name,
  onBack,
  onPhotoIndexChange,
  onRefresh,
  onSubmitted,
  photoIndex,
  task,
}: {
  error: string;
  loading: boolean;
  name: string;
  onBack: () => void;
  onPhotoIndexChange: (index: number) => void;
  onRefresh: () => void;
  onSubmitted: (photoId: string, replyPatch?: any) => void;
  photoIndex: number;
  task: any | null;
}) {
  const photos = task?.photos || [];
  const safeIndex = Math.min(photoIndex, Math.max(photos.length - 1, 0));
  const currentPhoto = photos[safeIndex];
  const doneCount = completedPhotoCount(photos);

  return (
    <Surface className="trip-task-surface grid gap-4">
      <BackButton label="返回任務列表" onClick={onBack} type="button" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            {task ? taskTypeLabel(task.task_type) : "細圖／報價"}
          </p>
          <p className="mt-2 text-xs font-semibold text-muted-foreground">商品名稱</p>
          <h5 className="mt-1 truncate text-xl font-semibold tracking-tight">{name}</h5>
          {task?.instruction ? (
            <p className="mt-1 text-sm text-muted-foreground">{task.instruction}</p>
          ) : null}
        </div>
        <StatusBadge tone={task?.status === "completed" ? "green" : "neutral"}>
          {task ? `${doneCount}/${photos.length}` : "…"}
        </StatusBadge>
      </div>
      {loading && !task ? (
        <div className="grid gap-3" role="status" aria-label="正在載入任務照片">
          <div className="aspect-square animate-pulse rounded-lg bg-muted" />
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : error ? (
        <RetryableError message={error} onRetry={onRefresh} />
      ) : currentPhoto ? (
        <>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
            <Button
              aria-label="上一張"
              disabled={safeIndex === 0}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => onPhotoIndexChange(safeIndex - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <strong className="text-center text-sm">
              第 {safeIndex + 1} / {photos.length} 張
            </strong>
            <Button
              aria-label="下一張"
              disabled={safeIndex >= photos.length - 1}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => onPhotoIndexChange(safeIndex + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <QuotePhotoReplyForm
            key={currentPhoto.id}
            photo={currentPhoto}
            taskType={task.task_type}
            onSubmitted={onSubmitted}
          />
        </>
      ) : (
        <EmptyState title="此任務暫無照片" body="請返回任務列表，或稍後重新載入。" />
      )}
    </Surface>
  );
}

function buildTaskNames(tasks: any[]) {
  const counters: Record<string, number> = {};
  const names = new Map<string, string>();
  for (const task of [...tasks].reverse()) {
    counters[task.task_type] = (counters[task.task_type] || 0) + 1;
    names.set(
      task.id,
      String(task.product_name || "").trim() ||
        `${taskTypeLabel(task.task_type)}任務 ${counters[task.task_type]}`,
    );
  }
  return names;
}

function taskDisplayName(task: any, tasks: any[]) {
  if (!task) return "細圖／報價任務";
  return buildTaskNames(tasks).get(task.id) || `${taskTypeLabel(task.task_type)}任務`;
}

function completedPhotoCount(photos: any[]) {
  return photos.filter((photo) =>
    ["converted_to_purchase", "replied"].includes(photo.reply_status),
  ).length;
}

function isQuoteTaskCompleted(task: any) {
  const photoCount = Number(task.photo_count || task.photos?.length || 0);
  const repliedPhotoCount = Number(task.replied_photo_count || 0);
  return task.status === "completed" || (photoCount > 0 && repliedPhotoCount >= photoCount);
}

function firstUnrepliedPhotoIndex(photos: any[]) {
  const index = photos.findIndex((photo) =>
    !["converted_to_purchase", "replied"].includes(photo.reply_status),
  );
  return index >= 0 ? index : 0;
}

function QuotePhotoReplyForm({
  onSubmitted,
  photo,
  taskType,
}: {
  onSubmitted?: (photoId: string, replyPatch?: any) => void;
  photo: any;
  taskType: string;
}) {
  const [detailPhotos, setDetailPhotos] = useState<DetailPhoto[]>([]);
  const uploadPromisesRef = useRef(new Map<string, PendingDetailUpload>());
  const [error, setError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => createClientId("quote-reply"));
  const [note, setNote] = useState(() => String(photo.latest_reply?.note || ""));
  const [pending, setPending] = useState(false);
  const [priceJpy, setPriceJpy] = useState(() =>
    photo.latest_reply?.price_jpy == null ? "" : String(photo.latest_reply.price_jpy),
  );
  const [isEditing, setIsEditing] = useState(() => !photo.latest_reply);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);

  function completeLocalSubmit(uploadedPhotos = detailPhotos) {
    const uploadedDetailPhotos = uploadedPhotos
      .filter((detailPhoto) => detailPhoto.status === "uploaded" && detailPhoto.storageKey)
      .map((detailPhoto) => ({
        byte_size: detailPhoto.byteSize,
        content_type: detailPhoto.contentType,
        original_filename: detailPhoto.originalFilename,
        signed_url: detailPhoto.objectUrl,
        sort_order: detailPhoto.sortOrder,
        storage_key: detailPhoto.storageKey,
      }));
    const nextDetailPhotos = uploadedDetailPhotos.length ? uploadedDetailPhotos : existingDetailPhotos;
    for (const detailPhoto of uploadedPhotos) URL.revokeObjectURL(detailPhoto.objectUrl);
    setDetailPhotos([]);
    setIsEditing(false);
    setIdempotencyKey(createClientId("quote-reply"));
    setJustSubmitted(true);
    onSubmitted?.(photo.id, {
      detail_photos: nextDetailPhotos,
      note: note.trim() || null,
      price_jpy: priceJpy.trim() ? Number(priceJpy) : null,
    });
  }

  const requiresPrice = taskType === "quote" || taskType === "quote_and_detail";
  const requiresDetail = taskType === "detail" || taskType === "quote_and_detail";
  const hasExistingReply = Boolean(photo.latest_reply);
  const isConverted = photo.reply_status === "converted_to_purchase";
  const formLocked = hasExistingReply && !isEditing;
  const showReplySummary = hasExistingReply && !isEditing;
  const showEditableFields = !formLocked && !isConverted;
  const existingDetailPhotos = Array.isArray(photo.latest_reply?.detail_photos)
    ? photo.latest_reply.detail_photos
    : [];
  const canSubmit =
    (!requiresPrice || priceJpy.trim().length > 0) &&
    (!requiresDetail || (detailPhotos.length ? detailPhotos.every((detailPhoto) => detailPhoto.status !== "failed") : hasExistingReply)) &&
    !formLocked &&
    !isConverted &&
    !pending;

  function addFiles(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files)
        .filter((file) => file.type.startsWith("image/"))
        .map((file, index) => ({
          byteSize: file.size,
          clientPhotoId: createClientId("detail"),
          contentType: file.type || "image/jpeg",
          file,
          objectUrl: URL.createObjectURL(file),
          originalFilename: file.name,
          sortOrder: detailPhotos.length + index,
          status: "selected" as const,
        }));
    setDetailPhotos((current) => [
      ...current,
      ...selected.map((photo, index) => ({ ...photo, sortOrder: current.length + index })),
    ]);
    for (const detailPhoto of selected) uploadDetailPhoto(detailPhoto);
  }

  function saveEditedPhoto(file: File) {
    if (!editingPhotoId) return;
    const currentPhoto = detailPhotos.find((detailPhoto) => detailPhoto.clientPhotoId === editingPhotoId);
    if (!currentPhoto) return;
    const editedPhoto: DetailPhoto = {
      ...currentPhoto,
      byteSize: file.size,
      contentType: file.type || "image/png",
      error: undefined,
      file,
      objectUrl: URL.createObjectURL(file),
      originalFilename: file.name,
      status: "selected",
      storageKey: undefined,
    };
    URL.revokeObjectURL(currentPhoto.objectUrl);
    setDetailPhotos((current) => current.map((detailPhoto) => {
      if (detailPhoto.clientPhotoId !== editingPhotoId) return detailPhoto;
      return editedPhoto;
    }));
    setEditingPhotoId(null);
    uploadDetailPhoto(editedPhoto);
  }

  function uploadDetailPhoto(detailPhoto: DetailPhoto) {
    void startDetailPhotoUpload(detailPhoto).catch(() => undefined);
  }

  function startDetailPhotoUpload(detailPhoto: DetailPhoto) {
    const existing = uploadPromisesRef.current.get(detailPhoto.clientPhotoId);
    if (existing && existing.file === detailPhoto.file) return existing.promise;
    const file = detailPhoto.file;
    setDetailPhotos((current) =>
      current.map((item) =>
        item.clientPhotoId === detailPhoto.clientPhotoId && item.file === file
          ? { ...item, error: undefined, status: "uploading" }
          : item,
      ),
    );
    const uploadPromise = (async () => {
      const preparedFile = await preparePhotoForUpload(detailPhoto.file);
      const presign = await fetch("/api/uploads/presign", {
        body: JSON.stringify({
          clientPhotoId: detailPhoto.clientPhotoId,
          contentType: preparedFile.type || detailPhoto.contentType,
          byteSize: preparedFile.size,
          fileName: detailPhoto.originalFilename,
          quoteTaskPhotoId: photo.id,
          uploadPurpose: "quote_detail_reply",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const presignBody = await presign.json();
      if (!presign.ok) throw new Error(presignBody.error || "無法建立上傳網址。");
      const upload = await fetch(presignBody.uploadUrl, {
        body: preparedFile,
        headers: { "content-type": preparedFile.type || detailPhoto.contentType },
        method: "PUT",
      });
      if (!upload.ok) throw new Error(`R2 上傳失敗 (${upload.status})。`);
      setDetailPhotos((current) =>
        current.map((item) =>
          item.clientPhotoId === detailPhoto.clientPhotoId && item.file === file
            ? { ...item, status: "uploaded", storageKey: presignBody.storageKey }
          : item,
        ),
      );
      return {
        byteSize: preparedFile.size,
        contentType: preparedFile.type || detailPhoto.contentType,
        error: undefined,
        status: "uploaded" as const,
        storageKey: presignBody.storageKey,
      };
    })()
      .then((uploaded) => {
        const pending = uploadPromisesRef.current.get(detailPhoto.clientPhotoId);
        if (pending?.file === file && pending.promise === uploadPromise) {
          uploadPromisesRef.current.delete(detailPhoto.clientPhotoId);
        }
        return uploaded;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "上傳失敗。";
        setDetailPhotos((current) =>
          current.map((item) =>
            item.clientPhotoId === detailPhoto.clientPhotoId && item.file === file
              ? { ...item, error: message, status: "failed" }
              : item,
          ),
        );
        const pending = uploadPromisesRef.current.get(detailPhoto.clientPhotoId);
        if (pending?.file === file && pending.promise === uploadPromise) {
          uploadPromisesRef.current.delete(detailPhoto.clientPhotoId);
        }
        throw error;
      });
    uploadPromisesRef.current.set(detailPhoto.clientPhotoId, { file, promise: uploadPromise });
    return uploadPromise;
  }

  function removeDetailPhoto(clientPhotoId: string) {
    if (editingPhotoId === clientPhotoId) setEditingPhotoId(null);
    setDetailPhotos((current) => {
      const removed = current.find((detailPhoto) => detailPhoto.clientPhotoId === clientPhotoId);
      if (removed) URL.revokeObjectURL(removed.objectUrl);
      uploadPromisesRef.current.delete(clientPhotoId);
      return current
        .filter((detailPhoto) => detailPhoto.clientPhotoId !== clientPhotoId)
        .map((detailPhoto, index) => ({ ...detailPhoto, sortOrder: index }));
    });
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError("");
    setPending(true);
    try {
      const uploadedPhotos = await Promise.all(
        detailPhotos.map(async (detailPhoto) => {
          if (detailPhoto.storageKey) return detailPhoto;
          const pendingUpload = uploadPromisesRef.current.get(detailPhoto.clientPhotoId);
          const uploaded = pendingUpload && pendingUpload.file === detailPhoto.file
            ? await pendingUpload.promise
            : await startDetailPhotoUpload(detailPhoto);
          return { ...detailPhoto, ...uploaded };
        }),
      );
      const uploadedDetailPhotos = uploadedPhotos
        .filter((detailPhoto) => detailPhoto.status === "uploaded" && detailPhoto.storageKey)
        .map((detailPhoto) => ({
          byteSize: detailPhoto.byteSize,
          contentType: detailPhoto.contentType,
          originalFilename: detailPhoto.originalFilename,
          sortOrder: detailPhoto.sortOrder,
          storageKey: detailPhoto.storageKey,
        }));
      const response = await fetch("/api/helper/quote-photo-replies", {
        body: JSON.stringify({
          detailPhotos: uploadedDetailPhotos,
          idempotencyKey,
          note,
          priceJpy,
          quoteTaskPhotoId: photo.id,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "送出失敗，請稍後再試。");
      completeLocalSubmit(uploadedPhotos);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "送出失敗，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-2xl border bg-background p-3 shadow-sm sm:p-4">
      <div className="grid gap-3">
        <PhotoViewerTrigger
          alt={photo.product_name || "quote task photo"}
          className="aspect-square rounded-xl"
          photo={photo}
        />
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={replyStatusTone(photo.reply_status)}>
              #{photo.sort_order + 1}
            </StatusBadge>
            {photo.needs_review ? <StatusBadge tone="amber">需確認</StatusBadge> : null}
            {hasExistingReply && !isConverted ? (
              <Button
                className="ml-auto h-8 px-2.5 text-xs"
                disabled={pending}
                size="sm"
                type="button"
                variant={isEditing ? "outline" : "secondary"}
                onClick={() => {
                  setJustSubmitted(false);
                  setIsEditing((current) => !current);
                }}
              >
                <Pencil className="size-3.5" />
                {isEditing ? "取消" : "修改"}
              </Button>
            ) : null}
          </div>
          {showReplySummary ? (
            <div className="grid gap-2 rounded-xl border border-emerald-300 bg-emerald-50/70 p-2 text-sm">
              {requiresPrice ? (
                <p className="font-medium text-emerald-800">
                  報價{photo.latest_reply.price_jpy != null ? ` ${photo.latest_reply.price_jpy}` : ""}
                </p>
              ) : (
                <p className="font-medium text-emerald-800">細節照</p>
              )}
              {photo.latest_reply.note ? <p className="text-emerald-900/80">{photo.latest_reply.note}</p> : null}
              {existingDetailPhotos.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {existingDetailPhotos.map((detailPhoto: any, index: number) => (
                    <PhotoViewerTrigger
                      alt={detailPhoto.original_filename || "detail reply"}
                      className="aspect-square rounded-lg border-2 border-emerald-400"
                      key={detailPhoto.storage_key || index}
                      photo={detailPhoto}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {requiresPrice && requiresDetail
                ? "報價＋細節照"
                : requiresPrice
                  ? "報價"
                  : "細節照"}
            </p>
          )}
        </div>
      </div>

      {justSubmitted ? (
        <div className="grid gap-3 rounded-xl border border-emerald-300 bg-emerald-50/80 p-4 text-sm text-emerald-950">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" />
            <div>
              <p className="font-semibold">已成功送出</p>
              <p className="mt-1 text-emerald-900/80">管理員現在可以看到這張照片的回覆。</p>
            </div>
          </div>
        </div>
      ) : null}

      {showEditableFields && requiresPrice ? (
        <label className="grid gap-1">
          <span className="text-sm font-medium">報價</span>
          <input
            inputMode="numeric"
            name="priceJpy"
            placeholder="例如 4980"
            disabled={formLocked || isConverted || pending}
            value={priceJpy}
            onChange={(event) => setPriceJpy(event.target.value)}
          />
        </label>
      ) : null}

      {showEditableFields && requiresDetail ? (
        <div className="grid gap-2">
          <div
            className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/40 p-3 text-center ${
              formLocked || isConverted || pending ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            }`}
          >
            <Camera className="size-5" aria-hidden="true" />
            <span className="text-sm">拍照或從相簿選擇</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-lg border bg-background px-3 text-sm font-medium">
              <Camera className="mr-2 size-4" aria-hidden="true" />
              拍照
              <PhotoFileInput
                className="sr-only"
                accept="image/*"
                capture="environment"
                disabled={formLocked || isConverted || pending}
                multiple
                onFiles={addFiles}
              />
            </label>
            <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-lg border bg-background px-3 text-sm font-medium">
              <ImageUp className="mr-2 size-4" aria-hidden="true" />
              從相簿選擇
              <PhotoFileInput
                className="sr-only"
                accept="image/*"
                disabled={formLocked || isConverted || pending}
                multiple
                onFiles={addFiles}
              />
            </label>
          </div>
          {detailPhotos.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {detailPhotos.map((detailPhoto) => (
                <div
                  key={detailPhoto.clientPhotoId}
                  className={`rounded-xl border bg-background p-2 ${
                    detailPhoto.status === "uploaded" ? "border-emerald-400" : ""
                  }`}
                >
                  <div className="relative">
                    <img
                      alt="細節照"
                      className="aspect-square w-full rounded-lg object-cover"
                      src={detailPhoto.objectUrl}
                    />
                    <span className="absolute left-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/70 text-xs font-semibold text-white">
                      {detailPhoto.sortOrder + 1}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm">
                      {detailPhoto.status === "uploaded" ? "" : statusLabel(detailPhoto.status)}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          aria-label="編輯細節照"
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                          disabled={formLocked || pending}
                          type="button"
                          onClick={() => setEditingPhotoId(detailPhoto.clientPhotoId)}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          aria-label="移除細節照"
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                          disabled={formLocked || pending}
                          type="button"
                          onClick={() => removeDetailPhoto(detailPhoto.clientPhotoId)}
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    </div>
                    {detailPhoto.error ? <p className="text-xs text-destructive">{detailPhoto.error}</p> : null}
                    {detailPhoto.status === "failed" ? (
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => uploadDetailPhoto(detailPhoto)}
                      >
                        <RefreshCw className="mr-2 size-4" />
                        重試上傳
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {showEditableFields ? (
        <form className="grid gap-3 border-t pt-3" onSubmit={submitReply}>
          <textarea
            name="note"
            placeholder="回覆備註，可留空"
            disabled={pending}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button disabled={!canSubmit} type="submit">
            送出
          </Button>
        </form>
      ) : null}

      {editingPhotoId ? (() => {
        const detailPhoto = detailPhotos.find((item) => item.clientPhotoId === editingPhotoId);
        return detailPhoto ? (
          <PhotoDraftEditor
            alt="細節照"
            file={detailPhoto.file}
            objectUrl={detailPhoto.objectUrl}
            onCancel={() => setEditingPhotoId(null)}
            onSaved={saveEditedPhoto}
          />
        ) : null;
      })() : null}
    </div>
  );
}

function taskTypeLabel(taskType: string) {
  if (taskType === "quote") return "報價";
  if (taskType === "detail") return "細圖";
  return "報價＋細圖";
}

function replyStatusLabel(status: string) {
  if (status === "replied") return "已回覆";
  if (status === "needs_review") return "需確認";
  if (status === "converted_to_purchase") return "已轉購買";
  return "待回覆";
}

function replyStatusTone(status: string): "amber" | "blue" | "green" | "neutral" | "red" {
  if (status === "replied" || status === "converted_to_purchase") return "green";
  if (status === "needs_review") return "amber";
  if (status === "open") return "blue";
  return "neutral";
}

function statusLabel(status: UploadStatus) {
  if (status === "selected") return "待上傳";
  if (status === "uploading") return "上傳中";
  if (status === "uploaded") return "";
  return "上傳失敗";
}

function createClientId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}-${randomUuid}`;
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}
