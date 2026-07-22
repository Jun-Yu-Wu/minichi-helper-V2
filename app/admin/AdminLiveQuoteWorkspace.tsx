"use client";

import { Check, Download, RefreshCw, Share2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../components/ui/button";
import { BackButton } from "../components/BackButton";
import { StatusBadge } from "../components/OperationsUi";
import { RetryableError } from "../components/RetryableState";
import { cn } from "../../src/lib/utils";
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

const REFRESH_MS = 8000;

export function AdminLiveQuoteWorkspace({
  initialTripId,
  initialTrips,
}: {
  initialTripId?: string;
  initialTrips?: Trip[];
}) {
  const { loadTrips: refreshTrips, loadingTrips, trips, tripsError } = useAdminLiveTrips(initialTrips);
  const [selectedTripId, setSelectedTripId] = useState(initialTripId || "");
  const [tasks, setTasks] = useState<QuoteTaskSummary[]>([]);
  const [activeTaskId, setActiveTaskId] = useState("");
  const [activeTask, setActiveTask] = useState<any | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [detailRefreshNonce, setDetailRefreshNonce] = useState(0);

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId);
  const pendingTasks = tasks.filter((task) => !isQuoteTaskComplete(task));
  const completedTasks = tasks.filter(isQuoteTaskComplete);
  const allDetailPhotos = useMemo(() => collectShareablePhotos(activeTask), [activeTask]);
  const selectedPhotos = useMemo(
    () => allDetailPhotos.filter((photo) => selectedPhotoIds.has(photo.id)),
    [allDetailPhotos, selectedPhotoIds],
  );

  useEffect(() => {
    if (!selectedTripId) {
      setTasks([]);
      setActiveTaskId("");
      setActiveTask(null);
      return;
    }

    let canceled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function loadTasks(showLoading = false) {
      if (showLoading) setLoadingTasks(true);
      try {
        const response = await fetch(
          `/api/admin/live/quote-tasks?tripId=${encodeURIComponent(selectedTripId)}`,
          { cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "載入失敗");
        if (!canceled) {
          setTasks(data.tasks || []);
          setLoadError("");
        }
      } catch (error) {
        if (!canceled) setLoadError(error instanceof Error ? error.message : "詢價任務載入失敗。");
      } finally {
        if (!canceled) setLoadingTasks(false);
      }
    }

    loadTasks(true);
    timer = setInterval(() => loadTasks(false), REFRESH_MS);
    return () => {
      canceled = true;
      if (timer) clearInterval(timer);
    };
  }, [refreshNonce, selectedTripId]);

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
          setSelectedPhotoIds(new Set());
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
    setSelectedPhotoIds(new Set());
    const url = new URL(window.location.href);
    url.searchParams.set("view", "live");
    url.searchParams.set("liveTripId", tripId);
    url.searchParams.set("liveSection", "quote");
    window.history.replaceState(window.history.state, "", url.toString());
  }

  function openTask(taskId: string) {
    setActiveTaskId(taskId);
    setActiveTask(null);
    setSelectedPhotoIds(new Set());
  }

  function closeTask() {
    setActiveTaskId("");
    setActiveTask(null);
    setSelectedPhotoIds(new Set());
  }

  function togglePhoto(photoId: string) {
    setSelectedPhotoIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  function selectAllPhotos() {
    setSelectedPhotoIds(new Set(allDetailPhotos.map((photo) => photo.id)));
  }

  async function downloadPhotos(photos: ShareablePhoto[]) {
    for (const [index, photo] of photos.entries()) {
      const link = document.createElement("a");
      link.href = photo.signed_url;
      link.download = photo.filename || `quote-photo-${index + 1}.jpg`;
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      await wait(160);
    }
    setMessage(`${photos.length} 張照片已送出儲存。`);
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
    <section className="grid gap-4">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">選擇要監聽的行程</h3>
          <Button
            disabled={loadingTasks || !selectedTripId}
            onClick={() => setRefreshNonce((value) => value + 1)}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn("size-4", loadingTasks ? "animate-spin" : "")} />
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
                  "rounded-lg border bg-card p-3 text-left shadow-sm transition",
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
        <nav aria-label="即時回傳工作區" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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

      {loadError || tripsError ? (
        <RetryableError
          message={loadError || tripsError}
          onRetry={() => {
            if (activeTaskId) setDetailRefreshNonce((value) => value + 1);
            else if (selectedTripId) setRefreshNonce((value) => value + 1);
            else void refreshTrips();
          }}
        />
      ) : null}
      {message ? <p aria-live="polite" className="text-sm text-muted-foreground" role="status">{message}</p> : null}

      {selectedTripId && !activeTaskId ? (
        <QuoteTaskList
          completedTasks={completedTasks}
          loading={loadingTasks}
          pendingTasks={pendingTasks}
          selectedTrip={selectedTrip}
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
              allPhotoCount={allDetailPhotos.length}
              onClearPhotos={() => setSelectedPhotoIds(new Set())}
              onSaveSelectedPhotos={() => downloadPhotos(selectedPhotos)}
              onSelectAllPhotos={selectAllPhotos}
              onShareSelectedPhotos={() => sharePhotos(selectedPhotos)}
              selectedPhotoIds={selectedPhotoIds}
              selectedPhotoCount={selectedPhotoIds.size}
              task={activeTask}
              togglePhoto={togglePhoto}
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
  selectedTrip,
  tasks,
}: {
  completedTasks: QuoteTaskSummary[];
  loading: boolean;
  onOpenTask: (taskId: string) => void;
  pendingTasks: QuoteTaskSummary[];
  selectedTrip?: Trip;
  tasks: QuoteTaskSummary[];
}) {
  const replied = tasks.reduce((total, task) => total + Number(task.replied_photo_count || 0), 0);
  const photos = tasks.reduce((total, task) => total + Number(task.photo_count || 0), 0);
  const needsReview = tasks.reduce((total, task) => total + Number(task.needs_review_count || 0), 0);

  return (
    <section className="grid gap-4">
      <div className="grid gap-2 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{selectedTrip?.trip_name || "即時回傳"}</p>
            <h3 className="text-xl font-semibold">詢價 / 細節</h3>
          </div>
          <StatusBadge tone={needsReview ? "amber" : replied === photos && photos ? "green" : "blue"}>
            {replied}/{photos}
          </StatusBadge>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <MiniMetric label="任務" value={String(tasks.length)} />
          <MiniMetric label="未回覆" value={String(pendingTasks.length)} />
          <MiniMetric label="確認" value={String(needsReview)} />
        </div>
      </div>

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
      <section className="grid gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <div className="rounded-lg border border-dashed bg-card p-3 text-sm text-muted-foreground">
          目前沒有。
        </div>
      </section>
    );
  }
  return (
    <section className="grid gap-2">
      <p className="text-sm font-semibold">{title}</p>
      {tasks.map((task) => (
        <button
          className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-accent/30"
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
  allPhotoCount,
  onClearPhotos,
  onSaveSelectedPhotos,
  onSelectAllPhotos,
  onShareSelectedPhotos,
  selectedPhotoIds,
  selectedPhotoCount,
  task,
  togglePhoto,
}: {
  allPhotoCount: number;
  onClearPhotos: () => void;
  onSaveSelectedPhotos: () => void | Promise<void>;
  onSelectAllPhotos: () => void;
  onShareSelectedPhotos: () => void | Promise<void>;
  selectedPhotoIds: Set<string>;
  selectedPhotoCount: number;
  task: any;
  togglePhoto: (photoId: string) => void;
}) {
  const photos = task.photos || [];
  const replied = photos.filter((photo: any) => photo.latest_reply).length;
  return (
    <section className="grid gap-4">
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{taskTypeLabel(task.task_type)}</p>
            <h3 className="truncate text-xl font-semibold">{task.product_name || "未命名任務"}</h3>
            {task.instruction ? <p className="mt-1 text-sm text-muted-foreground">{task.instruction}</p> : null}
          </div>
          <StatusBadge tone={task.status === "completed" ? "green" : "blue"}>
            {replied}/{photos.length}
          </StatusBadge>
        </div>
      </div>

      <div className="grid gap-3">
        {photos.map((photo: any) => {
          const latestReply = photo.latest_reply;
          const sourcePhotoId = `source:${photo.id}`;
          return (
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
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    左側是管理員發出的照片，右側是小幫手回覆。
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    disabled={!allPhotoCount}
                    onClick={onSelectAllPhotos}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    全選
                  </Button>
                  <Button
                    disabled={!selectedPhotoCount}
                    onClick={onClearPhotos}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    取消
                  </Button>
                  <Button
                    disabled={!selectedPhotoCount}
                    onClick={onSaveSelectedPhotos}
                    size="sm"
                    type="button"
                  >
                    <Download className="size-4" />
                    儲存
                  </Button>
                  <Button
                    disabled={!selectedPhotoCount}
                    onClick={onShareSelectedPhotos}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <Share2 className="size-4" />
                    分享
                  </Button>
                  <span className="flex min-h-9 items-center text-xs text-muted-foreground">
                    {selectedPhotoCount ? `${selectedPhotoCount} / ${allPhotoCount}` : `${allPhotoCount} 張`}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(180px,260px)_1fr]">
                <div className="grid gap-2 rounded-xl border bg-background p-2">
                  <p className="text-xs font-semibold text-muted-foreground">發出的照片</p>
                  <SelectableImage
                    alt={photo.product_name || "quote task photo"}
                    id={sourcePhotoId}
                    selected={selectedPhotoIds.has(sourcePhotoId)}
                    url={photo.signed_url}
                    onToggle={togglePhoto}
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
                            const detailId = `detail:${photo.id}:${detailPhoto.storage_key || index}`;
                            return (
                              <SelectableImage
                                alt={detailPhoto.original_filename || "detail photo"}
                                id={detailId}
                                key={detailId}
                                selected={selectedPhotoIds.has(detailId)}
                                url={detailPhoto.signed_url}
                                onToggle={togglePhoto}
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
          );
        })}
      </div>
    </section>
  );
}

function SelectableImage({
  alt,
  id,
  onToggle,
  selected,
  url,
}: {
  alt: string;
  id: string;
  onToggle: (id: string) => void;
  selected: boolean;
  url: string;
}) {
  return (
    <button
      className="group relative aspect-square overflow-hidden rounded-xl bg-muted"
      onClick={() => onToggle(id)}
      type="button"
    >
      <img alt={alt} className="size-full object-cover" loading="lazy" src={url} />
      <span
        className={cn(
          "absolute right-2 top-2 flex size-7 items-center justify-center rounded-full border text-xs shadow-sm",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-white/80 bg-black/40 text-white",
        )}
      >
        {selected ? <Check className="size-4" /> : null}
      </span>
      <span className="absolute inset-0 opacity-0 ring-2 ring-primary transition group-hover:opacity-100" />
    </button>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function collectShareablePhotos(task: any): ShareablePhoto[] {
  if (!task) return [];
  const items: ShareablePhoto[] = [];
  for (const photo of task.photos || []) {
    if (photo.signed_url) {
      items.push({
        filename: photo.product_name || `quote-source-${photo.sort_order + 1}.jpg`,
        id: `source:${photo.id}`,
        signed_url: photo.signed_url,
      });
    }
    for (const [index, detailPhoto] of (photo.latest_reply?.detail_photos || []).entries()) {
      if (!detailPhoto.signed_url) continue;
      items.push({
        filename: detailPhoto.original_filename || `quote-detail-${photo.sort_order + 1}-${index + 1}.jpg`,
        id: `detail:${photo.id}:${detailPhoto.storage_key || index}`,
        signed_url: detailPhoto.signed_url,
      });
    }
  }
  return items;
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

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
