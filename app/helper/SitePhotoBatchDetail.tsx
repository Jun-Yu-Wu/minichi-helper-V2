"use client";

import { useCallback } from "react";

import { BackLink } from "../components/BackButton";
import { EmptyState } from "../components/OperationsUi";
import { PhotoViewerTrigger } from "../components/PhotoAnnotationEditor";
import { RetryableError } from "../components/RetryableState";
import { useStaleResource } from "../../src/lib/client-resource-cache";

export function SitePhotoBatchDetail({
  batchId,
  tripId,
}: {
  batchId: string;
  tripId: string;
}) {
  const loadBatch = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(
      `/api/helper/trips/${encodeURIComponent(tripId)}/site-photo-batches/${encodeURIComponent(batchId)}`,
      { cache: "no-store", signal },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "無法載入照片批次。");
    return body.batch || null;
  }, [batchId, tripId]);
  const batchResource = useStaleResource<any | null>({
    fetcher: loadBatch,
    key: `helper:site-photo-batch:${tripId}:${batchId}`,
    staleTimeMs: 30_000,
  });
  const batch = batchResource.data;
  const batchIsLoading = batchResource.isLoading || (batch === undefined && !batchResource.error);

  return (
    <div className="grid gap-3">
      <BackLink
        className="border-border/80 bg-background shadow-sm"
        href={`/helper?tripId=${tripId}&panel=site`}
        label="返回批次列表"
        variant="outline"
      />
      {batchIsLoading ? (
        <div aria-busy="true" aria-label="正在載入照片" className="grid gap-3" role="status">
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[0, 1, 2, 3].map((item) => (
              <div className="aspect-square animate-pulse rounded-md bg-muted" key={item} />
            ))}
          </div>
        </div>
      ) : batchResource.error ? (
        <RetryableError message={batchResource.error} onRetry={() => void batchResource.refresh()} />
      ) : batch ? (
        <>
          <div>
            <h6 className="font-semibold">{sitePhotoBatchName(batch)}</h6>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatBatchTime(batch.created_at)} · {Number(batch.photo_count || 0)} 張照片
            </p>
          </div>
          {batch.photos?.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(batch.photos || []).map((photo: any) => (
                <PhotoViewerTrigger
                  alt={photo.original_filename || "現場照片"}
                  key={photo.id}
                  photo={photo}
                  className="aspect-square"
                />
              ))}
            </div>
          ) : (
            <EmptyState title="這個批次目前沒有照片" body="請返回批次列表查看其他批次。" />
          )}
        </>
      ) : batch === null ? (
        <EmptyState title="找不到這個照片批次" body="批次可能已被移除，請返回列表重新選擇。" />
      ) : null}
    </div>
  );
}

function sitePhotoBatchName(batch: any) {
  const note = String(batch.note || "").trim();
  if (note) return note;
  return `批次${chineseBatchNumber(Number(batch.batch_number || 1))}`;
}

function chineseBatchNumber(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 10) return value === 10 ? "十" : digits[value] || String(value);
  if (value < 20) return `十${digits[value % 10]}`;
  if (value < 100) {
    const remainder = value % 10;
    return `${digits[Math.floor(value / 10)]}十${remainder ? digits[remainder] : ""}`;
  }
  return String(value);
}

function formatBatchTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}
