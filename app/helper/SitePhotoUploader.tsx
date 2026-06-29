"use client";

import { useEffect, useRef, useState } from "react";
import { ImageUp, RefreshCw, Send, X } from "lucide-react";

import {
  submitSitePhotoBatchAction,
  type HelperActionResult,
} from "../actions/helper";
import { Button } from "../components/ui/button";

type BatchStatus = "uploading" | "completed" | "failed";

type SelectedPhoto = {
  byteSize: number;
  clientPhotoId: string;
  contentType: string;
  error?: string;
  file: File;
  objectUrl: string;
  originalFilename: string;
  sortOrder: number;
  storageKey?: string;
};

type LocalBatch = {
  error?: string;
  id: string;
  note: string;
  photos: SelectedPhoto[];
  status: BatchStatus;
  uploadedCount: number;
};

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2400;
const JPEG_QUALITY = 0.84;

export function SitePhotoUploader({ tripId }: { tripId: string }) {
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [batches, setBatches] = useState<LocalBatch[]>([]);
  const photosRef = useRef<SelectedPhoto[]>([]);
  const batchesRef = useRef<LocalBatch[]>([]);

  useEffect(() => {
    photosRef.current = photos;
    batchesRef.current = batches;
  }, [batches, photos]);

  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.objectUrl);
      for (const batch of batchesRef.current) {
        for (const photo of batch.photos) URL.revokeObjectURL(photo.objectUrl);
      }
    },
    [],
  );

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const currentLength = photos.length;
    const imageFiles = Array.from(files).filter(isImageFile);
    const preparedPhotos = await Promise.all(
      imageFiles.map((file, index) => preparePhoto(file, currentLength + index)),
    );
    setPhotos((current) => [
      ...current,
      ...preparedPhotos.map((photo, index) => ({
        ...photo,
        sortOrder: current.length + index,
      })),
    ]);
  }

  function removePhoto(clientPhotoId: string) {
    setPhotos((current) => {
      const removed = current.find((photo) => photo.clientPhotoId === clientPhotoId);
      if (removed) URL.revokeObjectURL(removed.objectUrl);
      return current
        .filter((photo) => photo.clientPhotoId !== clientPhotoId)
        .map((photo, index) => ({ ...photo, sortOrder: index }));
    });
  }

  async function submitBatch() {
    if (!photos.length || photos.some((photo) => photo.error)) return;
    const batch: LocalBatch = {
      id: createClientId("submission"),
      note,
      photos,
      status: "uploading",
      uploadedCount: 0,
    };
    setBatches((current) => [batch, ...current]);
    setPhotos([]);
    setNote("");
    await processBatch(batch);
  }

  async function processBatch(batch: LocalBatch) {
    updateBatch(batch.id, { error: undefined, status: "uploading" });
    let uploadedCount = batch.photos.filter((photo) => photo.storageKey).length;
    updateBatch(batch.id, { uploadedCount });

    try {
      const uploadedPhotos = await Promise.all(
        batch.photos.map(async (photo) => {
          if (photo.storageKey) return photo;
          const uploadedPhoto = await uploadPhoto(photo);
          uploadedCount += 1;
          updateBatch(batch.id, { uploadedCount });
          return uploadedPhoto;
        }),
      );
      updateBatch(batch.id, { photos: uploadedPhotos });

      const formData = new FormData();
      formData.set("tripId", tripId);
      formData.set("submissionId", batch.id);
      formData.set("note", batch.note);
      formData.set(
        "photosJson",
        JSON.stringify(
          uploadedPhotos.map((photo) => ({
            byteSize: photo.byteSize,
            clientPhotoId: photo.clientPhotoId,
            contentType: photo.contentType,
            originalFilename: photo.originalFilename,
            sortOrder: photo.sortOrder,
            storageKey: photo.storageKey,
          })),
        ),
      );
      const result: HelperActionResult = await submitSitePhotoBatchAction({}, formData);
      if (!result.ok) throw new Error(result.error || "照片批次送出失敗。");
      updateBatch(batch.id, {
        error: undefined,
        photos: uploadedPhotos,
        status: "completed",
        uploadedCount: uploadedPhotos.length,
      });
    } catch (error) {
      updateBatch(batch.id, {
        error: error instanceof Error ? error.message : "照片批次送出失敗。",
        status: "failed",
      });
    }
  }

  async function uploadPhoto(photo: SelectedPhoto) {
    if (photo.byteSize > MAX_UPLOAD_BYTES) {
      throw new Error("照片超過 8MB，請先在手機裁切或降低解析度後再上傳。");
    }
    const presign = await fetch("/api/uploads/presign", {
      body: JSON.stringify({
        clientPhotoId: photo.clientPhotoId,
        contentType: photo.contentType,
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
    return { ...photo, storageKey: presignBody.storageKey };
  }

  function updateBatch(batchId: string, patch: Partial<LocalBatch>) {
    setBatches((current) =>
      current.map((batch) => (batch.id === batchId ? { ...batch, ...patch } : batch)),
    );
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4">
      <div>
        <h4 className="font-semibold">現場照片批次</h4>
        <p className="text-sm text-muted-foreground">
          可一次選多張；手機大圖會先縮到最長邊 {MAX_IMAGE_EDGE}px，單張需小於 8MB。
        </p>
      </div>

      <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 p-4 text-center">
        <ImageUp className="size-6" aria-hidden="true" />
        <span>選擇照片</span>
        <span className="text-xs text-muted-foreground">支援一次多張圖片，HEIC 會盡量以原檔上傳</span>
        <input
          className="sr-only"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => addFiles(event.target.files)}
        />
      </label>

      {photos.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {photos.map((photo) => (
            <div key={photo.clientPhotoId} className="rounded-md border bg-background p-2">
              <img
                src={photo.objectUrl}
                alt={photo.originalFilename}
                className="aspect-square w-full rounded-md object-cover"
              />
              <div className="mt-2 grid gap-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {photo.sortOrder + 1}. {photo.originalFilename}
                  </p>
                  <button
                    aria-label="移除照片"
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                    type="button"
                    onClick={() => removePhoto(photo.clientPhotoId)}
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {photo.error ? <p className="text-xs text-destructive">{photo.error}</p> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3">
        <textarea
          placeholder="批次備註，可留空"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <Button
          disabled={!photos.length || photos.some((photo) => Boolean(photo.error))}
          type="button"
          onClick={submitBatch}
        >
          <Send className="mr-2 size-4" />
          送出照片批次
        </Button>
      </div>

      {batches.length ? (
        <div className="grid gap-3 border-t pt-3">
          <h5 className="text-sm font-semibold">本次送出批次</h5>
          {batches.map((batch) => (
            <article className="rounded-md border bg-background p-3" key={batch.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{batch.photos.length} 張照片</p>
                <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
                  {batchStatusLabel(batch)}
                </span>
              </div>
              {batch.note ? <p className="mt-1 text-sm text-muted-foreground">{batch.note}</p> : null}
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {batch.photos.map((photo) => (
                  <img
                    alt={photo.originalFilename}
                    className="aspect-square w-full rounded-md object-cover"
                    key={photo.clientPhotoId}
                    src={photo.objectUrl}
                  />
                ))}
              </div>
              {batch.error ? <p className="mt-2 text-sm text-destructive">{batch.error}</p> : null}
              {batch.status === "failed" ? (
                <Button
                  className="mt-3"
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => processBatch(batch)}
                >
                  <RefreshCw className="mr-2 size-4" />
                  重試整批
                </Button>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function batchStatusLabel(batch: LocalBatch) {
  if (batch.status === "uploading") {
    return `上傳中 ${batch.uploadedCount}/${batch.photos.length}`;
  }
  if (batch.status === "completed") return "已完成上傳";
  return "上傳失敗";
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
        ? `照片超過 8MB，請先在手機裁切或降低解析度後再上傳。`
        : undefined,
    file: normalized,
    objectUrl: URL.createObjectURL(normalized),
    originalFilename: normalized.name || file.name,
    sortOrder,
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
