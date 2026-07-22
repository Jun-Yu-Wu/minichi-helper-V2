"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  ImageUp,
  LoaderCircle,
  RefreshCw,
  Send,
  X,
} from "lucide-react";

import {
  submitSitePhotoBatchAction,
  type HelperActionResult,
} from "../actions/helper";
import { BackButton } from "../components/BackButton";
import { InsightBanner, StatusBadge } from "../components/OperationsUi";
import { Button } from "../components/ui/button";
import {
  type BatchStatus,
  type LocalBatch,
  type PhotoUploadStatus,
  type SelectedPhoto,
  useSitePhotoUploadStore,
} from "./SitePhotoUploadStore";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2400;
const JPEG_QUALITY = 0.84;

export function SitePhotoUploader({
  onBatchSubmitted,
  onDetailOpenChange,
  tripId,
}: {
  onBatchSubmitted?: () => void;
  onDetailOpenChange?: (open: boolean) => void;
  tripId: string;
}) {
  const { sessions, updateSession } = useSitePhotoUploadStore();
  const savedSession = sessions[tripId];
  const [note, setNote] = useState(() => savedSession?.note || "");
  const [photos, setPhotos] = useState<SelectedPhoto[]>(() => savedSession?.photos || []);
  const [batches, setBatches] = useState<LocalBatch[]>(() => savedSession?.batches || []);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const photosRef = useRef<SelectedPhoto[]>([]);
  const batchesRef = useRef<LocalBatch[]>([]);

  useEffect(() => {
    photosRef.current = photos;
    batchesRef.current = batches;
    updateSession(tripId, { batches, note, photos });
  }, [batches, note, photos, tripId, updateSession]);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setIsPreparing(true);
    try {
      const imageFiles = Array.from(files).filter(isImageFile);
      const preparedPhotos = await Promise.all(
        imageFiles.map((file, index) => preparePhoto(file, photosRef.current.length + index)),
      );
      setPhotos((current) => [
        ...current,
        ...preparedPhotos.map((photo, index) => ({
          ...photo,
          sortOrder: current.length + index,
        })),
      ]);
    } finally {
      setIsPreparing(false);
    }
  }

  function removePhoto(clientPhotoId: string) {
    setPhotos((current) => {
      const removed = current.find((photo) => photo.clientPhotoId === clientPhotoId);
      if (removed) URL.revokeObjectURL(removed.objectUrl);
      return resequencePhotos(
        current.filter((photo) => photo.clientPhotoId !== clientPhotoId),
      );
    });
  }

  function movePhoto(clientPhotoId: string, direction: -1 | 1) {
    setPhotos((current) => {
      const currentIndex = current.findIndex((photo) => photo.clientPhotoId === clientPhotoId);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
      return resequencePhotos(next);
    });
  }

  async function submitBatch() {
    if (!photos.length || photos.some((photo) => photo.error)) return;
    const batch: LocalBatch = {
      id: createClientId("submission"),
      note,
      photos: photos.map((photo) => ({
        ...photo,
        uploadError: undefined,
        uploadStatus: photo.storageKey ? "uploaded" : "pending",
      })),
      status: "uploading",
    };
    setBatches((current) => [batch, ...current]);
    setPhotos([]);
    setNote("");
    await processUploads(batch);
  }

  async function processUploads(batch: LocalBatch) {
    updateBatch(batch.id, {
      error: undefined,
      errorStage: undefined,
      status: "uploading",
    });
    const uploadedPhotos = await Promise.all(
      batch.photos.map(async (photo) => {
        if (photo.storageKey) {
          const uploaded = {
            ...photo,
            uploadError: undefined,
            uploadStatus: "uploaded" as const,
          };
          updateBatchPhoto(batch.id, uploaded);
          return uploaded;
        }
        updateBatchPhoto(batch.id, {
          ...photo,
          uploadError: undefined,
          uploadStatus: "uploading",
        });
        try {
          const uploaded = await uploadPhoto(photo);
          updateBatchPhoto(batch.id, uploaded);
          return uploaded;
        } catch (error) {
          const failed = {
            ...photo,
            uploadError: errorMessage(error, "照片上傳失敗。"),
            uploadStatus: "failed" as const,
          };
          updateBatchPhoto(batch.id, failed);
          return failed;
        }
      }),
    );

    const failedCount = uploadedPhotos.filter((photo) => !photo.storageKey).length;
    if (failedCount) {
      updateBatch(batch.id, {
        error: `${failedCount} 張照片尚未上傳，已成功的照片不會重傳。`,
        errorStage: "upload",
        photos: uploadedPhotos,
        status: "failed",
      });
      return;
    }

    const readyBatch = { ...batch, photos: uploadedPhotos, status: "ready" as const };
    updateBatch(batch.id, readyBatch);
    await submitBatchMetadata(readyBatch);
  }

  async function retryPhoto(batchId: string, clientPhotoId: string) {
    const batch = batchesRef.current.find((item) => item.id === batchId);
    const photo = batch?.photos.find((item) => item.clientPhotoId === clientPhotoId);
    if (!batch || !photo || photo.storageKey) return;
    updateBatch(batch.id, {
      error: undefined,
      errorStage: undefined,
      status: "uploading",
    });
    updateBatchPhoto(batch.id, {
      ...photo,
      uploadError: undefined,
      uploadStatus: "uploading",
    });
    try {
      const uploaded = await uploadPhoto(photo);
      const nextPhotos = batch.photos.map((item) =>
        item.clientPhotoId === clientPhotoId ? uploaded : item,
      );
      updateBatch(batch.id, {
        photos: nextPhotos,
        status: nextPhotos.every((item) => item.storageKey) ? "ready" : "failed",
      });
    } catch (error) {
      updateBatchPhoto(batch.id, {
        ...photo,
        uploadError: errorMessage(error, "照片上傳失敗。"),
        uploadStatus: "failed",
      });
      updateBatch(batch.id, {
        error: "這張照片仍未上傳，其他已成功照片會保留。",
        errorStage: "upload",
        status: "failed",
      });
    }
  }

  async function submitBatchMetadata(batch: LocalBatch) {
    if (!batch.photos.length || batch.photos.some((photo) => !photo.storageKey)) return;
    updateBatch(batch.id, {
      error: undefined,
      errorStage: undefined,
      status: "submitting",
    });
    const formData = new FormData();
    formData.set("tripId", tripId);
    formData.set("submissionId", batch.id);
    formData.set("note", batch.note);
    formData.set(
      "photosJson",
      JSON.stringify(
        batch.photos.map((photo) => ({
          byteSize: photo.byteSize,
          clientPhotoId: photo.clientPhotoId,
          contentType: photo.contentType,
          originalFilename: photo.originalFilename,
          sortOrder: photo.sortOrder,
          storageKey: photo.storageKey,
        })),
      ),
    );
    try {
      const result: HelperActionResult = await submitSitePhotoBatchAction({}, formData);
      if (!result.ok) throw new Error(result.error || "照片批次送出失敗。");
      updateBatch(batch.id, {
        error: undefined,
        errorStage: undefined,
        status: "completed",
      });
      onBatchSubmitted?.();
    } catch (error) {
      updateBatch(batch.id, {
        error: errorMessage(error, "照片批次送出失敗。"),
        errorStage: "submit",
        status: "failed",
      });
    }
  }

  async function uploadPhoto(photo: SelectedPhoto): Promise<SelectedPhoto> {
    if (photo.byteSize > MAX_UPLOAD_BYTES) {
      throw new Error("照片超過 8MB，請先在手機裁切或降低解析度後再上傳。");
    }
    const presign = await fetch("/api/uploads/presign", {
      body: JSON.stringify({
        clientPhotoId: photo.clientPhotoId,
        contentType: photo.contentType,
        byteSize: photo.byteSize,
        fileName: photo.originalFilename,
        tripId,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const presignBody = await presign.json();
    if (!presign.ok) throw new Error(presignBody.error || "無法建立上傳網址。");
    const upload = await fetch(presignBody.uploadUrl, {
      body: photo.file,
      headers: { "content-type": photo.contentType },
      method: "PUT",
    });
    if (!upload.ok) throw new Error(`R2 上傳失敗 (${upload.status})。`);
    return {
      ...photo,
      storageKey: presignBody.storageKey,
      uploadError: undefined,
      uploadStatus: "uploaded",
    };
  }

  function updateBatch(batchId: string, patch: Partial<LocalBatch>) {
    setBatches((current) =>
      current.map((batch) => (batch.id === batchId ? { ...batch, ...patch } : batch)),
    );
  }

  function updateBatchPhoto(batchId: string, nextPhoto: SelectedPhoto) {
    setBatches((current) =>
      current.map((batch) =>
        batch.id === batchId
          ? {
              ...batch,
              photos: batch.photos.map((photo) =>
                photo.clientPhotoId === nextPhoto.clientPhotoId ? nextPhoto : photo,
              ),
            }
          : batch,
      ),
    );
  }

  function openBatch(batchId: string) {
    setSelectedBatchId(batchId);
    onDetailOpenChange?.(true);
  }

  function closeBatch() {
    setSelectedBatchId(null);
    onDetailOpenChange?.(false);
  }

  const selectedBatch = selectedBatchId
    ? batches.find((batch) => batch.id === selectedBatchId)
    : null;

  if (selectedBatch) {
    return (
      <div className="grid gap-4">
        <BackButton label="返回批次列表" onClick={closeBatch} type="button" />
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">區塊一</p>
          <h4 className="mt-1 font-semibold">{selectedBatch.note || "現場大圖批次"}</h4>
        </div>
        <LocalBatchCard
          batch={selectedBatch}
          onRetryPhoto={retryPhoto}
          onRetryUpload={processUploads}
          onSubmit={submitBatchMetadata}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <h4 className="font-semibold">上傳現場照片</h4>

      <div className="grid grid-cols-2 gap-3">
        <PhotoPicker
          capture="environment"
          icon={<Camera className="size-5" />}
          label="開啟相機"
          onFiles={addFiles}
        />
        <PhotoPicker
          icon={<ImageUp className="size-5" />}
          label="從相簿選取"
          multiple
          onFiles={addFiles}
        />
      </div>

      {isPreparing ? (
        <InsightBanner
          title="正在準備預覽"
          tone="blue"
        />
      ) : null}

      {photos.length ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((photo, index) => (
              <div key={photo.clientPhotoId} className="rounded-lg border bg-background p-2">
                <div className="relative">
                  <img
                    src={photo.objectUrl}
                    alt={photo.originalFilename}
                    className="aspect-square w-full rounded-md object-cover"
                  />
                  <span className="absolute left-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/70 text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                </div>
                <div className="mt-2 grid gap-2">
                  <p className="truncate text-xs text-muted-foreground">
                    {photo.originalFilename}
                  </p>
                  <div className="grid grid-cols-3 gap-1">
                    <IconButton
                      disabled={index === 0}
                      label="往前移"
                      onClick={() => movePhoto(photo.clientPhotoId, -1)}
                    >
                      <ArrowLeft className="size-4" />
                    </IconButton>
                    <IconButton
                      disabled={index === photos.length - 1}
                      label="往後移"
                      onClick={() => movePhoto(photo.clientPhotoId, 1)}
                    >
                      <ArrowRight className="size-4" />
                    </IconButton>
                    <IconButton
                      label="移除照片"
                      onClick={() => removePhoto(photo.clientPhotoId)}
                    >
                      <X className="size-4" />
                    </IconButton>
                  </div>
                  {photo.error ? <p className="text-xs text-destructive">{photo.error}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3">
        <label className="grid gap-1">
          <span>批次備註（選填）</span>
          <textarea
            placeholder="例如：三麗鷗新品"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <Button
          disabled={
            isPreparing ||
            !photos.length ||
            photos.some((photo) => Boolean(photo.error))
          }
          size="lg"
          type="button"
          onClick={submitBatch}
        >
          <Send className="size-4" />
          上傳 {photos.length ? `${photos.length} 張` : "照片"}
        </Button>
      </div>

      {batches.length ? (
        <div className="grid gap-3 border-t pt-4">
          <h5 className="text-sm font-semibold">本次上傳</h5>
          {batches.map((batch) => {
            return (
              <LocalBatchCard
                batch={batch}
                key={batch.id}
                onOpen={() => openBatch(batch.id)}
                onRetryPhoto={retryPhoto}
                onRetryUpload={processUploads}
                onSubmit={submitBatchMetadata}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function LocalBatchCard({
  batch,
  onOpen,
  onRetryPhoto,
  onRetryUpload,
  onSubmit,
}: {
  batch: LocalBatch;
  onOpen?: () => void;
  onRetryPhoto?: (batchId: string, clientPhotoId: string) => void;
  onRetryUpload?: (batch: LocalBatch) => void;
  onSubmit?: (batch: LocalBatch) => void;
}) {
  const uploadedCount = batch.photos.filter((photo) => photo.storageKey).length;
  const failedPhotos = batch.photos.filter((photo) => photo.uploadStatus === "failed");
  const progressLabel = `${uploadedCount}/${batch.photos.length} 張已上傳`;

  return (
    <article className="rounded-lg border bg-background p-3">
      {onOpen ? (
        <button
          aria-label={`查看${batch.note || "現場大圖批次"}上傳進度`}
          className="flex w-full items-center justify-between gap-2 rounded-md text-left transition hover:bg-accent/40"
          type="button"
          onClick={onOpen}
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium">{progressLabel}</span>
            {batch.note ? (
              <span className="mt-1 block truncate text-sm text-muted-foreground">{batch.note}</span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <StatusBadge tone={batchTone(batch)}>{batchStatusLabel(batch)}</StatusBadge>
            <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
          </span>
        </button>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{progressLabel}</p>
          <StatusBadge tone={batchTone(batch)}>{batchStatusLabel(batch)}</StatusBadge>
        </div>
      )}
      <progress
        aria-label={progressLabel}
        className="mt-3 h-2 w-full overflow-hidden rounded-full"
        max={batch.photos.length || 1}
        value={uploadedCount}
      />
      {batch.note && !onOpen ? (
        <p className="mt-1 text-sm text-muted-foreground">{batch.note}</p>
      ) : null}
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {batch.photos.map((photo) => (
          <div className="grid gap-1" key={photo.clientPhotoId}>
            <div className="relative">
              <img
                alt={photo.originalFilename}
                className="aspect-square w-full rounded-md object-cover"
                loading="lazy"
                src={photo.objectUrl}
              />
              <PhotoStatus status={photo.uploadStatus} />
            </div>
            {photo.uploadStatus === "failed" && onRetryPhoto ? (
              <Button
                className="h-8 px-2 text-xs"
                disabled={batch.status === "uploading"}
                type="button"
                variant="outline"
                onClick={() => onRetryPhoto(batch.id, photo.clientPhotoId)}
              >
                <RefreshCw className="size-3" />
                重試
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {batch.error ? <p className="mt-2 text-sm text-destructive">{batch.error}</p> : null}
      {onRetryUpload && failedPhotos.length > 1 ? (
        <Button
          className="mt-3"
          size="sm"
          type="button"
          variant="outline"
          onClick={() => onRetryUpload(batch)}
        >
          <RefreshCw className="size-4" />
          重試 {failedPhotos.length} 張失敗照片
        </Button>
      ) : null}
      {onSubmit && batch.status === "ready" ? (
        <Button className="mt-3" size="sm" type="button" onClick={() => onSubmit(batch)}>
          <Send className="size-4" />
          完成批次送出
        </Button>
      ) : null}
      {onSubmit && batch.status === "failed" && batch.errorStage === "submit" ? (
        <Button
          className="mt-3"
          size="sm"
          type="button"
          variant="outline"
          onClick={() => onSubmit(batch)}
        >
          <RefreshCw className="size-4" />
          重新送出批次資料
        </Button>
      ) : null}
    </article>
  );
}

function PhotoPicker({
  capture,
  icon,
  label,
  multiple = false,
  onFiles,
}: {
  capture?: "environment";
  icon: React.ReactNode;
  label: string;
  multiple?: boolean;
  onFiles: (files: FileList | null) => Promise<void>;
}) {
  return (
    <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 p-3 text-center transition hover:bg-accent/50">
      {icon}
      <span className="text-sm font-semibold">{label}</span>
      <input
        accept="image/*"
        capture={capture}
        className="sr-only"
        multiple={multiple}
        type="file"
        onChange={(event) => {
          const selected = event.currentTarget.files;
          void onFiles(selected);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function IconButton({
  children,
  disabled = false,
  label,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="flex h-9 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted disabled:opacity-30"
      disabled={disabled}
      title={label}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PhotoStatus({ status }: { status: PhotoUploadStatus }) {
  const content =
    status === "uploaded" ? (
      <Check className="size-3" />
    ) : status === "uploading" ? (
      <LoaderCircle className="size-3 animate-spin" />
    ) : status === "failed" ? (
      <X className="size-3" />
    ) : null;
  if (!content) return null;
  return (
    <span
      className={`absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full text-white ${
        status === "failed" ? "bg-destructive" : status === "uploaded" ? "bg-emerald-600" : "bg-black/70"
      }`}
    >
      {content}
    </span>
  );
}

function batchStatusLabel(batch: LocalBatch) {
  if (batch.status === "uploading") return "照片上傳中";
  if (batch.status === "ready") return "等待送出";
  if (batch.status === "submitting") return "正在建立批次";
  if (batch.status === "completed") return "管理員已可查看";
  return batch.errorStage === "submit" ? "批次送出失敗" : "部分照片失敗";
}

function batchTone(batch: LocalBatch): "blue" | "green" | "red" | "neutral" {
  if (batch.status === "completed") return "green";
  if (batch.status === "failed") return "red";
  if (batch.status === "ready") return "neutral";
  return "blue";
}

function resequencePhotos(photos: SelectedPhoto[]) {
  return photos.map((photo, index) => ({ ...photo, sortOrder: index }));
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function createClientId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}-${randomUuid}`;
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}

async function preparePhoto(file: File, sortOrder: number): Promise<SelectedPhoto> {
  const normalized = await normalizeLargeImage(file).catch(() => file);
  return {
    byteSize: normalized.size,
    clientPhotoId: createClientId("photo"),
    contentType: inferImageContentType(normalized),
    error:
      normalized.size > MAX_UPLOAD_BYTES
        ? "照片超過 8MB，請先在手機裁切或降低解析度後再上傳。"
        : undefined,
    file: normalized,
    objectUrl: URL.createObjectURL(normalized),
    originalFilename: normalized.name || file.name,
    sortOrder,
    uploadStatus: "pending",
  };
}

async function normalizeLargeImage(file: File) {
  if (file.size <= MAX_UPLOAD_BYTES && file.type !== "image/heic" && file.type !== "image/heif") {
    return file;
  }
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], replaceExtension(file.name || "site-photo.jpg", ".jpg"), {
    type: "image/jpeg",
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Image could not be decoded."));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(file.name);
}

function inferImageContentType(file: File) {
  if (file.type.startsWith("image/")) return file.type;
  if (/\.png$/i.test(file.name)) return "image/png";
  if (/\.webp$/i.test(file.name)) return "image/webp";
  if (/\.gif$/i.test(file.name)) return "image/gif";
  if (/\.hei[cf]$/i.test(file.name)) return "image/heic";
  return "image/jpeg";
}

function replaceExtension(fileName: string, extension: string) {
  return fileName.replace(/\.[a-z0-9]+$/i, "") + extension;
}
