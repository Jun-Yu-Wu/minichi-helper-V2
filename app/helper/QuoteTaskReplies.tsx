"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Camera, RefreshCw, Send, X } from "lucide-react";

import {
  submitQuotePhotoReplyAction,
  type HelperActionResult,
} from "../actions/helper";
import { EmptyState, StatusBadge, Surface } from "../components/OperationsUi";
import { Button } from "../components/ui/button";

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

const initialState: HelperActionResult = {};

export function QuoteTaskReplies({ tasks }: { tasks: any[] }) {
  if (!tasks.length) {
    return <EmptyState title="目前沒有細圖 / 報價任務" body="管理員發布任務後，這裡會只顯示需要你回覆的照片。" />;
  }
  return (
    <div className="grid gap-3">
      {tasks.map((task) => (
        <Surface key={task.id} className="grid gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={task.status === "completed" ? "green" : "blue"}>
                {taskTypeLabel(task.task_type)}
              </StatusBadge>
              <h5 className="font-semibold">{task.product_name || "未命名任務"}</h5>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {completedCount(task.photos)} / {task.photos.length} 張已回覆
            </p>
            {task.instruction ? <p className="mt-1 text-sm">{task.instruction}</p> : null}
            {task.status === "completed" ? (
              <p className="mt-1 text-xs text-primary">這個任務已完成；如需修正，可直接覆蓋回覆。</p>
            ) : null}
          </div>
          <div className="grid gap-3">
            {task.photos.map((photo: any) => (
              <QuotePhotoReplyForm key={photo.id} photo={photo} taskType={task.task_type} />
            ))}
          </div>
        </Surface>
      ))}
    </div>
  );
}

function QuotePhotoReplyForm({ photo, taskType }: { photo: any; taskType: string }) {
  const [state, action, pending] = useActionState(
    submitQuotePhotoReplyAction,
    initialState,
  );
  const [detailPhotos, setDetailPhotos] = useState<DetailPhoto[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => createClientId("quote-reply"));
  const [note, setNote] = useState("");
  const [priceJpy, setPriceJpy] = useState("");

  useEffect(() => {
    if (!state.ok || state.submissionId !== idempotencyKey) return;
    for (const detailPhoto of detailPhotos) URL.revokeObjectURL(detailPhoto.objectUrl);
    setDetailPhotos([]);
    setNote("");
    setPriceJpy("");
    setIdempotencyKey(createClientId("quote-reply"));
  }, [state.ok, state.submissionId]);

  const requiresPrice = taskType === "quote" || taskType === "quote_and_detail";
  const requiresDetail = taskType === "detail" || taskType === "quote_and_detail";
  const detailPhotosJson = useMemo(
    () =>
      JSON.stringify(
        detailPhotos
          .filter((detailPhoto) => detailPhoto.status === "uploaded" && detailPhoto.storageKey)
          .map((detailPhoto) => ({
            byteSize: detailPhoto.byteSize,
            contentType: detailPhoto.contentType,
            originalFilename: detailPhoto.originalFilename,
            sortOrder: detailPhoto.sortOrder,
            storageKey: detailPhoto.storageKey,
          })),
      ),
    [detailPhotos],
  );
  const allDetailsUploaded =
    detailPhotos.length > 0 && detailPhotos.every((detailPhoto) => detailPhoto.status === "uploaded");
  const canSubmit =
    (!requiresPrice || priceJpy.trim().length > 0) &&
    (!requiresDetail || allDetailsUploaded) &&
    !pending;

  function addFiles(files: FileList | null) {
    if (!files) return;
    setDetailPhotos((current) => [
      ...current,
      ...Array.from(files)
        .filter((file) => file.type.startsWith("image/"))
        .map((file, index) => ({
          byteSize: file.size,
          clientPhotoId: createClientId("detail"),
          contentType: file.type || "image/jpeg",
          file,
          objectUrl: URL.createObjectURL(file),
          originalFilename: file.name,
          sortOrder: current.length + index,
          status: "selected" as const,
        })),
    ]);
  }

  async function uploadDetailPhoto(detailPhoto: DetailPhoto) {
    setDetailPhotos((current) =>
      current.map((item) =>
        item.clientPhotoId === detailPhoto.clientPhotoId
          ? { ...item, error: undefined, status: "uploading" }
          : item,
      ),
    );
    try {
      const presign = await fetch("/api/uploads/presign", {
        body: JSON.stringify({
          clientPhotoId: detailPhoto.clientPhotoId,
          contentType: detailPhoto.contentType,
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
        body: detailPhoto.file,
        headers: { "content-type": detailPhoto.contentType },
        method: "PUT",
      });
      if (!upload.ok) throw new Error(`R2 上傳失敗 (${upload.status})。`);
      setDetailPhotos((current) =>
        current.map((item) =>
          item.clientPhotoId === detailPhoto.clientPhotoId
            ? { ...item, status: "uploaded", storageKey: presignBody.storageKey }
            : item,
        ),
      );
    } catch (error) {
      setDetailPhotos((current) =>
        current.map((item) =>
          item.clientPhotoId === detailPhoto.clientPhotoId
            ? {
                ...item,
                error: error instanceof Error ? error.message : "上傳失敗。",
                status: "failed",
              }
            : item,
        ),
      );
    }
  }

  function removeDetailPhoto(clientPhotoId: string) {
    setDetailPhotos((current) => {
      const removed = current.find((detailPhoto) => detailPhoto.clientPhotoId === clientPhotoId);
      if (removed) URL.revokeObjectURL(removed.objectUrl);
      return current
        .filter((detailPhoto) => detailPhoto.clientPhotoId !== clientPhotoId)
        .map((detailPhoto, index) => ({ ...detailPhoto, sortOrder: index }));
    });
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-background p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-[132px_1fr]">
        <a href={photo.signed_url} target="_blank" rel="noreferrer">
          <img
            alt={photo.product_name || "quote task photo"}
            className="aspect-square w-full rounded-md object-cover"
            loading="lazy"
            src={photo.signed_url}
          />
        </a>
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={replyStatusTone(photo.reply_status)}>
              #{photo.sort_order + 1} {replyStatusLabel(photo.reply_status)}
            </StatusBadge>
            {photo.needs_review ? <StatusBadge tone="amber">需確認</StatusBadge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {requiresPrice && requiresDetail
              ? "請回覆 JPY 報價並上傳細節照。"
              : requiresPrice
                ? "請回覆 JPY 報價。"
                : "請上傳商品細節照。"}
          </p>
          {photo.latest_reply ? (
            <div className="rounded-md bg-muted/40 p-2 text-sm">
              <p className="mb-1 text-xs font-medium text-muted-foreground">目前已送出的回覆</p>
              {photo.latest_reply.price_jpy != null ? <p>上次報價：JPY {photo.latest_reply.price_jpy}</p> : null}
              {photo.latest_reply.note ? <p>{photo.latest_reply.note}</p> : null}
            </div>
          ) : null}
        </div>
      </div>

      {requiresPrice ? (
        <label className="grid gap-1">
          <span className="text-sm font-medium">JPY 報價</span>
          <input
            inputMode="numeric"
            name="priceJpy"
            placeholder="例如 4980"
            value={priceJpy}
            onChange={(event) => setPriceJpy(event.target.value)}
          />
        </label>
      ) : null}

      {requiresDetail ? (
        <div className="grid gap-2">
          <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/40 p-3 text-center">
            <Camera className="size-5" aria-hidden="true" />
            <span className="text-sm">選擇細節照</span>
            <input
              className="sr-only"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => addFiles(event.target.files)}
            />
          </label>
          {detailPhotos.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {detailPhotos.map((detailPhoto) => (
                <div key={detailPhoto.clientPhotoId} className="rounded-md border bg-background p-2">
                  <img
                    alt={detailPhoto.originalFilename}
                    className="aspect-square w-full rounded-md object-cover"
                    src={detailPhoto.objectUrl}
                  />
                  <div className="mt-2 grid gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm">
                        {detailPhoto.sortOrder + 1}. {statusLabel(detailPhoto.status)}
                      </p>
                      <button
                        aria-label="移除細節照"
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                        type="button"
                        onClick={() => removeDetailPhoto(detailPhoto.clientPhotoId)}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                    {detailPhoto.error ? <p className="text-xs text-destructive">{detailPhoto.error}</p> : null}
                    {detailPhoto.status !== "uploaded" ? (
                      <Button
                        disabled={detailPhoto.status === "uploading"}
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => uploadDetailPhoto(detailPhoto)}
                      >
                        <RefreshCw className="mr-2 size-4" />
                        {detailPhoto.status === "failed" ? "重試上傳" : "上傳這張"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {detailPhotos.length ? (
            <Button
              disabled={detailPhotos.every((detailPhoto) => detailPhoto.status === "uploaded")}
              size="sm"
              type="button"
              variant="secondary"
              onClick={() => detailPhotos.filter((detailPhoto) => detailPhoto.status !== "uploaded").forEach(uploadDetailPhoto)}
            >
              上傳尚未完成的細節照
            </Button>
          ) : null}
        </div>
      ) : null}

      <form action={action} className="grid gap-3 border-t pt-3">
        <input name="quoteTaskPhotoId" type="hidden" value={photo.id} />
        <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
        <input name="detailPhotosJson" type="hidden" value={detailPhotosJson} />
        <input name="priceJpy" type="hidden" value={priceJpy} />
        <textarea
          name="note"
          placeholder="回覆備註，可留空"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {state.ok && state.submissionId !== idempotencyKey ? (
          <p className="text-sm text-primary">上一筆回覆已送出。</p>
        ) : null}
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        <Button disabled={!canSubmit} type="submit">
          <Send className="mr-2 size-4" />
          {pending ? "送出中..." : photo.reply_status === "replied" ? "更新這張回覆" : "送出這張回覆"}
        </Button>
      </form>
    </div>
  );
}

function completedCount(photos: any[]) {
  return photos.filter((photo) => photo.reply_status === "replied").length;
}

function taskTypeLabel(taskType: string) {
  if (taskType === "quote") return "報價";
  if (taskType === "detail") return "細節照";
  return "報價 + 細節照";
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
  if (status === "uploaded") return "已上傳";
  return "上傳失敗";
}

function createClientId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}-${randomUuid}`;
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}
