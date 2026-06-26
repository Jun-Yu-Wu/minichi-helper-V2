"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { ImageUp, RefreshCw, Send, X } from "lucide-react";

import {
  submitSitePhotoBatchAction,
  type HelperActionResult,
} from "../actions/helper";
import { Button } from "../components/ui/button";

type UploadStatus = "selected" | "uploading" | "uploaded" | "failed";

type SelectedPhoto = {
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

export function SitePhotoUploader({ tripId }: { tripId: string }) {
  const [state, action, pending] = useActionState(
    submitSitePhotoBatchAction,
    initialState,
  );
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [submissionId, setSubmissionId] = useState(() => createClientId("submission"));

  useEffect(() => {
    if (!state.ok || state.submissionId !== submissionId) return;
    for (const photo of photos) URL.revokeObjectURL(photo.objectUrl);
    setPhotos([]);
    setNote("");
    setSubmissionId(createClientId("submission"));
  }, [state.ok, state.submissionId]);

  const uploadedPhotosJson = useMemo(
    () =>
      JSON.stringify(
        photos
          .filter((photo) => photo.status === "uploaded" && photo.storageKey)
          .map((photo) => ({
            byteSize: photo.byteSize,
            clientPhotoId: photo.clientPhotoId,
            contentType: photo.contentType,
            originalFilename: photo.originalFilename,
            sortOrder: photo.sortOrder,
            storageKey: photo.storageKey,
          })),
      ),
    [photos],
  );

  const allUploaded = photos.length > 0 && photos.every((photo) => photo.status === "uploaded");
  const hasUploading = photos.some((photo) => photo.status === "uploading");

  function addFiles(files: FileList | null) {
    if (!files) return;
    setPhotos((current) => [
      ...current,
      ...Array.from(files)
        .filter((file) => file.type.startsWith("image/"))
        .map((file, index) => ({
          byteSize: file.size,
          clientPhotoId: createClientId("photo"),
          contentType: file.type || "image/jpeg",
          file,
          objectUrl: URL.createObjectURL(file),
          originalFilename: file.name,
          sortOrder: current.length + index,
          status: "selected" as const,
        })),
    ]);
  }

  async function uploadPhoto(photo: SelectedPhoto) {
    setPhotos((current) =>
      current.map((item) =>
        item.clientPhotoId === photo.clientPhotoId
          ? { ...item, error: undefined, status: "uploading" }
          : item,
      ),
    );
    try {
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
      setPhotos((current) =>
        current.map((item) =>
          item.clientPhotoId === photo.clientPhotoId
            ? { ...item, status: "uploaded", storageKey: presignBody.storageKey }
            : item,
        ),
      );
    } catch (error) {
      setPhotos((current) =>
        current.map((item) =>
          item.clientPhotoId === photo.clientPhotoId
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

  function removePhoto(clientPhotoId: string) {
    setPhotos((current) => {
      const removed = current.find((photo) => photo.clientPhotoId === clientPhotoId);
      if (removed) URL.revokeObjectURL(removed.objectUrl);
      return current
        .filter((photo) => photo.clientPhotoId !== clientPhotoId)
        .map((photo, index) => ({ ...photo, sortOrder: index }));
    });
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4">
      <div>
        <h4 className="font-semibold">現場照片批次</h4>
        <p className="text-sm text-muted-foreground">
          可一次選多張；單張失敗可以重試，成功後再送出批次。
        </p>
      </div>

      <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 p-4 text-center">
        <ImageUp className="size-6" aria-hidden="true" />
        <span>選擇照片</span>
        <span className="text-xs text-muted-foreground">支援一次多張圖片</span>
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
                <p className="text-xs text-muted-foreground">狀態：{statusLabel(photo.status)}</p>
                {photo.error ? <p className="text-xs text-destructive">{photo.error}</p> : null}
                {photo.status !== "uploaded" ? (
                  <Button
                    disabled={photo.status === "uploading"}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => uploadPhoto(photo)}
                  >
                    <RefreshCw className="mr-2 size-4" />
                    {photo.status === "failed" ? "重試上傳" : "上傳這張"}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {photos.length ? (
        <Button
          disabled={hasUploading || photos.every((photo) => photo.status === "uploaded")}
          type="button"
          variant="secondary"
          onClick={() => photos.filter((photo) => photo.status !== "uploaded").forEach(uploadPhoto)}
        >
          上傳尚未完成的照片
        </Button>
      ) : null}

      <form action={action} className="grid gap-3">
        <input type="hidden" name="tripId" value={tripId} />
        <input type="hidden" name="submissionId" value={submissionId} />
        <input type="hidden" name="photosJson" value={uploadedPhotosJson} />
        <textarea
          name="note"
          placeholder="批次備註，可留空"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {state.ok && state.submissionId !== submissionId ? (
          <p className="text-sm text-primary">上一批照片已送出。</p>
        ) : null}
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
        <Button disabled={!allUploaded || pending} type="submit">
          <Send className="mr-2 size-4" />
          {pending ? "送出中..." : "送出照片批次"}
        </Button>
      </form>
    </div>
  );
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
