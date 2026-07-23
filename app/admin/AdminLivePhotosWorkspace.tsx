"use client";

import { Check, Download, Maximize2, RefreshCw, Share2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { Button } from "../components/ui/button";
import { PhotoLightbox } from "../components/PhotoAnnotationEditor";
import { RetryableError } from "../components/RetryableState";
import { cn } from "../../src/lib/utils";
import { useStaleResource } from "../../src/lib/client-resource-cache";
import { useAdminLiveTrips, type AdminLiveTrip } from "./useAdminLiveTrips";

type Trip = AdminLiveTrip;

type SitePhoto = {
  id: string;
  original_filename?: string | null;
  storage_key?: string | null;
  signed_url: string;
  sort_order: number;
};

type SitePhotoBatchSummary = {
  batch_number?: number;
  created_at: string;
  id: string;
  note?: string | null;
  photo_count: number;
};

type SitePhotoBatch = SitePhotoBatchSummary & { photos: SitePhoto[] };

export function AdminLivePhotosWorkspace({
  initialTripId,
  initialTrips,
}: {
  initialTripId?: string;
  initialTrips?: Trip[];
}) {
  const { loadTrips: refreshTrips, loadingTrips, trips, tripsError } = useAdminLiveTrips(initialTrips);
  const [selectedTripId, setSelectedTripId] = useState(initialTripId || "");
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [previewPhoto, setPreviewPhoto] = useState<SitePhoto | null>(null);
  const [message, setMessage] = useState("");

  const loadBatchSummaries = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(
      `/api/admin/live/site-photo-batches?tripId=${encodeURIComponent(selectedTripId)}`,
      { cache: "no-store", signal },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "現場照片批次載入失敗。");
    return (body.batches || []) as SitePhotoBatchSummary[];
  }, [selectedTripId]);
  const batchList = useStaleResource<SitePhotoBatchSummary[]>({
    enabled: Boolean(selectedTripId),
    fetcher: loadBatchSummaries,
    key: `admin:live-photo-batches:${selectedTripId || "none"}`,
    refreshIntervalMs: 8_000,
    staleTimeMs: 5_000,
  });

  const loadBatchDetail = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(
      `/api/admin/live/site-photo-batches/${encodeURIComponent(selectedBatchId)}?tripId=${encodeURIComponent(selectedTripId)}`,
      { cache: "no-store", signal },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "現場照片載入失敗。");
    return body.batch as SitePhotoBatch;
  }, [selectedBatchId, selectedTripId]);
  const batchDetail = useStaleResource<SitePhotoBatch | null>({
    enabled: Boolean(selectedTripId && selectedBatchId),
    fetcher: loadBatchDetail,
    key: `admin:live-photo-batch:${selectedTripId || "none"}:${selectedBatchId || "none"}`,
    staleTimeMs: 30_000,
  });

  const batches = batchList.data || [];
  const activeBatch = batchDetail.data;
  const allPhotos = activeBatch?.photos || [];
  const selectedPhotos = useMemo(
    () => allPhotos.filter((photo) => selectedPhotoIds.has(photo.id)),
    [allPhotos, selectedPhotoIds],
  );
  const batchNames = useMemo(() => buildBatchNames(batches), [batches]);
  const loadError = batchList.error || batchDetail.error || tripsError;

  function selectTrip(tripId: string) {
    setSelectedTripId(tripId);
    setSelectedBatchId("");
    setSelectedPhotoIds(new Set());
    setPreviewPhoto(null);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "live");
    url.searchParams.set("liveTripId", tripId);
    url.searchParams.set("liveSection", "photos");
    window.history.replaceState(window.history.state, "", url.toString());
  }

  function selectBatch(batchId: string) {
    setSelectedBatchId(batchId);
    setSelectedPhotoIds(new Set());
    setPreviewPhoto(null);
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
    setSelectedPhotoIds(new Set(allPhotos.map((photo) => photo.id)));
  }

  async function downloadPhotos(photos: SitePhoto[]) {
    if (!photos.length) return;
    for (const [index, photo] of photos.entries()) {
      const link = document.createElement("a");
      link.href = photo.signed_url;
      link.download = photo.original_filename || `site-photo-${index + 1}.jpg`;
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
      await wait(160);
    }
    setMessage(`${photos.length} 張照片已送出儲存。`);
  }

  async function sharePhotos(photos: SitePhoto[]) {
    if (!photos.length) return;
    const nav = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
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
          return new File([blob], photo.original_filename || `site-photo-${index + 1}.jpg`, {
            type: blob.type || "image/jpeg",
          });
        }),
      );
      if (nav.canShare?.({ files })) {
        await nav.share({ files });
        return;
      }
    } catch {
      // Fall through to URL sharing when the browser blocks file sharing.
    }
    await nav.share({ text: photos.map((photo) => photo.signed_url).join("\n"), title: "現場照片" });
  }

  return (
    <section className="grid gap-4">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">選擇要監聽的行程</h3>
          <Button
            disabled={batchList.isRefreshing || loadingTrips}
            onClick={() => {
              if (selectedTripId) void batchList.refresh();
              else void refreshTrips();
              if (selectedBatchId) void batchDetail.refresh();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn("size-4", batchList.isRefreshing ? "animate-spin" : "")} />
            刷新
          </Button>
        </div>
        {loadingTrips ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((item) => <div className="h-20 rounded-lg border bg-muted/60" key={item} />)}
          </div>
        ) : trips.length ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip) => (
              <button
                className={cn(
                  "rounded-lg border bg-card p-3 text-left shadow-sm transition",
                  selectedTripId === trip.id ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/50",
                )}
                key={trip.id}
                onClick={() => selectTrip(trip.id)}
                type="button"
              >
                <p className="font-semibold">{trip.trip_name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{trip.helper_display_name || "未指派"}</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">目前沒有進行中的行程。</div>
        )}
      </div>

      {selectedTripId ? (
        <nav aria-label="即時回傳工作區" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Button type="button">現場照片</Button>
          <Button asChild variant="outline"><Link href={`/admin?view=live&liveTripId=${encodeURIComponent(selectedTripId)}&liveSection=quote`}>詢價回覆</Link></Button>
          <Button asChild variant="outline"><Link href={`/admin?view=live&liveTripId=${encodeURIComponent(selectedTripId)}&liveSection=purchase`}>採買任務</Link></Button>
          <Button asChild variant="outline"><Link href={`/admin?view=live&liveTripId=${encodeURIComponent(selectedTripId)}&liveSection=staging`}>暫存訂單</Link></Button>
        </nav>
      ) : null}

      {loadError ? (
        <RetryableError
          message={loadError}
          onRetry={() => {
            if (selectedTripId) void batchList.refresh();
            else void refreshTrips();
            if (selectedBatchId) void batchDetail.refresh();
          }}
        />
      ) : null}
      {message ? <p aria-live="polite" className="text-sm text-muted-foreground" role="status">{message}</p> : null}

      {selectedTripId ? (
        selectedBatchId ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Button className="mb-2" onClick={() => selectBatch("")} size="sm" type="button" variant="outline">返回批次列表</Button>
                <h4 className="font-semibold">{activeBatch ? batchNames.get(activeBatch.id) || activeBatch.note || "現場照片" : "現場照片"}</h4>
                {activeBatch ? <p className="mt-1 text-sm text-muted-foreground">{activeBatch.photos.length} 張照片</p> : null}
              </div>
              {activeBatch ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button disabled={!allPhotos.length} onClick={selectAllPhotos} size="sm" type="button" variant="outline">全選</Button>
                  <Button disabled={!selectedPhotoIds.size} onClick={() => setSelectedPhotoIds(new Set())} size="sm" type="button" variant="outline">取消</Button>
                  <Button disabled={!selectedPhotos.length} onClick={() => void downloadPhotos(selectedPhotos)} size="sm" type="button"><Download className="size-4" />儲存</Button>
                  <Button disabled={!selectedPhotos.length} onClick={() => void sharePhotos(selectedPhotos)} size="sm" type="button" variant="secondary"><Share2 className="size-4" />分享</Button>
                  <span className="text-sm text-muted-foreground">{selectedPhotoIds.size ? `${selectedPhotoIds.size} / ${allPhotos.length}` : `${allPhotos.length} 張`}</span>
                </div>
              ) : null}
            </div>
            {batchDetail.isLoading && !activeBatch ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">{Array.from({ length: 12 }).map((_, index) => <div className="aspect-square rounded-md bg-muted" key={index} />)}</div>
            ) : activeBatch?.photos.length ? (
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                {activeBatch.photos.map((photo) => {
                  const selected = selectedPhotoIds.has(photo.id);
                  return (
                    <button className="group relative aspect-square overflow-hidden rounded-md bg-muted" key={photo.id} onClick={() => selectedPhotoIds.size ? togglePhoto(photo.id) : setPreviewPhoto(photo)} type="button">
                      <img alt={photo.original_filename || "現場照片"} className="size-full object-cover transition group-hover:scale-[1.02]" loading="lazy" src={photo.signed_url} />
                      <span className={cn("absolute right-2 top-2 grid size-7 place-items-center rounded-full border text-xs", selected ? "border-primary bg-primary text-primary-foreground" : "border-white/80 bg-black/35 text-white")} onClick={(event) => { event.stopPropagation(); togglePhoto(photo.id); }}>{selected ? <Check className="size-4" /> : ""}</span>
                      <span className="absolute bottom-2 right-2 grid size-7 place-items-center rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100"><Maximize2 className="size-4" /></span>
                    </button>
                  );
                })}
              </div>
            ) : batchDetail.isLoading ? null : (
              <div className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">尚未收到現場照片。</div>
            )}
          </div>
        ) : batchList.isLoading && !batches.length ? (
          <div className="grid gap-3">{Array.from({ length: 3 }).map((_, index) => <div className="h-20 animate-pulse rounded-lg border bg-muted" key={index} />)}</div>
        ) : batches.length ? (
          <div className="grid gap-2">
            <h4 className="font-semibold">照片批次</h4>
            {batches.map((batch) => (
              <button className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-left transition hover:border-primary/50" key={batch.id} onClick={() => selectBatch(batch.id)} type="button">
                <span className="min-w-0"><span className="block truncate font-semibold">{batchNames.get(batch.id) || batch.note || "照片批次"}</span><span className="mt-1 block text-xs text-muted-foreground">{formatBatchTime(batch.created_at)}</span></span>
                <span className="shrink-0 text-sm text-muted-foreground">{batch.photo_count} 張照片</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">尚未收到現場照片。</div>
        )
      ) : null}

      {previewPhoto ? (
        <PhotoLightbox
          alt={previewPhoto.original_filename || "現場照片"}
          onClose={() => setPreviewPhoto(null)}
          photo={previewPhoto}
        />
      ) : null}
    </section>
  );
}

function buildBatchNames(batches: SitePhotoBatchSummary[]) {
  const chronological = [...batches].sort((a, b) => `${a.created_at}-${a.id}`.localeCompare(`${b.created_at}-${b.id}`));
  return new Map(chronological.map((batch, index) => [batch.id, batch.note?.trim() || `批次${chineseBatchNumber(batch.batch_number || index + 1)}`]));
}

function chineseBatchNumber(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 10) return value === 10 ? "十" : digits[value];
  if (value < 20) return `十${digits[value - 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ""}`;
}

function formatBatchTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
