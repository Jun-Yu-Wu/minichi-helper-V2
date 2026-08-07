"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ChevronLeft, ChevronRight, PackageCheck, RefreshCw, ShoppingBag, X } from "lucide-react";

import { BackButton } from "../components/BackButton";
import { EmptyState, InsightBanner, StatusBadge, Surface } from "../components/OperationsUi";
import { RetryableError } from "../components/RetryableState";
import { Button } from "../components/ui/button";
import { PhotoFileInput } from "../components/PhotoFileInput";
import { PhotoViewerTrigger } from "../components/PhotoAnnotationEditor";
import { useTripSectionNavigation } from "./TripSectionSwitcher";
import { useStaleResource } from "../../src/lib/client-resource-cache";
import { preparePhotoForUpload } from "../../src/lib/client-photo-upload";

const REFRESH_MS = 8000;

type FaceCheckPhoto = {
  byteSize: number;
  clientPhotoId: string;
  contentType: string;
  error?: string;
  file: File;
  objectUrl: string;
  originalFilename: string;
  status: "selected" | "uploading" | "uploaded" | "failed";
  storageKey?: string;
};

type PurchaseResponseState = {
  error?: string;
  ok?: true;
  submissionId?: string;
  task?: any;
};

export function PurchaseTasks({ tripId }: { tripId: string }) {
  const navigation = useTripSectionNavigation();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [allPhotosLoading, setAllPhotosLoading] = useState(false);
  const [allPhotosLoaded, setAllPhotosLoaded] = useState(false);
  const updateActiveTask = useCallback((task: any) => {
    setActiveTask((current: any | null) => ({
      ...(current || {}),
      ...task,
      photos: current?.photos || task.photos || [],
    }));
    taskResource.setData((current = []) =>
      current.map((item) =>
        item.id === task.id || (item.batch_id && item.batch_id === task.purchase_batch?.id)
          ? { ...item, ...task, photos: [] }
          : item,
      ),
    );
  }, []);

  const loadTasks = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(
      `/api/helper/trips/${encodeURIComponent(tripId)}/purchase-tasks`,
      { cache: "no-store", signal },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "無法載入採買任務。");
    return (body.tasks || []) as any[];
  }, [tripId]);
  const taskResource = useStaleResource<any[]>({
    enabled: true,
    fetcher: loadTasks,
    key: `helper:purchase-tasks:${tripId}`,
    refreshIntervalMs: activeTaskId ? 0 : REFRESH_MS,
    staleTimeMs: 5_000,
  });
  const tasks = taskResource.data || [];

  function findSummaryTask(taskId: string) {
    return tasks.find((task) =>
      task.id === taskId ||
      task.representative_task_id === taskId ||
      (Array.isArray(task.batch_task_ids) && task.batch_task_ids.includes(taskId)),
    );
  }

  async function openTask(taskId: string) {
    setActiveTaskId(taskId);
    setActiveTask(null);
    setDetailError("");
    setDetailLoading(true);
    setAllPhotosLoaded(false);
    setAllPhotosLoading(false);
    const summaryTask = findSummaryTask(taskId);
    const detailTaskId = summaryTask?.representative_task_id || taskId;
    const loadsReturnedPhotos = shouldLoadReturnedPhotos(summaryTask);
    const photoMode = loadsReturnedPhotos ? "?photoMode=all" : "";
    try {
      const response = await fetch(
        `/api/helper/trips/${encodeURIComponent(summaryTask?.trip_id || tripId)}/purchase-tasks/${encodeURIComponent(detailTaskId)}${photoMode}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "無法載入採買任務。");
      setActiveTask(body.task || null);
      setAllPhotosLoaded(loadsReturnedPhotos);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "無法載入採買任務。");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeTask() {
    setActiveTaskId(null);
    setActiveTask(null);
    setDetailError("");
    setDetailLoading(false);
    setAllPhotosLoaded(false);
    setAllPhotosLoading(false);
  }

  async function loadAllTaskPhotos() {
    if (!activeTaskId || allPhotosLoaded) return;
    const summaryTask = findSummaryTask(activeTaskId);
    const detailTaskId = summaryTask?.representative_task_id || activeTaskId;
    setAllPhotosLoading(true);
    setDetailError("");
    try {
      const response = await fetch(
        `/api/helper/trips/${encodeURIComponent(summaryTask?.trip_id || activeTask?.trip_id || tripId)}/purchase-tasks/${encodeURIComponent(detailTaskId)}?photoMode=all`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "無法載入採買任務照片。");
      setActiveTask((current: any | null) => ({
        ...(current || {}),
        ...(body.task || {}),
      }));
      setAllPhotosLoaded(true);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "無法載入採買任務照片。");
    } finally {
      setAllPhotosLoading(false);
    }
  }

  if (activeTaskId) {
    const summaryTask = findSummaryTask(activeTaskId);
    return (
      <PurchaseTaskDetail
        error={detailError}
        loading={detailLoading}
        task={activeTask || (!detailLoading && !detailError ? summaryTask : null)}
        allPhotosLoaded={allPhotosLoaded}
        allPhotosLoading={allPhotosLoading}
        onBack={closeTask}
        onLoadAllPhotos={loadAllTaskPhotos}
        onRefresh={() => openTask(activeTaskId)}
        onTaskUpdated={updateActiveTask}
      />
    );
  }

  if (!tasks.length) {
    return (
      <Surface className="grid gap-4">
        <BackButton
          label="返回連線"
          onClick={() => navigation?.openWork()}
          type="button"
          variant="outline"
        />
        {taskResource.isLoading ? (
          <div className="grid gap-2" aria-label="正在載入採買任務" role="status">
            <div className="h-20 animate-pulse rounded-xl bg-muted" />
            <div className="h-20 animate-pulse rounded-xl bg-muted" />
          </div>
        ) : taskResource.error ? (
          <RetryableError message={taskResource.error} onRetry={() => void taskResource.refresh()} />
        ) : (
          <div className="rounded-xl border border-dashed bg-card p-5 text-sm shadow-sm">
            <p className="font-semibold text-foreground">目前沒有採買任務</p>
          </div>
        )}
      </Surface>
    );
  }
  const taskGroups = [
    {
      emptyText: "目前沒有未完成採買任務。",
      tasks: tasks.filter((task) => !isFaceCheckReviewTask(task) && !isCompletedTask(task) && !isCanceledTask(task)),
      title: "未完成",
    },
    {
      emptyText: "目前沒有挑臉審核中的任務。",
      tasks: tasks.filter(isFaceCheckReviewTask),
      title: "挑臉審核中",
    },
    {
      emptyText: "目前沒有已完成採買任務。",
      tasks: tasks.filter(isCompletedTask),
      title: "已完成",
    },
    {
      emptyText: "目前沒有取消採買任務。",
      tasks: tasks.filter(isCanceledTask),
      title: "取消",
    },
  ];
  return (
    <Surface className="grid gap-4">
      <BackButton label="返回連線" onClick={() => navigation?.openWork()} type="button" variant="outline" />
      {taskResource.error ? (
        <RetryableError message={taskResource.error} onRetry={() => void taskResource.refresh()} />
      ) : null}
      <div className="grid gap-4">
        {taskGroups.map((group) => (
          <PurchaseTaskGroup
            emptyText={group.emptyText}
            key={group.title}
            tasks={group.tasks}
            title={group.title}
            onOpenTask={openTask}
          />
        ))}
      </div>
    </Surface>
  );
}

function PurchaseTaskGroup({
  emptyText,
  onOpenTask,
  tasks,
  title,
}: {
  emptyText: string;
  onOpenTask: (taskId: string) => void;
  tasks: any[];
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-xs font-medium text-muted-foreground">{tasks.length} 筆</span>
      </div>
      {tasks.length ? (
        <div className="grid gap-2">
          {tasks.map((task) => (
            <PurchaseTaskCard
              key={task.id}
              task={task}
              onOpenTask={() => onOpenTask(task.representative_task_id || task.id)}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{emptyText}</p>
      )}
    </section>
  );
}

function PurchaseTaskCard({
  onOpenTask,
  task,
}: {
  onOpenTask: (taskId: string) => void;
  task: any;
}) {
  const tone = purchaseTaskTone(task);
  return (
    <button
      className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-accent/30 ${
        tone === "green"
          ? "border-emerald-200 bg-emerald-50/60"
          : tone === "red"
            ? "border-red-200 bg-red-50/60"
            : "bg-background"
      }`}
      type="button"
      onClick={() => onOpenTask(task.id)}
    >
      <span className="min-w-0">
        <strong className="block truncate text-base">{purchaseTaskDisplayTitle(task)}</strong>
      </span>
      <StatusBadge tone={tone}>
        {purchaseProgress(task)}
      </StatusBadge>
    </button>
  );
}

function PurchaseTaskDetail({
  allPhotosLoaded,
  allPhotosLoading,
  error,
  loading,
  onBack,
  onLoadAllPhotos,
  onRefresh,
  task,
  onTaskUpdated,
}: {
  allPhotosLoaded: boolean;
  allPhotosLoading: boolean;
  error: string;
  loading: boolean;
  onBack: () => void;
  onLoadAllPhotos: () => void;
  onRefresh: () => void;
  onTaskUpdated: (task: any) => void;
  task: any | null;
}) {
  const completed = task ? isCompletedTask(task) : false;
  const productPhotos = task ? productPurchasePhotos(task.photos || []) : [];
  const returnedPhotos = task ? returnedPurchasePhotos(task.photos || []) : [];
  const primaryPhotos = task && shouldPreferReturnedPhotos(task) && returnedPhotos.length
    ? returnedPhotos
    : productPhotos;
  const primaryPhotoIds = new Set(primaryPhotos.map((photo: any) => photo.id));
  const hiddenPhotos = task
    ? secondaryPurchasePhotos(task.photos || []).filter((photo: any) => !primaryPhotoIds.has(photo.id))
    : [];
  const faceCheckPhoto = task ? latestFaceCheckPhoto(task.photos || []) : null;
  const isCanceled = task ? isCanceledTask(task) : false;
  return (
    <Surface className="grid gap-3">
      <BackButton label="返回任務列表" onClick={onBack} type="button" />
      {loading && !task ? (
        <div className="grid gap-3" role="status" aria-label="正在載入採買任務">
          <div className="aspect-square animate-pulse rounded-lg bg-muted" />
          <div className="h-28 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : error ? (
        <RetryableError message={error} onRetry={onRefresh} />
      ) : task ? (
        <>
          {isCanceled ? (
            <CanceledPurchaseTaskView task={task} photos={primaryPhotos} />
          ) : (
            <>
              <TaskProductHeader task={task} />
              <section className="grid gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {task.status === "approved_pending_helper_confirmation" && faceCheckPhoto ? "挑臉確認照" : "商品圖片"}
                </p>
                {task.status === "approved_pending_helper_confirmation" && faceCheckPhoto ? (
                  <LatestFaceCheckPhoto photo={faceCheckPhoto} />
                ) : (
                  <PurchaseTaskPhotos photos={primaryPhotos} />
                )}
              </section>
              <section className="grid gap-3 rounded-xl border bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">採買資訊</p>
                  <StatusBadge tone={purchaseTaskTone(task)}>{purchaseStatusLabel(task)}</StatusBadge>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <Meta label="需採買" value={`${purchaseTaskRequestedQuantity(task)} 件`} />
                  <Meta label="原價" value={`JPY ${task.original_price_jpy ?? "-"}`} />
                </dl>
                {task.note ? (
                  <div className="rounded-lg bg-muted/45 px-3 py-2 text-sm">
                    <p className="text-xs font-medium text-muted-foreground">管理員備註</p>
                    <p className="mt-1 leading-6 text-foreground">{task.note}</p>
                  </div>
                ) : null}
              </section>
              {completed ? (
                <SecondaryPurchasePhotos
                  allPhotosLoaded={allPhotosLoaded}
                  loading={allPhotosLoading}
                  photos={hiddenPhotos}
                  onLoad={onLoadAllPhotos}
                />
              ) : null}
              <PurchaseResponseForm task={task} onTaskUpdated={onTaskUpdated} />
            </>
          )}
        </>
      ) : (
        <EmptyState title="找不到這個採買任務" body="請返回任務列表重新選擇。" />
      )}
    </Surface>
  );
}

function TaskProductHeader({ task }: { task: any }) {
  return (
    <header className="rounded-xl border bg-background p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <ShoppingBag className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground">商品名稱</p>
          <h3 className="mt-1 text-2xl font-semibold leading-tight tracking-tight">{purchaseTaskDisplayTitle(task)}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{purchaseTaskPrimaryInstruction(task)}</p>
        </div>
      </div>
    </header>
  );
}

function CanceledPurchaseTaskView({ photos, task }: { photos: any[]; task: any }) {
  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center text-red-950">
        <p className="text-xs font-semibold text-red-700">商品名稱</p>
        <h3 className="mt-1 text-2xl font-semibold tracking-tight">{purchaseTaskDisplayTitle(task)}</h3>
        <div className="mt-4 inline-flex min-h-10 items-center rounded-full border border-red-300 bg-background px-4 py-2 text-base font-semibold text-red-800">
          已取消
        </div>
      </div>
      <PurchaseTaskPhotos photos={photos} />
    </div>
  );
}

function PurchaseTaskPhotos({ photos }: { photos: any[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  if (!photos.length) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        參考照片加載中...
      </p>
    );
  }
  const activePhoto = photos[Math.min(activeIndex, photos.length - 1)] || photos[0];
  if (photos.length === 1) {
    return (
      <div className="flex justify-center">
        <PhotoViewerTrigger
          alt={activePhoto.photo_role}
          className="aspect-square w-full max-w-sm rounded-xl border shadow-sm"
          photo={activePhoto}
        />
      </div>
    );
  }
  return (
    <div className="mx-auto grid w-full max-w-sm gap-2">
      <div className="relative">
        <PhotoViewerTrigger
          alt={activePhoto.photo_role}
          className="aspect-square w-full rounded-xl border shadow-sm"
          photo={activePhoto}
        />
        <Button
          aria-label="上一張照片"
          className="absolute left-2 top-1/2 size-9 -translate-y-1/2 rounded-full bg-background/90 p-0 shadow"
          disabled={activeIndex === 0}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => setActiveIndex((index) => Math.max(index - 1, 0))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          aria-label="下一張照片"
          className="absolute right-2 top-1/2 size-9 -translate-y-1/2 rounded-full bg-background/90 p-0 shadow"
          disabled={activeIndex >= photos.length - 1}
          size="sm"
          type="button"
          variant="outline"
          onClick={() => setActiveIndex((index) => Math.min(index + 1, photos.length - 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2 py-1 text-xs font-semibold text-white">
          {activeIndex + 1}/{photos.length}
        </span>
      </div>
      <div className="flex justify-center gap-1.5">
        {photos.map((photo, index) => (
          <button
            aria-label={`查看第 ${index + 1} 張照片`}
            className={`size-2 rounded-full ${index === activeIndex ? "bg-foreground" : "bg-muted-foreground/35"}`}
            key={photo.id}
            type="button"
            onClick={() => setActiveIndex(index)}
          />
        ))}
      </div>
    </div>
  );
}

function LatestFaceCheckPhoto({ photo }: { photo: any | null }) {
  if (!photo) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        目前沒有挑臉確認照。
      </p>
    );
  }
  return (
    <div className="flex justify-center">
      <PhotoViewerTrigger
        alt="挑臉確認照"
        className="aspect-square w-full max-w-sm rounded-xl border shadow-sm"
        photo={photo}
      />
    </div>
  );
}

function SecondaryPurchasePhotos({
  allPhotosLoaded,
  loading,
  onLoad,
  photos,
}: {
  allPhotosLoaded: boolean;
  loading: boolean;
  onLoad: () => void;
  photos: any[];
}) {
  if (!allPhotosLoaded) {
    return (
      <Button className="w-fit" disabled={loading} size="sm" type="button" variant="outline" onClick={onLoad}>
        {loading ? "載入中..." : "查看細圖／回報照片"}
      </Button>
    );
  }
  if (!photos.length) return null;
  return (
    <div className="grid gap-2 rounded-xl border bg-muted/20 p-3">
      <p className="text-sm font-semibold">細圖／回報照片</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {photos.map((photo, index) => (
          <div className="relative" key={photo.id}>
            <PhotoViewerTrigger
              alt={photo.photo_role}
              className="aspect-square rounded-lg border"
              photo={photo}
            />
            <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-xs font-semibold text-white">
              {secondaryPhotoLabel(photo.photo_role, index)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PurchaseResponseForm({ task, onTaskUpdated }: { task: any; onTaskUpdated: (task: any) => void }) {
  const aggregateBatch = Boolean((task.purchase_batch_id || task.batch_id) && !task.requires_face_check);
  const batch = task.purchase_batch || null;
  const batchStatus = aggregateBatch ? batch?.status || task.batch_status || task.status : task.status;
  const batchReportedQuantity = aggregateBatch
    ? Number(batch?.reported_quantity ?? task.batch_reported_quantity ?? 0)
    : Number(task.completed_quantity || 0);
  const initialRequestedQuantity = Math.max(
    1,
    Number(aggregateBatch ? batch?.requested_quantity ?? task.batch_requested_quantity : task.quantity || 1),
  );
  const initialCompletedQuantity = Math.max(0, Number(task.completed_quantity || 0));
  const initialQuantitySelection = aggregateBatch
    ? Math.max(0, initialRequestedQuantity - batchReportedQuantity)
    : task.requires_face_check
      ? initialCompletedQuantity || initialRequestedQuantity
      : Math.max(0, initialRequestedQuantity - initialCompletedQuantity);
  const [state, setState] = useState<PurchaseResponseState>({});
  const [pending, setPending] = useState(false);
  const [completedQuantity, setCompletedQuantity] = useState(String(initialQuantitySelection));
  const [helperNote, setHelperNote] = useState("");
  const [faceCheckPhoto, setFaceCheckPhoto] = useState<FaceCheckPhoto | null>(null);
  const [reportPhotos, setReportPhotos] = useState<FaceCheckPhoto[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => createClientId("purchase-response"));
  const [cancelingCompleted, setCancelingCompleted] = useState(false);
  const faceCheckUploadPromises = useRef(new Map<string, Promise<FaceCheckPhoto>>());
  const reportUploadPromises = useRef(new Map<string, Promise<FaceCheckPhoto>>());
  const faceCheckPhotoRef = useRef<FaceCheckPhoto | null>(null);
  const reportPhotosRef = useRef<FaceCheckPhoto[]>([]);

  useEffect(() => {
    faceCheckPhotoRef.current = faceCheckPhoto;
    reportPhotosRef.current = reportPhotos;
  }, [faceCheckPhoto, reportPhotos]);

  useEffect(() => () => {
    if (faceCheckPhotoRef.current) URL.revokeObjectURL(faceCheckPhotoRef.current.objectUrl);
    for (const photo of reportPhotosRef.current) URL.revokeObjectURL(photo.objectUrl);
  }, []);

  useEffect(() => {
    if (state.ok && state.task && state.submissionId === idempotencyKey) {
      onTaskUpdated(state.task);
    }
  }, [idempotencyKey, onTaskUpdated, state]);

  useEffect(() => {
    const latestRequestedQuantity = Math.max(
      1,
      Number(aggregateBatch ? batch?.requested_quantity ?? task.batch_requested_quantity : task.quantity || 1),
    );
    const latestCompletedQuantity = Math.max(0, Number(task.completed_quantity || 0));
    const latestSelection = aggregateBatch
      ? Math.max(
          0,
          latestRequestedQuantity - Number(batch?.reported_quantity ?? task.batch_reported_quantity ?? 0),
        )
      : task.requires_face_check
        ? latestCompletedQuantity || latestRequestedQuantity
        : Math.max(0, latestRequestedQuantity - latestCompletedQuantity);
    setCompletedQuantity(String(latestSelection));
  }, [aggregateBatch, batch?.reported_quantity, batch?.requested_quantity, task.batch_reported_quantity, task.batch_requested_quantity, task.completed_quantity, task.quantity, task.requires_face_check]);

  const faceCheckPhotoJson = useMemo(
    () =>
      faceCheckPhoto?.status === "uploaded" && faceCheckPhoto.storageKey
        ? JSON.stringify({
            byteSize: faceCheckPhoto.byteSize,
            contentType: faceCheckPhoto.contentType,
            originalFilename: faceCheckPhoto.originalFilename,
            storageKey: faceCheckPhoto.storageKey,
          })
        : "",
    [faceCheckPhoto],
  );

  const statusTask = aggregateBatch ? { ...task, status: batchStatus, batch_status: batchStatus } : task;
  const completed = aggregateBatch ? batchStatus === "completed" : task.status === "completed";
  const closed = aggregateBatch
    ? ["canceled", "completed"].includes(batchStatus)
    : ["canceled", "unavailable", "not_found", "review_pending"].includes(task.status);
  const needsFinalConfirmation = task.status === "approved_pending_helper_confirmation";
  const submitted = Boolean(state.ok && state.submissionId === idempotencyKey);
  const requestedQuantity = Math.max(
    1,
    Number(aggregateBatch ? batch?.requested_quantity ?? task.batch_requested_quantity : task.quantity || 1),
  );
  const previouslyCompletedQuantity = aggregateBatch
    ? batchReportedQuantity
    : Math.max(0, Math.min(Number(task.completed_quantity || 0), requestedQuantity));
  const usesIncrementalQuantity = aggregateBatch || (!task.requires_face_check && task.status === "open");
  const remainingQuantity = Math.max(0, requestedQuantity - previouslyCompletedQuantity);
  const selectedQuantityNumber = Math.max(
    0,
    Math.min(Number(completedQuantity || 0), usesIncrementalQuantity ? remainingQuantity : requestedQuantity),
  );
  const completedQuantityNumber = usesIncrementalQuantity
    ? Math.min(requestedQuantity, previouslyCompletedQuantity + selectedQuantityNumber)
    : selectedQuantityNumber;
  const effectivePurchaseAction = aggregateBatch
    ? "complete"
    : (completed && cancelingCompleted) || (completedQuantityNumber === 0 && previouslyCompletedQuantity === 0) ? "cancel" : "complete";
  const needsCancelReason = effectivePurchaseAction === "cancel";
  const needsFaceCheckUpload = !aggregateBatch && task.requires_face_check && task.status === "open" && effectivePurchaseAction === "complete";
  const canSubmit =
    !pending &&
    !submitted &&
    (!closed || needsFinalConfirmation) &&
    (!completed || cancelingCompleted) &&
    (!needsCancelReason || Boolean(helperNote.trim())) &&
    (!needsFaceCheckUpload || ["selected", "uploading", "uploaded"].includes(String(faceCheckPhoto?.status || ""))) &&
    !reportPhotos.some((photo) => photo.status === "failed") &&
    selectedQuantityNumber <= (usesIncrementalQuantity ? remainingQuantity : requestedQuantity);

  function addFaceCheckPhoto(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (faceCheckPhoto) URL.revokeObjectURL(faceCheckPhoto.objectUrl);
    const nextPhoto: FaceCheckPhoto = {
      byteSize: file.size,
      clientPhotoId: createClientId("face-check"),
      contentType: file.type || "image/jpeg",
      file,
      objectUrl: URL.createObjectURL(file),
      originalFilename: file.name || "face-check.jpg",
      status: "selected",
    };
    setFaceCheckPhoto(nextPhoto);
    void uploadFaceCheckPhoto(nextPhoto).catch(() => undefined);
  }

  async function uploadFaceCheckPhoto(photo = faceCheckPhoto): Promise<FaceCheckPhoto | null> {
    if (!photo) return null;
    if (photo.status === "uploaded" && photo.storageKey) return photo;
    const existingUpload = faceCheckUploadPromises.current.get(photo.clientPhotoId);
    if (existingUpload) return existingUpload;
    setFaceCheckPhoto((current) =>
      current?.clientPhotoId === photo.clientPhotoId
        ? { ...current, error: undefined, status: "uploading" }
        : current,
    );
    const uploadPromise = (async () => {
      const preparedFile = await preparePhotoForUpload(photo.file);
      const contentType = preparedFile.type || photo.contentType;
      const presign = await fetch("/api/uploads/presign", {
        body: JSON.stringify({
          clientPhotoId: photo.clientPhotoId,
          contentType,
          byteSize: preparedFile.size,
          fileName: photo.originalFilename,
          purchaseTaskId: task.id,
          uploadPurpose: "purchase_face_check",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const presignBody = await presign.json();
      if (!presign.ok) throw new Error(presignBody.error || "無法建立上傳網址。");
      const upload = await fetch(presignBody.uploadUrl, {
        body: preparedFile,
        headers: { "content-type": contentType },
        method: "PUT",
      });
      if (!upload.ok) throw new Error(`R2 上傳失敗 (${upload.status})。`);
      const uploadedPhoto = {
        ...photo,
        byteSize: preparedFile.size,
        contentType,
        status: "uploaded" as const,
        storageKey: presignBody.storageKey,
      };
      setFaceCheckPhoto((current) =>
        current?.clientPhotoId === photo.clientPhotoId
          ? uploadedPhoto
          : current,
      );
      return uploadedPhoto;
    })();
    faceCheckUploadPromises.current.set(photo.clientPhotoId, uploadPromise);
    try {
      return await uploadPromise;
    } catch (error) {
      setFaceCheckPhoto((current) =>
        current?.clientPhotoId === photo.clientPhotoId
          ? {
              ...current,
              error: error instanceof Error ? error.message : "上傳失敗。",
              status: "failed",
            }
          : current,
      );
      throw error;
    } finally {
      faceCheckUploadPromises.current.delete(photo.clientPhotoId);
    }
  }

  function addReportPhotos(fileList: FileList | null) {
    if (!fileList || task.requires_face_check || task.status !== "open") return;
    const availableSlots = Math.max(0, 6 - reportPhotos.length);
    const selected = Array.from(fileList)
      .filter(isPurchaseReportImageFile)
      .slice(0, availableSlots)
      .map((file) => ({
        byteSize: file.size,
        clientPhotoId: createClientId("purchase-report"),
        contentType: inferPurchaseReportContentType(file),
        file,
        objectUrl: URL.createObjectURL(file),
        originalFilename: file.name || "purchase-report.jpg",
        status: "selected" as const,
      }));
    if (!selected.length) return;
    setReportPhotos((current) => [...current, ...selected].slice(0, 6));
    for (const photo of selected) void uploadReportPhoto(photo).catch(() => undefined);
  }

  async function uploadReportPhoto(photo: FaceCheckPhoto): Promise<FaceCheckPhoto> {
    if (photo.status === "uploaded" && photo.storageKey) return photo;
    const existingUpload = reportUploadPromises.current.get(photo.clientPhotoId);
    if (existingUpload) return existingUpload;
    setReportPhotos((current) => current.map((item) =>
      item.clientPhotoId === photo.clientPhotoId
        ? { ...item, error: undefined, status: "uploading" }
        : item,
    ));
    const uploadPromise = (async () => {
      const preparedFile = await preparePhotoForUpload(photo.file);
      const contentType = preparedFile.type || photo.contentType;
      const presign = await fetch("/api/uploads/presign", {
        body: JSON.stringify({
          byteSize: preparedFile.size,
          clientPhotoId: photo.clientPhotoId,
          contentType,
          fileName: photo.originalFilename,
          purchaseTaskId: task.id,
          tripId: task.trip_id,
          uploadPurpose: "purchase_report",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const presignBody = await presign.json();
      if (!presign.ok) throw new Error(presignBody.error || "無法建立上傳網址。");
      const upload = await fetch(presignBody.uploadUrl, {
        body: preparedFile,
        headers: { "content-type": contentType },
        method: "PUT",
      });
      if (!upload.ok) throw new Error(`R2 上傳失敗 (${upload.status})。`);
      const uploadedPhoto = {
        ...photo,
        byteSize: preparedFile.size,
        contentType,
        status: "uploaded" as const,
        storageKey: presignBody.storageKey,
      };
      setReportPhotos((current) => current.map((item) =>
        item.clientPhotoId === photo.clientPhotoId ? uploadedPhoto : item,
      ));
      return uploadedPhoto;
    })();
    reportUploadPromises.current.set(photo.clientPhotoId, uploadPromise);
    try {
      return await uploadPromise;
    } catch (error) {
      setReportPhotos((current) => current.map((item) =>
        item.clientPhotoId === photo.clientPhotoId
          ? { ...item, error: error instanceof Error ? error.message : "上傳失敗。", status: "failed" }
          : item,
      ));
      throw error;
    } finally {
      reportUploadPromises.current.delete(photo.clientPhotoId);
    }
  }

  function removeReportPhoto(clientPhotoId: string) {
    setReportPhotos((current) => {
      const removed = current.find((photo) => photo.clientPhotoId === clientPhotoId);
      if (removed) URL.revokeObjectURL(removed.objectUrl);
      reportUploadPromises.current.delete(clientPhotoId);
      return current.filter((photo) => photo.clientPhotoId !== clientPhotoId);
    });
  }

  function removeFaceCheckPhoto() {
    if (faceCheckPhoto) URL.revokeObjectURL(faceCheckPhoto.objectUrl);
    setFaceCheckPhoto(null);
  }

  async function submitPurchaseResponse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setState({});
    try {
      const uploadedFaceCheckPhoto = needsFaceCheckUpload
        ? await uploadFaceCheckPhoto(faceCheckPhoto)
        : faceCheckPhoto;
      const faceCheckPhotoPayload =
        uploadedFaceCheckPhoto?.status === "uploaded" && uploadedFaceCheckPhoto.storageKey
          ? {
              byteSize: uploadedFaceCheckPhoto.byteSize,
              contentType: uploadedFaceCheckPhoto.contentType,
              originalFilename: uploadedFaceCheckPhoto.originalFilename,
              storageKey: uploadedFaceCheckPhoto.storageKey,
            }
          : null;
      const uploadedReportPhotos = await Promise.all(
        reportPhotos.map((photo) => uploadReportPhoto(photo)),
      );
      const reportPhotoPayload = uploadedReportPhotos.map((photo, index) => ({
        byteSize: photo.byteSize,
        contentType: photo.contentType,
        originalFilename: photo.originalFilename,
        sortOrder: index,
        storageKey: photo.storageKey,
      }));
      if (needsFaceCheckUpload && !faceCheckPhotoPayload) {
        throw new Error("請先選擇挑臉確認照。");
      }
      const response = await fetch(
        aggregateBatch ? "/api/helper/purchase-batch-responses" : "/api/helper/purchase-task-responses",
        {
        body: JSON.stringify({
          completedQuantity,
          faceCheckPhoto: faceCheckPhotoPayload,
          helperNote,
          idempotencyKey,
          purchaseAction: needsFinalConfirmation ? "complete" : effectivePurchaseAction,
          purchaseBatchId: aggregateBatch ? task.purchase_batch_id : undefined,
          purchaseTaskId: task.id,
          reportPhotos: reportPhotoPayload,
          unavailableQuantity: effectivePurchaseAction === "complete"
            ? Math.max(0, requestedQuantity - completedQuantityNumber)
            : task.quantity,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "操作失敗，請稍後再試。");
      setState({ ok: true, submissionId: idempotencyKey, task: body.task });
      if (body.task) onTaskUpdated(body.task);
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "操作失敗，請稍後再試。" });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="grid gap-4 rounded-xl border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">回報結果</p>
          <p className="mt-1 text-sm text-muted-foreground">{purchaseResponseHelpText(task, cancelingCompleted)}</p>
        </div>
        <StatusBadge tone={purchaseTaskTone(statusTask)}>{purchaseStatusLabel(statusTask)}</StatusBadge>
      </div>
      <PurchaseTaskStateNotice task={statusTask} />
      {closed && task.helper_note ? (
        <div className="rounded-lg bg-muted/45 px-3 py-2 text-sm">
          <p className="text-xs font-medium text-muted-foreground">小幫手備註</p>
          <p className="mt-1 leading-6 text-foreground">{task.helper_note}</p>
        </div>
      ) : null}
      {completed && !cancelingCompleted && !aggregateBatch ? (
        <Button className="w-full" type="button" variant="outline" onClick={() => {
          setCancelingCompleted(true);
          setHelperNote("");
          setIdempotencyKey(createClientId("purchase-cancel"));
        }}>
          取消這筆採買
        </Button>
      ) : null}
      {(!closed && !completed) || needsFinalConfirmation || cancelingCompleted ? (
        <>
          {(!cancelingCompleted && !needsFinalConfirmation) || effectivePurchaseAction === "complete" || needsFinalConfirmation ? (
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{aggregateBatch ? "整批實際買到數量" : "實際買到數量"}</span>
                <select
                  name="completedQuantityVisible"
                  value={completedQuantity}
                  onChange={(event) => setCompletedQuantity(event.target.value)}
                >
                  {Array.from(
                    { length: (usesIncrementalQuantity ? remainingQuantity : requestedQuantity) + 1 },
                    (_, index) => index,
                  ).map((quantity) => (
                    <option key={quantity} value={quantity}>
                      {quantity === 0 ? "0（取消）" : quantity}
                    </option>
                  ))}
                </select>
              <span className="text-xs text-muted-foreground">
                {!aggregateBatch && completedQuantityNumber === 0 && previouslyCompletedQuantity === 0
                  ? "選 0 會取消這筆採買；請填寫取消理由。"
                  : null}
              </span>
            </label>
          ) : null}

          {needsFaceCheckUpload ? (
            <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div>
                <p className="text-sm font-semibold text-amber-950">挑臉確認照</p>
                <p className="mt-1 text-xs leading-5 text-amber-900/80">上傳後會送給管理員審核，審核通過後再回來確認完成。</p>
              </div>
              <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-background/70 p-3 text-center">
                <Camera className="size-5" aria-hidden="true" />
                <span className="text-sm">選擇挑臉確認照</span>
                <PhotoFileInput
                  className="sr-only"
                  accept="image/*"
                  onFiles={addFaceCheckPhoto}
                />
              </label>
              {faceCheckPhoto ? (
                <div className={`grid gap-2 rounded-md border p-2 ${faceCheckPhoto.status === "uploaded" ? "border-emerald-400 bg-emerald-50/40" : "bg-background"}`}>
                  <img alt="挑臉確認照" className="aspect-square w-full max-w-48 rounded-md object-cover" src={faceCheckPhoto.objectUrl} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {faceCheckPhoto.status !== "uploaded" ? (
                      <Button disabled={faceCheckPhoto.status === "uploading"} size="sm" type="button" variant="outline" onClick={() => uploadFaceCheckPhoto()}>
                        <RefreshCw className="mr-2 size-4" />
                        {faceCheckPhoto.status === "uploading" ? "上傳中" : "重試上傳"}
                      </Button>
                    ) : null}
                    <Button size="sm" type="button" variant="ghost" onClick={removeFaceCheckPhoto}>
                      <X className="mr-2 size-4" />
                      移除
                    </Button>
                  </div>
                  {faceCheckPhoto.error ? <p className="mt-1 text-xs text-destructive">{faceCheckPhoto.error}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {!task.requires_face_check && task.status === "open" && effectivePurchaseAction === "complete" ? (
            <div className="grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
              <div>
                <p className="text-sm font-semibold text-emerald-950">採買回報照片（選填）</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed bg-background/80 p-2 text-center">
                  <Camera className="size-4" aria-hidden="true" />
                  <span className="text-sm">拍照</span>
                  <PhotoFileInput
                    capture="environment"
                    className="sr-only"
                    accept="image/*"
                    onFiles={addReportPhotos}
                  />
                </label>
                <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed bg-background/80 p-2 text-center">
                  <span className="text-sm">從相簿選取</span>
                  <PhotoFileInput
                    className="sr-only"
                    accept="image/*"
                    multiple
                    onFiles={addReportPhotos}
                  />
                </label>
              </div>
              {reportPhotos.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {reportPhotos.map((photo) => (
                    <div className={`grid gap-1 rounded-md border p-2 ${photo.status === "uploaded" ? "border-emerald-400 bg-emerald-50/80" : photo.status === "failed" ? "border-red-300 bg-red-50" : "bg-background"}`} key={photo.clientPhotoId}>
                      <img alt="採買回報照片" className="aspect-square w-full rounded-md object-cover" src={photo.objectUrl} />
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs text-muted-foreground">{purchasePhotoUploadStatusLabel(photo.status)}</span>
                        <div className="flex items-center gap-1">
                          {photo.status === "failed" ? (
                            <button className="rounded px-1.5 py-1 text-xs font-medium text-primary hover:bg-muted" type="button" onClick={() => void uploadReportPhoto(photo).catch(() => undefined)}>
                              重試
                            </button>
                          ) : null}
                          <button aria-label="移除回報照片" className="rounded p-1 text-muted-foreground hover:bg-muted" type="button" onClick={() => removeReportPhoto(photo.clientPhotoId)}>
                            <X className="size-4" />
                          </button>
                        </div>
                      </div>
                      {photo.error ? <p className="text-xs text-destructive">{photo.error}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <form className="grid gap-3 border-t pt-3" onSubmit={submitPurchaseResponse}>
            <input name="purchaseTaskId" type="hidden" value={task.id} />
            <input name="purchaseAction" type="hidden" value={needsFinalConfirmation ? "complete" : effectivePurchaseAction} />
            <input name="completedQuantity" type="hidden" value={completedQuantity} />
            <input name="unavailableQuantity" type="hidden" value={effectivePurchaseAction === "complete" ? Math.max(0, requestedQuantity - completedQuantityNumber) : task.quantity} />
            <input name="faceCheckPhotoJson" type="hidden" value={faceCheckPhotoJson} />
            <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">{effectivePurchaseAction === "complete" ? "採買備註（選填）" : "取消理由（必填）"}</span>
              <textarea
                name="helperNote"
                placeholder={
                  effectivePurchaseAction === "complete"
                    ? "可補充商品狀態或現場資訊"
                    : "請填寫取消原因，例如缺貨、尺寸不對或現場無法確認"
                }
                required={needsCancelReason}
                value={helperNote}
                onChange={(event) => setHelperNote(event.target.value)}
              />
            </label>
            {needsCancelReason && !helperNote.trim() ? (
              <p className="text-xs text-destructive">取消採買前請先填寫理由。</p>
            ) : null}
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            {submitted ? (
              <InsightBanner
                body={task.requires_face_check && task.status === "open"
                  ? "挑臉確認已送出，等待管理員審核。"
                  : "系統已收到採買回報。"}
                title="已送出"
                tone="green"
              />
            ) : null}
            <Button disabled={!canSubmit} type="submit">
              {needsFinalConfirmation ? <Check className="mr-2 size-4" /> : <PackageCheck className="mr-2 size-4" />}
              送出
            </Button>
          </form>
        </>
      ) : null}
    </section>
  );
}

function PurchaseTaskStateNotice({ task }: { task: any }) {
  if (task.status === "review_pending") {
    return (
      <InsightBanner
        body="挑臉確認照已送出，等待管理員審核。"
        title="審核中"
        tone="amber"
      />
    );
  }
  if (task.status === "approved_pending_helper_confirmation") {
    return <InsightBanner title="挑臉已通過，請確認完成" tone="green" />;
  }
  if (task.status === "completed") {
    return <InsightBanner title="已完成採買" tone="green" />;
  }
  return null;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/45 px-3 py-2">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function isCompletedTask(task: any) {
  return taskStatus(task) === "completed";
}

function isCanceledTask(task: any) {
  return ["canceled", "unavailable", "not_found"].includes(taskStatus(task));
}

function isFaceCheckReviewTask(task: any) {
  return Boolean(task.requires_face_check) && ["review_pending", "approved_pending_helper_confirmation"].includes(taskStatus(task));
}

function taskStatus(task: any) {
  return task.batch_id ? task.batch_status || "open" : task.status;
}

function shouldLoadReturnedPhotos(task: any | undefined) {
  return Boolean(task) && (isCompletedTask(task) || isFaceCheckReviewTask(task));
}

function shouldPreferReturnedPhotos(task: any) {
  return isCompletedTask(task) || isFaceCheckReviewTask(task);
}

function purchaseTaskName(task: any) {
  return String(task.product_name || "").trim() || "未命名採買";
}

function purchaseTaskDisplayTitle(task: any) {
  if (task.batch_title) return task.batch_title;
  const productName = String(task.product_name || "").trim();
  if (productName) return productName;
  return "未填商品";
}

function purchaseTaskRequestedQuantity(task: any) {
  if (task.purchase_batch) {
    return Math.max(
      0,
      Number(task.purchase_batch.requested_quantity || 0) -
        Number(task.purchase_batch.reported_quantity || 0),
    );
  }
  if (task.batch_requested_quantity != null) {
    return Math.max(
      0,
      Number(task.batch_requested_quantity || 0) -
        Number(task.batch_reported_quantity || 0),
    );
  }
  return Math.max(0, Number(task.quantity || 0) - Number(task.completed_quantity || 0));
}

function purchaseStatusLabel(task: any) {
  if (task.status === "completed") return "已完成";
  if (task.status === "review_pending") return "挑臉審核中";
  if (task.status === "approved_pending_helper_confirmation") return "待確認完成";
  if (isCanceledTask(task)) return "已取消";
  return "待採買";
}

function purchaseTaskPrimaryInstruction(task: any) {
  if (task.status === "completed") return "這筆已完成，可在需要時取消並退出暫存訂單預覽。";
  if (task.status === "review_pending") return "挑臉照片已送審，等管理員回覆。";
  if (task.status === "approved_pending_helper_confirmation") return "管理員已通過挑臉，請確認完成採買。";
  if (isCanceledTask(task)) return "這筆已取消，不會進入暫存訂單。";
  return "先核對商品圖片、數量與原價，再回報實際買到數量。";
}

function purchaseResponseHelpText(task: any, cancelingCompleted: boolean) {
  if (cancelingCompleted) return "取消後這筆會退出暫存訂單預覽，請填寫取消理由。";
  if (task.status === "completed") return "採買已完成。";
  if (task.status === "review_pending") return "等待管理員審核挑臉照片。";
  if (task.status === "approved_pending_helper_confirmation") return "確認後才會正式完成這筆採買。";
  return "填實際買到數量；買不到就選 0。";
}

function purchaseTaskTone(task: any): "amber" | "blue" | "green" | "red" {
  if (isCompletedTask(task)) return "green";
  if (isCanceledTask(task)) return "red";
  if (isFaceCheckReviewTask(task)) return "amber";
  return "blue";
}

function purchaseProgress(task: any) {
  if (task.batch_id) {
    return `${Number(task.batch_reported_quantity || 0)}/${Number(task.batch_requested_quantity || 0)}`;
  }
  const quantity = Math.max(Number(task.quantity || 0), 0);
  const completed = isCompletedTask(task)
    ? Math.max(Number(task.completed_quantity || 0), 0)
    : 0;
  return `${completed}/${quantity}`;
}

function productPurchasePhotos(photos: any[]) {
  return photos.filter((photo) =>
    ["manual_reference", "series_reference", "source"].includes(String(photo.photo_role || "")),
  );
}

function secondaryPurchasePhotos(photos: any[]) {
  return photos.filter((photo) =>
    !["manual_reference", "series_reference", "source"].includes(String(photo.photo_role || "")),
  );
}

function returnedPurchasePhotos(photos: any[]) {
  const faceCheckPhoto = latestFaceCheckPhoto(photos);
  if (faceCheckPhoto) return [faceCheckPhoto];
  return photos.filter((photo) => ["detail_reply", "purchase_report"].includes(String(photo.photo_role || "")));
}

function latestFaceCheckPhoto(photos: any[]) {
  return photos
    .filter((photo) => String(photo.photo_role || "") === "face_check_report")
    .sort(compareNewestPhotoFirst)[0] || null;
}

function compareNewestPhotoFirst(left: any, right: any) {
  const leftTime = Date.parse(String(left.created_at || ""));
  const rightTime = Date.parse(String(right.created_at || ""));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return String(right.id || "").localeCompare(String(left.id || ""));
}

function secondaryPhotoLabel(role: string, index: number) {
  if (role === "face_check_report") return "挑臉";
  if (role === "purchase_report") return "回報";
  if (role === "detail_reply") return "細圖";
  return String(index + 1);
}

function createClientId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}-${randomUuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function purchasePhotoUploadStatusLabel(status: FaceCheckPhoto["status"]) {
  if (status === "uploaded") return "已上傳";
  if (status === "uploading") return "背景上傳中";
  if (status === "failed") return "上傳失敗";
  return "準備上傳";
}

function isPurchaseReportImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(file.name);
}

function inferPurchaseReportContentType(file: File) {
  if (file.type.startsWith("image/")) return file.type;
  if (/\.png$/i.test(file.name)) return "image/png";
  if (/\.webp$/i.test(file.name)) return "image/webp";
  if (/\.gif$/i.test(file.name)) return "image/gif";
  if (/\.hei[cf]$/i.test(file.name)) return "image/heic";
  return "image/jpeg";
}
