"use client";

import { Check, ChevronLeft, ChevronRight, Pencil, RefreshCw, Share2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "../components/ui/button";
import { PhotoLightbox } from "../components/PhotoAnnotationEditor";
import { BackButton } from "../components/BackButton";
import { StatusBadge } from "../components/OperationsUi";
import { RetryableError } from "../components/RetryableState";
import { cn } from "../../src/lib/utils";
import { useStaleResource } from "../../src/lib/client-resource-cache";
import { QuickPublishPurchaseForm } from "./AdminForms";
import { useAdminLiveTrips, type AdminLiveTrip } from "./useAdminLiveTrips";

type Trip = AdminLiveTrip;

type QuoteTaskSummary = {
  converted_photo_count: number;
  created_at: string;
  helper_display_name?: string | null;
  id: string;
  instruction?: string | null;
  needs_review_count: number;
  photo_count: number;
  product_name?: string | null;
  replied_photo_count: number;
  status: string;
  task_type: string;
  trip_id: string;
  trip_name?: string | null;
};

type ShareablePhoto = {
  filename: string;
  id: string;
  signed_url: string;
};

export function AdminLiveQuoteWorkspace({
  initialTripId,
  initialTrips,
}: {
  initialTripId?: string;
  initialTrips?: Trip[];
}) {
  const { loadTrips: refreshTrips, loadingTrips, trips, tripsError } = useAdminLiveTrips(initialTrips);
  const [selectedTripId, setSelectedTripId] = useState(initialTripId || "");
  const [activeTaskId, setActiveTaskId] = useState("");
  const [activeTask, setActiveTask] = useState<any | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [detailRefreshNonce, setDetailRefreshNonce] = useState(0);
  const [selectedSharePhotoIds, setSelectedSharePhotoIds] = useState<Set<string>>(new Set());

  const loadTasks = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(
      `/api/admin/live/quote-tasks?tripId=${encodeURIComponent(selectedTripId)}`,
      { cache: "no-store", signal },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "詢價任務載入失敗。");
    return (data.tasks || []) as QuoteTaskSummary[];
  }, [selectedTripId]);
  const taskResource = useStaleResource<QuoteTaskSummary[]>({
    enabled: Boolean(selectedTripId),
    fetcher: loadTasks,
    key: `admin:quote-tasks:${selectedTripId || "none"}`,
    refreshIntervalMs: 8_000,
    staleTimeMs: 5_000,
  });
  const tasks = taskResource.data || [];
  const shareableTaskPhotos = useMemo(
    () => collectShareablePhotosForTask(activeTask),
    [activeTask],
  );
  const selectedSharePhotos = useMemo(
    () => shareableTaskPhotos.filter((photo) => selectedSharePhotoIds.has(photo.id)),
    [selectedSharePhotoIds, shareableTaskPhotos],
  );
  const pendingTasks = tasks.filter((task) => !isQuoteTaskComplete(task));
  const completedTasks = tasks.filter(isQuoteTaskComplete);
  useEffect(() => {
    if (!activeTaskId || !selectedTripId) return;
    let canceled = false;

    async function loadDetail() {
      setLoadingDetail(true);
      setMessage("");
      try {
        const response = await fetch(
          `/api/admin/live/quote-tasks/${encodeURIComponent(activeTaskId)}?tripId=${encodeURIComponent(selectedTripId)}`,
          { cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "載入失敗");
        if (!canceled) {
          setActiveTask(data.task || null);
          setPhotoIndex(0);
        }
      } catch (error) {
        if (!canceled) setLoadError(error instanceof Error ? error.message : "詢價任務明細載入失敗。");
      } finally {
        if (!canceled) setLoadingDetail(false);
      }
    }

    loadDetail();
    return () => {
      canceled = true;
    };
  }, [activeTaskId, detailRefreshNonce, selectedTripId]);

  function selectTrip(tripId: string) {
    setSelectedTripId(tripId);
    setActiveTaskId("");
    setActiveTask(null);
    setPhotoIndex(0);
    setSelectedSharePhotoIds(new Set());
    const url = new URL(window.location.href);
    url.searchParams.set("view", "live");
    url.searchParams.set("liveTripId", tripId);
    url.searchParams.set("liveSection", "quote");
    window.history.replaceState(window.history.state, "", url.toString());
  }

  function openTask(taskId: string) {
    setActiveTaskId(taskId);
    setActiveTask(null);
    setPhotoIndex(0);
    setSelectedSharePhotoIds(new Set());
  }

  function closeTask() {
    setActiveTaskId("");
    setActiveTask(null);
    setPhotoIndex(0);
    setSelectedSharePhotoIds(new Set());
  }

  function toggleSharePhoto(photoId: string) {
    setSelectedSharePhotoIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  function selectAllSharePhotos() {
    setSelectedSharePhotoIds(new Set(shareableTaskPhotos.map((photo) => photo.id)));
  }

  async function sharePhotos(photos: ShareablePhoto[]) {
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (!photos.length) return;
    if (!nav.share) {
      await navigator.clipboard?.writeText(photos.map((photo) => photo.signed_url).join("\n"));
      setMessage("已複製分享連結。");
      return;
    }
    try {
      const files = await Promise.all(
        photos.map(async (photo, index) => {
          const response = await fetch(photo.signed_url);
          const blob = await response.blob();
          return new File([blob], photo.filename || `quote-photo-${index + 1}.jpg`, {
            type: blob.type || "image/jpeg",
          });
        }),
      );
      if (nav.canShare?.({ files })) {
        await nav.share({ files });
        return;
      }
    } catch {
      // Some browsers block signed-url file sharing; fall back to URL share.
    }
    await nav.share({
      text: photos.map((photo) => photo.signed_url).join("\n"),
      title: "詢價/細節照片",
    });
  }

  return (
    <section className="admin-live-workspace grid gap-4">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">選擇要監聽的行程</h3>
          <Button
            disabled={taskResource.isRefreshing || !selectedTripId}
            onClick={() => void taskResource.refresh()}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn("size-4", taskResource.isRefreshing ? "animate-spin" : "")} />
            刷新
          </Button>
        </div>
        {loadingTrips ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div className="h-20 rounded-lg border bg-muted/60" key={item} />
            ))}
          </div>
        ) : trips.length ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip) => (
              <button
                className={cn(
                  "admin-selection-card rounded-lg border bg-card p-3 text-left shadow-sm",
                  selectedTripId === trip.id
                    ? "border-primary ring-2 ring-primary/20"
                    : "hover:border-primary/50",
                )}
                key={trip.id}
                onClick={() => selectTrip(trip.id)}
                type="button"
              >
                <p className="font-semibold">{trip.trip_name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {trip.helper_display_name || "未指派"}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">
            目前沒有進行中的行程。
          </div>
        )}
      </div>

      {selectedTripId ? (
        <nav aria-label="即時回傳工作區" className="admin-live-nav grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Button asChild variant="outline">
            <Link href={`/admin?view=live&liveTripId=${encodeURIComponent(selectedTripId)}&liveSection=photos`}>
              現場照片
            </Link>
          </Button>
          <Button type="button">詢價回覆</Button>
          <Button asChild variant="outline">
            <Link href={`/admin?view=live&liveTripId=${encodeURIComponent(selectedTripId)}&liveSection=purchase`}>
              採買任務
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/admin?view=live&liveTripId=${encodeURIComponent(selectedTripId)}&liveSection=staging`}>
              暫存訂單
            </Link>
          </Button>
        </nav>
      ) : null}

      {taskResource.error || loadError || tripsError ? (
        <RetryableError
          message={taskResource.error || loadError || tripsError}
          onRetry={() => {
            if (activeTaskId) setDetailRefreshNonce((value) => value + 1);
            else if (selectedTripId) void taskResource.refresh();
            else void refreshTrips();
          }}
        />
      ) : null}
      {message ? <p aria-live="polite" className="text-sm text-muted-foreground" role="status">{message}</p> : null}

      {selectedTripId && !activeTaskId ? (
        <QuoteTaskList
          completedTasks={completedTasks}
          loading={taskResource.isLoading}
          pendingTasks={pendingTasks}
          tasks={tasks}
          onOpenTask={openTask}
        />
      ) : null}

      {selectedTripId && activeTaskId ? (
        <section className="grid gap-4">
          <BackButton label="返回任務列表" onClick={closeTask} type="button" />

          {loadingDetail && !activeTask ? (
            <div className="grid gap-3">
              <div className="h-24 rounded-xl bg-muted" />
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div className="aspect-square rounded-lg bg-muted" key={index} />
                ))}
              </div>
            </div>
          ) : activeTask ? (
            <QuoteTaskDetail
              onPhotoIndexChange={setPhotoIndex}
              onSelectAllSharePhotos={selectAllSharePhotos}
              onClearSharePhotos={() => setSelectedSharePhotoIds(new Set())}
              onShareSelectedPhotos={() => void sharePhotos(selectedSharePhotos)}
              onSharePhoto={(photo) => sharePhotos(collectShareablePhotosForPhoto(photo))}
              onToggleSharePhoto={toggleSharePhoto}
              photoIndex={photoIndex}
              task={activeTask}
              selectedSharePhotoIds={selectedSharePhotoIds}
              shareableTaskPhotos={shareableTaskPhotos}
            />
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function QuoteTaskList({
  completedTasks,
  loading,
  onOpenTask,
  pendingTasks,
  tasks,
}: {
  completedTasks: QuoteTaskSummary[];
  loading: boolean;
  onOpenTask: (taskId: string) => void;
  pendingTasks: QuoteTaskSummary[];
  tasks: QuoteTaskSummary[];
}) {
  return (
    <section className="grid gap-4">
      {loading && !tasks.length ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((item) => (
            <div className="h-20 rounded-xl bg-muted" key={item} />
          ))}
        </div>
      ) : !tasks.length ? (
        <div className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">
          尚無詢價/細節任務。
        </div>
      ) : (
        <div className="grid gap-4">
          <QuoteTaskLane title="未回覆" tasks={pendingTasks} onOpenTask={onOpenTask} />
          {completedTasks.length ? (
            <QuoteTaskLane title="已回覆" tasks={completedTasks} onOpenTask={onOpenTask} />
          ) : null}
        </div>
      )}
    </section>
  );
}

function QuoteTaskLane({
  onOpenTask,
  tasks,
  title,
}: {
  onOpenTask: (taskId: string) => void;
  tasks: QuoteTaskSummary[];
  title: string;
}) {
  if (!tasks.length) {
    return (
      <section className="admin-lane grid gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <div className="rounded-lg border border-dashed bg-card p-3 text-sm text-muted-foreground">
          目前沒有。
        </div>
      </section>
    );
  }
  return (
    <section className="admin-lane grid gap-2">
      <p className="text-sm font-semibold">{title}</p>
      {tasks.map((task) => (
        <button
          className="admin-lane-card flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-left shadow-sm"
          key={task.id}
          onClick={() => onOpenTask(task.id)}
          type="button"
        >
          <span className="min-w-0">
            <strong className="block truncate">{task.product_name || taskTypeLabel(task.task_type)}</strong>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {taskTypeLabel(task.task_type)}
              {task.needs_review_count ? ` · ${task.needs_review_count} 確認` : ""}
            </span>
          </span>
          <StatusBadge tone={isQuoteTaskComplete(task) ? "green" : "blue"}>
            {task.replied_photo_count}/{task.photo_count}
          </StatusBadge>
        </button>
      ))}
    </section>
  );
}

function QuoteTaskDetail({
  onClearSharePhotos,
  onPhotoIndexChange,
  onSelectAllSharePhotos,
  onShareSelectedPhotos,
  onSharePhoto,
  onToggleSharePhoto,
  photoIndex,
  selectedSharePhotoIds,
  shareableTaskPhotos,
  task,
}: {
  onClearSharePhotos: () => void;
  onPhotoIndexChange: (index: number) => void;
  onSelectAllSharePhotos: () => void;
  onShareSelectedPhotos: () => void;
  onSharePhoto: (photo: any) => void | Promise<void>;
  onToggleSharePhoto: (photoId: string) => void;
  photoIndex: number;
  selectedSharePhotoIds: Set<string>;
  shareableTaskPhotos: ShareablePhoto[];
  task: any;
}) {
  const photos = task.photos || [];
  const safeIndex = Math.min(photoIndex, Math.max(photos.length - 1, 0));
  const photo = photos[safeIndex];
  const latestReply = photo?.latest_reply;
  const shareablePhotos = collectShareablePhotosForPhoto(photo);
  return (
    <section className="admin-live-workspace grid gap-4">
      <div className="admin-detail-surface rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{taskTypeLabel(task.task_type)}</p>
            <h3 className="truncate text-xl font-semibold">{task.product_name || "未命名任務"}</h3>
            {task.instruction ? <p className="mt-1 text-sm text-muted-foreground">{task.instruction}</p> : null}
          </div>
          <StatusBadge tone={task.status === "completed" ? "green" : "blue"}>
            {photo ? `${safeIndex + 1}/${photos.length}` : "0/0"}
          </StatusBadge>
        </div>
      </div>

      {photo ? (
        <>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
            <Button
              aria-label="上一張照片"
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
              aria-label="下一張照片"
              disabled={safeIndex >= photos.length - 1}
              size="sm"
              type="button"
              variant="outline"
              onClick={() => onPhotoIndexChange(safeIndex + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

            <article className="grid gap-3 rounded-2xl border bg-card p-3 shadow-sm" key={photo.id}>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={latestReply ? "green" : "amber"}>
                      第 {photo.sort_order + 1} 張
                    </StatusBadge>
                    {photo.needs_review ? <StatusBadge tone="amber">需確認</StatusBadge> : null}
                    {photo.reply_status === "converted_to_purchase" ? <StatusBadge tone="green">已轉採買</StatusBadge> : null}
                  </div>
                  <h4 className="mt-2 truncate text-base font-semibold">
                    {photo.product_name || task.product_name || "詢價照片"}
                  </h4>
                  <p className="mt-0.5 text-xs text-muted-foreground">目前只顯示這張照片的回覆。</p>
                </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    disabled={!shareableTaskPhotos.length}
                    onClick={onSelectAllSharePhotos}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Check className="size-4" />
                    全選照片
                  </Button>
                  <Button
                    disabled={!selectedSharePhotoIds.size}
                    onClick={onClearSharePhotos}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    取消選取
                  </Button>
                  <Button
                    disabled={!selectedSharePhotoIds.size}
                    onClick={onShareSelectedPhotos}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <Share2 className="size-4" />
                    分享選取 ({selectedSharePhotoIds.size})
                  </Button>
                  <Button
                    disabled={!shareablePhotos.length}
                    onClick={() => onSharePhoto(photo)}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <Share2 className="size-4" />
                    分享
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(180px,260px)_1fr]">
                <div className="grid gap-2 rounded-xl border bg-background p-2">
                  <p className="text-xs font-semibold text-muted-foreground">發出的照片</p>
                  <SelectableImage
                    alt={photo.product_name || "quote task photo"}
                    onToggle={() => onToggleSharePhoto(getSharePhotoId(photo, `source-${photo.id}`))}
                    photo={photo}
                    selected={selectedSharePhotoIds.has(getSharePhotoId(photo, `source-${photo.id}`))}
                    url={photo.signed_url}
                  />
                </div>
                {latestReply ? (
                  <div className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-emerald-900/70">小幫手回覆</p>
                        <p className="mt-1 text-sm text-emerald-950">
                          {taskTypeLabel(task.task_type)}
                        </p>
                      </div>
                      {latestReply.price_jpy != null ? (
                        <div className="grid gap-2">
                          <div className="rounded-xl border border-emerald-300 bg-white px-4 py-3 text-right shadow-sm">
                            <p className="text-xs font-semibold text-emerald-800/70">報價</p>
                            <p className="text-2xl font-semibold tracking-tight text-emerald-950">
                              JPY {latestReply.price_jpy}
                            </p>
                          </div>
                          <QuickPublishPurchaseForm photo={photo} task={task} />
                        </div>
                      ) : null}
                    </div>
                    {latestReply.note ? (
                      <div className="rounded-lg border border-emerald-200 bg-white/80 p-3 text-sm text-emerald-950">
                        <p className="text-xs font-semibold text-emerald-800/70">備註</p>
                        <p className="mt-1 leading-6">{latestReply.note}</p>
                      </div>
                    ) : null}
                    {latestReply.detail_photos?.length ? (
                      <div className="grid gap-2">
                        <p className="text-xs font-semibold text-emerald-900/70">細圖回覆</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                          {latestReply.detail_photos.map((detailPhoto: any, index: number) => {
                            return (
                              <SelectableImage
                                alt={detailPhoto.original_filename || "detail photo"}
                                key={detailPhoto.storage_key || index}
                                onToggle={() => onToggleSharePhoto(getSharePhotoId(detailPhoto, `detail-${photo.id}-${index}`))}
                                photo={detailPhoto}
                                selected={selectedSharePhotoIds.has(getSharePhotoId(detailPhoto, `detail-${photo.id}-${index}`))}
                                url={detailPhoto.signed_url}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ) : latestReply.price_jpy == null ? (
                      <div className="rounded-lg border border-dashed border-emerald-300 bg-white/60 p-3 text-sm text-emerald-900/80">
                        這張目前沒有價格或細圖內容。
                      </div>
                    ) : null}
                    {latestReply.price_jpy == null ? (
                      <QuickPublishPurchaseForm photo={photo} task={task} />
                    ) : null}
                  </div>
                ) : (
                  <div className="flex min-h-40 items-center rounded-xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                    等待小幫手回覆。
                  </div>
                )}
              </div>
            </article>
        </>
      ) : (
        <div className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">
          此任務目前沒有照片。
        </div>
      )}
    </section>
  );
}

function SelectableImage({
  alt,
  onToggle,
  photo,
  selected = false,
  url,
}: {
  alt: string;
  onToggle?: () => void;
  photo?: any;
  selected?: boolean;
  url: string;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <>
      <div className={cn(
        "group relative aspect-square overflow-hidden rounded-xl bg-muted",
        selected ? "ring-2 ring-primary ring-offset-2" : "",
      )}>
        <button aria-label={`檢視${alt}`} className="size-full" onClick={() => setPreviewOpen(true)} type="button">
          <img alt={alt} className="size-full object-cover" loading="lazy" src={url} />
          <span className="pointer-events-none absolute inset-0 opacity-0 ring-2 ring-primary transition group-hover:opacity-100" />
        </button>
        {onToggle ? (
          <button
            aria-label={selected ? `取消選取${alt}` : `選取${alt}`}
            aria-pressed={selected}
            className={cn(
              "absolute right-2 top-2 grid size-8 place-items-center rounded-full border text-xs shadow-sm transition",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-white/80 bg-black/45 text-white hover:bg-black/65",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            type="button"
          >
            {selected ? <Check className="size-4" /> : null}
          </button>
        ) : null}
        {photo?.storage_key ? (
          <button
            aria-label="開啟照片編輯器"
            className="absolute bottom-2 right-2 grid size-8 place-items-center rounded-full bg-black/65 text-white shadow-sm hover:bg-black/80"
            onClick={() => setPreviewOpen(true)}
            type="button"
          >
            <Pencil className="size-4" />
          </button>
        ) : null}
      </div>
      {previewOpen ? <PhotoLightbox alt={alt} onClose={() => setPreviewOpen(false)} photo={photo} /> : null}
    </>
  );
}

function collectShareablePhotosForPhoto(photo: any): ShareablePhoto[] {
  if (!photo) return [];
  const items: ShareablePhoto[] = [];
  const detailPhotos = photo.latest_reply?.detail_photos || [];
  if (detailPhotos.length) {
    for (const [index, detailPhoto] of detailPhotos.entries()) {
      if (!detailPhoto.signed_url) continue;
      items.push({
        filename: detailPhoto.original_filename || `quote-detail-${photo.sort_order + 1}-${index + 1}.jpg`,
        id: getSharePhotoId(detailPhoto, `detail-${photo.id}-${index}`),
        signed_url: detailPhoto.signed_url,
      });
    }
    return items;
  }
  if (photo.signed_url) {
    items.push({
      filename: photo.product_name || `quote-source-${photo.sort_order + 1}.jpg`,
      id: getSharePhotoId(photo, `source-${photo.id}`),
      signed_url: photo.signed_url,
    });
  }
  return items;
}

function collectShareablePhotosForTask(task: any): ShareablePhoto[] {
  if (!task?.photos?.length) return [];
  return task.photos.flatMap((photo: any) => {
    const source = photo.signed_url
      ? [{
          filename: photo.product_name || `quote-source-${photo.sort_order + 1}.jpg`,
          id: getSharePhotoId(photo, `source-${photo.id}`),
          signed_url: photo.signed_url,
        }]
      : [];
    const detailPhotos = (photo.latest_reply?.detail_photos || [])
      .filter((detailPhoto: any) => detailPhoto.signed_url)
      .map((detailPhoto: any, index: number) => ({
        filename: detailPhoto.original_filename || `quote-detail-${photo.sort_order + 1}-${index + 1}.jpg`,
        id: getSharePhotoId(detailPhoto, `detail-${photo.id}-${index}`),
        signed_url: detailPhoto.signed_url,
      }));
    return [...source, ...detailPhotos];
  });
}

function getSharePhotoId(photo: any, fallback: string) {
  return String(photo?.storage_key || photo?.id || fallback);
}

function taskTypeLabel(taskType: string) {
  if (taskType === "quote") return "報價";
  if (taskType === "detail") return "細圖";
  return "報價＋細圖";
}

function isQuoteTaskComplete(task: QuoteTaskSummary) {
  const total = Number(task.photo_count || 0);
  return task.status === "completed" || (total > 0 && Number(task.replied_photo_count || 0) >= total);
}
