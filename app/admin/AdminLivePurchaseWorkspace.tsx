"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";

import { reviewFaceCheckPurchaseAction } from "../actions/admin";
import { InsightBanner, StatusBadge } from "../components/OperationsUi";
import { RetryableError } from "../components/RetryableState";
import { Button } from "../components/ui/button";
import { PhotoViewerTrigger } from "../components/PhotoAnnotationEditor";
import { BackButton } from "../components/BackButton";
import { cn } from "../../src/lib/utils";
import { useStaleResource } from "../../src/lib/client-resource-cache";
import { useAdminLiveTrips, type AdminLiveTrip } from "./useAdminLiveTrips";

type Trip = AdminLiveTrip;

type PurchaseTaskSummary = {
  purchase_batch_id?: string | null;
  purchase_batch_sequence?: number | null;
  purchase_batch_status?: string | null;
  purchase_batch_group_key?: string | null;
  completed_quantity?: number | null;
  helper_display_name?: string | null;
  helper_note?: string | null;
  id: string;
  line_community_name?: string | null;
  original_price_jpy?: number | null;
  photo_count?: number | null;
  product_name?: string | null;
  quantity: number;
  requires_face_check?: boolean;
  sale_price_twd?: number | null;
  status: string;
  trip_id: string;
};

export function AdminLivePurchaseWorkspace({
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
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [allPhotosLoading, setAllPhotosLoading] = useState(false);
  const [allPhotosLoaded, setAllPhotosLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [detailRefreshNonce, setDetailRefreshNonce] = useState(0);
  const [reviewPending, startReviewTransition] = useTransition();

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId);
  const loadTasks = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(
      `/api/admin/live/purchase-tasks?tripId=${encodeURIComponent(selectedTripId)}`,
      { cache: "no-store", signal },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "採買任務載入失敗。");
    return (data.tasks || []) as PurchaseTaskSummary[];
  }, [selectedTripId]);
  const taskResource = useStaleResource<PurchaseTaskSummary[]>({
    enabled: Boolean(selectedTripId),
    fetcher: loadTasks,
    key: `admin:purchase-tasks:${selectedTripId || "none"}`,
    refreshIntervalMs: 8_000,
    staleTimeMs: 5_000,
  });
  const tasks = taskResource.data || [];
  const lanes = purchaseLanes(tasks);

  useEffect(() => {
    if (!activeTaskId || !selectedTripId) return;
    let canceled = false;

    async function loadDetail() {
      setLoadingDetail(true);
      setMessage("");
      try {
        const response = await fetch(
          `/api/admin/live/purchase-tasks/${encodeURIComponent(activeTaskId)}?tripId=${encodeURIComponent(selectedTripId)}`,
          { cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "載入失敗");
        if (!canceled) {
          setActiveTask(data.task || null);
          setLoadError("");
        }
      } catch (error) {
        if (!canceled) setLoadError(error instanceof Error ? error.message : "採買任務明細載入失敗。");
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
    const url = new URL(window.location.href);
    url.searchParams.set("view", "live");
    url.searchParams.set("liveTripId", tripId);
    url.searchParams.set("liveSection", "purchase");
    window.history.replaceState(window.history.state, "", url.toString());
  }

  function openTask(taskId: string) {
    setActiveTaskId(taskId);
    setActiveTask(null);
    setAllPhotosLoaded(false);
    setAllPhotosLoading(false);
  }

  function closeTask() {
    setActiveTaskId("");
    setActiveTask(null);
    setAllPhotosLoaded(false);
    setAllPhotosLoading(false);
  }

  async function loadAllTaskPhotos() {
    if (!activeTaskId || !selectedTripId || allPhotosLoaded) return;
    setAllPhotosLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/live/purchase-tasks/${encodeURIComponent(activeTaskId)}?tripId=${encodeURIComponent(selectedTripId)}&photoMode=all`,
        { cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "載入失敗");
      setActiveTask(data.task || null);
      setLoadError("");
      setAllPhotosLoaded(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "採買照片載入失敗。");
    } finally {
      setAllPhotosLoading(false);
    }
  }

  function reviewFaceCheck(action: "approve" | "reject") {
    if (!activeTaskId) return;
    const formData = new FormData();
    formData.set("purchaseTaskId", activeTaskId);
    formData.set("reviewAction", action);
    formData.set(
      "adminReviewNote",
      action === "approve" ? "Approved from live return" : "Retake requested from live return",
    );
    startReviewTransition(async () => {
      try {
        await reviewFaceCheckPurchaseAction(formData);
        await taskResource.refresh();
        const response = await fetch(
          `/api/admin/live/purchase-tasks/${encodeURIComponent(activeTaskId)}?tripId=${encodeURIComponent(selectedTripId)}`,
          { cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "審核結果載入失敗。");
        setActiveTask(data.task || null);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "審核操作失敗，請重試。");
      }
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
          <Button asChild variant="outline">
            <Link href={`/admin?view=live&liveTripId=${encodeURIComponent(selectedTripId)}&liveSection=quote`}>
              詢價回覆
            </Link>
          </Button>
          <Button type="button">採買任務</Button>
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
        <PurchaseTaskList
          lanes={lanes}
          loading={taskResource.isLoading}
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
            <PurchaseTaskDetail
              allPhotosLoaded={allPhotosLoaded}
              allPhotosLoading={allPhotosLoading}
              reviewPending={reviewPending}
              task={activeTask}
              onLoadAllPhotos={loadAllTaskPhotos}
              onReview={reviewFaceCheck}
            />
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function PurchaseTaskList({
  lanes,
  loading,
  onOpenTask,
  selectedTrip,
  tasks,
}: {
  lanes: ReturnType<typeof purchaseLanes>;
  loading: boolean;
  onOpenTask: (taskId: string) => void;
  selectedTrip?: Trip;
  tasks: PurchaseTaskSummary[];
}) {
  const completed = tasks.filter((task) => task.status === "completed").length;

  return (
    <section className="grid gap-4">
      <div className="admin-detail-surface grid gap-2 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{selectedTrip?.trip_name || "即時回傳"}</p>
            <h3 className="text-xl font-semibold">採買任務</h3>
          </div>
          <StatusBadge tone={tasks.length && completed === tasks.length ? "green" : "blue"}>
            {completed}/{tasks.length}
          </StatusBadge>
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
          尚無採買任務。
        </div>
      ) : (
        <div className="grid gap-4">
          {lanes.map((lane) =>
            lane.tasks.length ? (
              <PurchaseTaskLane
                key={lane.title}
                tasks={lane.tasks}
                title={lane.title}
                tone={lane.tone}
                onOpenTask={onOpenTask}
              />
            ) : null,
          )}
        </div>
      )}
    </section>
  );
}

function PurchaseTaskLane({
  onOpenTask,
  tasks,
  title,
  tone,
}: {
  onOpenTask: (taskId: string) => void;
  tasks: PurchaseTaskSummary[];
  title: string;
  tone: "amber" | "blue" | "green" | "red";
}) {
  return (
    <section className="admin-lane grid gap-2">
      <p className={`text-sm font-semibold ${tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : ""}`}>
        {title}
      </p>
      {tasks.map((task) => (
        <button
          className="admin-lane-card flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-left shadow-sm"
          key={task.id}
          onClick={() => onOpenTask(task.id)}
          type="button"
        >
          <span className="min-w-0">
            <strong className="block truncate">
              {task.product_name || "未命名採買"}
              {Number(task.purchase_batch_sequence || 0) > 0 ? `－加單${Number(task.purchase_batch_sequence)}` : ""}
            </strong>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {purchaseTypeLabel(task)}
              {task.line_community_name ? ` · ${task.line_community_name}` : ""}
              {task.purchase_batch_id ? " · 同品項批次" : ""}
            </span>
          </span>
          <StatusBadge tone={tone}>
            {purchaseProgress(task)}
          </StatusBadge>
        </button>
      ))}
    </section>
  );
}

function PurchaseTaskDetail({
  allPhotosLoaded,
  allPhotosLoading,
  onLoadAllPhotos,
  onReview,
  reviewPending,
  task,
}: {
  allPhotosLoaded: boolean;
  allPhotosLoading: boolean;
  onLoadAllPhotos: () => void;
  onReview: (action: "approve" | "reject") => void;
  reviewPending: boolean;
  task: any;
}) {
  const primaryPhotos = adminPrimaryPurchasePhotos(task.photos || []);
  const hiddenPhotos = adminHiddenPurchasePhotos(task.photos || []);
  return (
    <section className="admin-live-workspace grid gap-4">
      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{purchaseTypeLabel(task)}</p>
            <h3 className="truncate text-xl font-semibold">{task.product_name || "未命名採買"}</h3>
            {task.purchase_batch ? (
              <p className="mt-1 text-xs font-medium text-primary">{task.purchase_batch.title}</p>
            ) : null}
            <p className="mt-1 text-sm text-muted-foreground">
              {task.line_community_name || "未填客人"} · {task.helper_display_name || "未指派"}
            </p>
          </div>
          <StatusBadge tone={purchaseStatusTone(task.status)}>
            {purchaseProgress(task)}
          </StatusBadge>
        </div>
      </div>

      <div className="grid gap-2 rounded-2xl border bg-card p-4 text-sm shadow-sm sm:grid-cols-4">
        <AdminPurchaseFact label="狀態" value={purchaseStatusLabel(task.status)} />
        <AdminPurchaseFact label="要求數量" value={`${task.quantity} 件`} />
        <AdminPurchaseFact
          label="完成數量"
          value={task.completed_quantity == null ? "—" : `${task.completed_quantity} 件`}
        />
        <AdminPurchaseFact label="原價" value={`JPY ${task.original_price_jpy ?? "-"}`} />
        <AdminPurchaseFact label="售價" value={`TWD ${task.sale_price_twd}`} />
      </div>

      {task.note ? <InsightBanner body={task.note} title="管理員指示" tone="neutral" /> : null}
      {task.helper_note ? <InsightBanner body={task.helper_note} title="小幫手回報" tone="neutral" /> : null}
      {task.status === "review_pending" ? (
        <InsightBanner
          body="這筆挑臉採買還不會進入暫存訂單。審核通過後仍需小幫手最後確認。"
          title="挑臉照片待審"
          tone="amber"
        />
      ) : null}
      {task.status === "approved_pending_helper_confirmation" ? (
        <InsightBanner
          body="請等小幫手確認實際買到數量。確認後才會變成 completed 並出現在暫存訂單預覽。"
          title="已通過，待小幫手最終確認"
          tone="green"
        />
      ) : null}

      {task.status === "review_pending" ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={reviewPending} size="sm" type="button" onClick={() => onReview("approve")}>
            {reviewPending ? "處理中..." : "審核通過"}
          </Button>
          <Button disabled={reviewPending} size="sm" type="button" variant="outline" onClick={() => onReview("reject")}>
            {reviewPending ? "處理中..." : "重拍"}
          </Button>
        </div>
      ) : null}

      {primaryPhotos.length ? (
        <div className="grid gap-2 rounded-2xl border bg-card p-3 shadow-sm">
          <p className="text-sm font-semibold">挑臉／回傳照片</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {primaryPhotos.map((photo: any, index: number) => (
              <div className="relative" key={photo.id}>
                <PhotoViewerTrigger
                  alt={photo.photo_role}
                  className="aspect-square rounded-lg border"
                  photo={photo}
                />
                <span className="pointer-events-none absolute left-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/70 text-xs font-semibold text-white">
                  {index + 1}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">
          目前沒有挑臉或回傳照片。
        </div>
      )}
      <HiddenPurchasePhotos
        allPhotosLoaded={allPhotosLoaded}
        loading={allPhotosLoading}
        photos={hiddenPhotos}
        onLoad={onLoadAllPhotos}
      />
    </section>
  );
}

function HiddenPurchasePhotos({
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
        <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        {loading ? "載入中..." : "查看商品圖"}
      </Button>
    );
  }
  if (!photos.length) return null;
  return (
    <div className="grid gap-2 rounded-2xl border bg-card p-3 shadow-sm">
      <p className="text-sm font-semibold">商品圖</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo: any, index: number) => (
          <div className="relative" key={photo.id}>
            <PhotoViewerTrigger
              alt={photo.photo_role}
              className="aspect-square rounded-lg border"
              photo={photo}
            />
            <span className="pointer-events-none absolute left-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/70 text-xs font-semibold text-white">
              {index + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminPurchaseFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold">{value}</p>
    </div>
  );
}

function purchaseLanes(tasks: PurchaseTaskSummary[]) {
  return [
    {
      tasks: tasks.filter((task) => task.status === "open"),
      title: "待處理",
      tone: "blue" as const,
    },
    {
      tasks: tasks.filter((task) => task.status === "review_pending"),
      title: "挑臉待審",
      tone: "amber" as const,
    },
    {
      tasks: tasks.filter((task) => task.status === "approved_pending_helper_confirmation"),
      title: "待小幫手確認",
      tone: "amber" as const,
    },
    {
      tasks: tasks.filter((task) => task.status === "completed"),
      title: "已完成",
      tone: "green" as const,
    },
    {
      tasks: tasks.filter((task) => ["canceled", "unavailable", "not_found"].includes(task.status)),
      title: "取消／未購得",
      tone: "red" as const,
    },
  ];
}

function purchaseProgress(task: PurchaseTaskSummary) {
  const completed = task.status === "completed" ? Number(task.completed_quantity || 0) : 0;
  return `${completed}/${Number(task.quantity || 0)}`;
}

function purchaseTypeLabel(task: PurchaseTaskSummary) {
  if (task.status === "review_pending") return "挑臉採買 · 等待審核";
  if (task.status === "approved_pending_helper_confirmation") return "挑臉採買 · 待確認";
  return task.requires_face_check ? "挑臉採買" : "一般採買";
}

function purchaseStatusLabel(status: string) {
  if (status === "open") return "待採買";
  if (status === "review_pending") return "等待審核";
  if (status === "approved_pending_helper_confirmation") return "待確認";
  if (status === "completed") return "已完成";
  if (status === "unavailable") return "缺貨";
  if (status === "not_found") return "找不到";
  if (status === "canceled") return "已取消";
  return status;
}

function purchaseStatusTone(status: string): "amber" | "blue" | "green" | "neutral" | "red" {
  if (status === "completed") return "green";
  if (status === "review_pending" || status === "approved_pending_helper_confirmation") return "amber";
  if (status === "unavailable" || status === "not_found" || status === "canceled") return "red";
  if (status === "open") return "blue";
  return "neutral";
}

function adminPrimaryPurchasePhotos(photos: any[]) {
  const latestFaceCheck = photos
    .filter((photo) => String(photo.photo_role || "") === "face_check_report")
    .sort(compareNewestPhotoFirst)[0];
  if (latestFaceCheck) return [latestFaceCheck];
  return photos.filter((photo) =>
    ["detail_reply", "purchase_report"].includes(String(photo.photo_role || "")),
  );
}

function adminHiddenPurchasePhotos(photos: any[]) {
  return photos.filter((photo) =>
    !["detail_reply", "purchase_report", "face_check_report"].includes(String(photo.photo_role || "")),
  );
}

function compareNewestPhotoFirst(left: any, right: any) {
  const leftTime = Date.parse(String(left.created_at || ""));
  const rightTime = Date.parse(String(right.created_at || ""));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return String(right.id || "").localeCompare(String(left.id || ""));
}
