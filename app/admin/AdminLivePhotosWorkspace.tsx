"use client";

import { Check, Download, Maximize2, RefreshCw, Share2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../components/ui/button";
import { cn } from "../../src/lib/utils";

type Trip = {
  helper_display_name?: string | null;
  id: string;
  status: string;
  trip_name: string;
};

type SitePhoto = {
  id: string;
  original_filename?: string | null;
  signed_url: string;
  sort_order: number;
};

type SitePhotoBatch = {
  created_at: string;
  id: string;
  note?: string | null;
  photos: SitePhoto[];
};

const REFRESH_MS = 8000;

export function AdminLivePhotosWorkspace({
  initialTripId,
}: {
  initialTripId?: string;
}) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState(initialTripId || "");
  const [batches, setBatches] = useState<SitePhotoBatch[]>([]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [previewPhoto, setPreviewPhoto] = useState<SitePhoto | null>(null);
  const [loadingTrips, setLoadingTrips] = useState(true);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [message, setMessage] = useState("");
  const [photoRefreshNonce, setPhotoRefreshNonce] = useState(0);

  const batchNames = useMemo(() => buildBatchNames(batches), [batches]);
  const allPhotos = useMemo(
    () => batches.flatMap((batch) => batch.photos || []),
    [batches],
  );
  const selectedPhotos = useMemo(
    () => allPhotos.filter((photo) => selectedPhotoIds.has(photo.id)),
    [allPhotos, selectedPhotoIds],
  );

  useEffect(() => {
    let canceled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function loadTrips() {
      try {
        const response = await fetch("/api/admin/live/trips", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "載入失敗");
        if (!canceled) {
          setTrips(data.trips || []);
          setLoadingTrips(false);
        }
      } catch (error) {
        if (!canceled) {
          setMessage(error instanceof Error ? error.message : "載入失敗");
          setLoadingTrips(false);
        }
      }
    }

    loadTrips();
    timer = setInterval(loadTrips, REFRESH_MS);
    return () => {
      canceled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedTripId) {
      setBatches([]);
      setSelectedPhotoIds(new Set());
      return;
    }

    let canceled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function loadPhotos(showLoading = false) {
      if (showLoading) setLoadingPhotos(true);
      try {
        const response = await fetch(
          `/api/admin/live/site-photo-batches?tripId=${encodeURIComponent(selectedTripId)}`,
          { cache: "no-store" },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "載入失敗");
        if (!canceled) {
          setBatches(data.batches || []);
          setSelectedPhotoIds((current) => {
            const available = new Set(
              (data.batches || []).flatMap((batch: SitePhotoBatch) =>
                (batch.photos || []).map((photo) => photo.id),
              ),
            );
            return new Set(Array.from(current).filter((id) => available.has(id)));
          });
        }
      } catch (error) {
        if (!canceled) setMessage(error instanceof Error ? error.message : "載入失敗");
      } finally {
        if (!canceled) setLoadingPhotos(false);
      }
    }

    loadPhotos(true);
    timer = setInterval(() => loadPhotos(false), REFRESH_MS);
    return () => {
      canceled = true;
      if (timer) clearInterval(timer);
    };
  }, [photoRefreshNonce, selectedTripId]);

  function selectTrip(tripId: string) {
    setSelectedTripId(tripId);
    setSelectedPhotoIds(new Set());
    window.history.replaceState(
      null,
      "",
      `/admin?view=live&liveTripId=${encodeURIComponent(tripId)}`,
    );
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

  function clearSelection() {
    setSelectedPhotoIds(new Set());
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
          return new File(
            [blob],
            photo.original_filename || `site-photo-${index + 1}.jpg`,
            { type: blob.type || "image/jpeg" },
          );
        }),
      );
      if (nav.canShare?.({ files })) {
        await nav.share({ files });
        return;
      }
    } catch {
      // Fall through to URL sharing when the browser blocks file sharing.
    }

    await nav.share({
      text: photos.map((photo) => photo.signed_url).join("\n"),
      title: "現場照片",
    });
  }

  return (
    <section className="grid gap-4">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">選擇要監聽的行程</h3>
          <Button
            disabled={loadingPhotos || !selectedTripId}
            onClick={() => setPhotoRefreshNonce((value) => value + 1)}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className={cn("size-4", loadingPhotos ? "animate-spin" : "")} />
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
          <Button type="button">現場照片</Button>
          <Button asChild variant="outline">
            <Link href={`/admin?view=live&liveTripId=${encodeURIComponent(selectedTripId)}&liveSection=quote`}>
              詢價回覆
            </Link>
          </Button>
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

      {selectedTripId ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-sm backdrop-blur">
          <Button
            disabled={!allPhotos.length}
            onClick={selectAllPhotos}
            size="sm"
            type="button"
            variant="outline"
          >
            全選
          </Button>
          <Button
            disabled={!selectedPhotoIds.size}
            onClick={clearSelection}
            size="sm"
            type="button"
            variant="outline"
          >
            取消
          </Button>
          <Button
            disabled={!selectedPhotos.length}
            onClick={() => downloadPhotos(selectedPhotos)}
            size="sm"
            type="button"
          >
            <Download className="size-4" />
            儲存
          </Button>
          <Button
            disabled={!selectedPhotos.length}
            onClick={() => sharePhotos(selectedPhotos)}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Share2 className="size-4" />
            分享
          </Button>
          <span className="ml-auto text-sm text-muted-foreground">
            {selectedPhotoIds.size ? `${selectedPhotoIds.size} / ${allPhotos.length}` : `${allPhotos.length} 張`}
          </span>
        </div>
      ) : null}

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      {selectedTripId ? (
        loadingPhotos && !batches.length ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 12 }).map((_, index) => (
              <div className="aspect-square rounded-md bg-muted" key={index} />
            ))}
          </div>
        ) : batches.length ? (
          <div className="grid gap-6">
            {batches.map((batch) => (
              <section className="grid gap-2" key={batch.id}>
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-semibold">{batchNames.get(batch.id)}</h4>
                  <span className="text-sm text-muted-foreground">
                    {batch.photos?.length || 0} 張
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                  {(batch.photos || []).map((photo) => {
                    const selected = selectedPhotoIds.has(photo.id);
                    return (
                      <button
                        className="group relative aspect-square overflow-hidden rounded-md bg-muted"
                        key={photo.id}
                        onClick={() =>
                          selectedPhotoIds.size ? togglePhoto(photo.id) : setPreviewPhoto(photo)
                        }
                        type="button"
                      >
                        <img
                          alt="現場照片"
                          className="size-full object-cover transition group-hover:scale-[1.02]"
                          loading="lazy"
                          src={photo.signed_url}
                        />
                        <span
                          className={cn(
                            "absolute right-2 top-2 grid size-7 place-items-center rounded-full border text-xs",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-white/80 bg-black/35 text-white",
                          )}
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePhoto(photo.id);
                          }}
                        >
                          {selected ? <Check className="size-4" /> : ""}
                        </span>
                        <span className="absolute bottom-2 right-2 grid size-7 place-items-center rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
                          <Maximize2 className="size-4" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">
            尚未收到現場照片。
          </div>
        )
      ) : null}

      {previewPhoto ? (
        <div className="fixed inset-0 z-50 grid bg-black/90 p-3">
          <button
            aria-label="關閉"
            className="absolute right-3 top-3 grid size-10 place-items-center rounded-full bg-white/10 text-white"
            onClick={() => setPreviewPhoto(null)}
            type="button"
          >
            <X className="size-5" />
          </button>
          <img
            alt="現場照片"
            className="m-auto max-h-[82vh] max-w-full rounded-md object-contain"
            src={previewPhoto.signed_url}
          />
          <div className="mx-auto mt-3 flex max-w-sm justify-center gap-2">
            <Button onClick={() => downloadPhotos([previewPhoto])} type="button">
              <Download className="size-4" />
              儲存
            </Button>
            <Button onClick={() => sharePhotos([previewPhoto])} type="button" variant="secondary">
              <Share2 className="size-4" />
              分享
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function buildBatchNames(batches: SitePhotoBatch[]) {
  const chronological = [...batches].sort((a, b) =>
    `${a.created_at}-${a.id}`.localeCompare(`${b.created_at}-${b.id}`),
  );
  return new Map(
    chronological.map((batch, index) => [
      batch.id,
      batch.note?.trim() || `批次${chineseBatchNumber(index + 1)}`,
    ]),
  );
}

function chineseBatchNumber(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 10) return value === 10 ? "十" : digits[value];
  if (value < 20) return `十${digits[value - 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ""}`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
