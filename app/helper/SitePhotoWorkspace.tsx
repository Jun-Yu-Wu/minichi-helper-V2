"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";

import { EmptyState, InsightBanner } from "../components/OperationsUi";
import { BackButton } from "../components/BackButton";
import { Button } from "../components/ui/button";
import { useStaleResource } from "../../src/lib/client-resource-cache";
import { SitePhotoUploader } from "./SitePhotoUploader";
import { useTripSectionNavigation } from "./TripSectionSwitcher";

type BatchSummary = {
  batch_number: number;
  created_at: string;
  id: string;
  note: string | null;
  photo_count: number;
};

export function SitePhotoWorkspace({
  initialBatches,
  tripId,
}: {
  initialBatches?: BatchSummary[];
  tripId: string;
}) {
  const navigation = useTripSectionNavigation();
  const [localBatchDetailOpen, setLocalBatchDetailOpen] = useState(false);
  const loadBatches = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(
      `/api/helper/trips/${encodeURIComponent(tripId)}/site-photo-batches`,
      { cache: "no-store", signal },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "無法載入照片批次。");
    return (body.batches || []) as BatchSummary[];
  }, [tripId]);
  const batchesResource = useStaleResource<BatchSummary[]>({
    fetcher: loadBatches,
    initialData: initialBatches,
    key: `helper:site-photo-batches:${tripId}`,
    staleTimeMs: 5_000,
  });
  const batches = batchesResource.data || [];

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      {!localBatchDetailOpen ? (
        <BackButton
          label="返回連線"
          onClick={() => navigation?.openWork()}
          type="button"
          variant="outline"
        />
      ) : null}
      <div>
        <p className="text-xs font-semibold uppercase text-muted-foreground">區塊一</p>
        <h5 className="mt-1 text-xl font-semibold tracking-tight">現場大圖</h5>
      </div>
      <SitePhotoUploader
        onBatchSubmitted={() => void batchesResource.refresh()}
        onDetailOpenChange={setLocalBatchDetailOpen}
        tripId={tripId}
      />
      {!localBatchDetailOpen && batchesResource.isLoading ? (
        <div
          aria-label="正在載入照片批次"
          className="grid gap-2 border-t pt-4"
          role="status"
        >
          <div className="h-12 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : !localBatchDetailOpen && batchesResource.error ? (
        <div className="grid gap-2 border-t pt-4">
          <InsightBanner title={batchesResource.error} tone="red" />
          <Button
            className="w-fit"
            onClick={() => void batchesResource.refresh()}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            重新載入
          </Button>
        </div>
      ) : !localBatchDetailOpen && batches.length ? (
        <div className="grid gap-3 border-t pt-4">
          {batches.map((batch) => (
            <Link
              className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3 transition hover:border-primary/30 hover:bg-accent/40"
              href={`/helper?tripId=${tripId}&panel=site&batchId=${batch.id}`}
              key={batch.id}
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">{batchName(batch)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatBatchTime(batch.created_at)} · {Number(batch.photo_count || 0)} 張照片
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      ) : !localBatchDetailOpen ? (
        <EmptyState title="尚無照片批次" body="第一批照片送出後會顯示在這裡。" />
      ) : null}
    </section>
  );
}

function batchName(batch: BatchSummary) {
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
