"use client";

import { useActionState, useMemo, useState } from "react";
import { Camera, Check, RefreshCw, Send, X } from "lucide-react";

import {
  respondPurchaseTaskAction,
  type HelperActionResult,
} from "../actions/helper";
import { Button } from "../components/ui/button";

type FaceCheckPhoto = {
  byteSize: number;
  clientPhotoId: string;
  contentType: string;
  error?: string;
  file: File;
  objectUrl: string;
  originalFilename: string;
  status: "selected" | "uploading" | "uploaded" | "failed";
  storageKey?: string;
};

const initialState: HelperActionResult = {};

export function PurchaseTasks({ tasks }: { tasks: any[] }) {
  if (!tasks.length) {
    return (
      <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        目前沒有採買任務。
      </p>
    );
  }
  const grouped = groupPurchaseTasks(tasks);
  return (
    <div className="grid gap-3">
      {grouped.map((group) => (
        <section className="grid gap-3 rounded-lg border bg-card p-4" key={group.key}>
          <div>
            <h4 className="font-semibold">{group.title}</h4>
            <p className="text-sm text-muted-foreground">
              {group.tasks.length} 筆 · {group.requiresFaceCheck ? "挑臉採買" : "一般採買"}
            </p>
          </div>
          <div className="grid gap-3">
            {group.tasks.map((task) => (
              <PurchaseTaskForm key={task.id} task={task} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PurchaseTaskForm({ task }: { task: any }) {
  const [state, action, pending] = useActionState(respondPurchaseTaskAction, initialState);
  const [purchaseAction, setPurchaseAction] = useState("complete");
  const [completedQuantity, setCompletedQuantity] = useState(String(task.completed_quantity || task.quantity || 1));
  const [faceCheckPhoto, setFaceCheckPhoto] = useState<FaceCheckPhoto | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => createClientId("purchase-response"));

  const faceCheckPhotoJson = useMemo(
    () =>
      faceCheckPhoto?.status === "uploaded" && faceCheckPhoto.storageKey
        ? JSON.stringify({
            byteSize: faceCheckPhoto.byteSize,
            contentType: faceCheckPhoto.contentType,
            originalFilename: faceCheckPhoto.originalFilename,
            storageKey: faceCheckPhoto.storageKey,
          })
        : "",
    [faceCheckPhoto],
  );

  const closed = ["completed", "canceled", "unavailable", "not_found", "review_pending"].includes(task.status);
  const needsFinalConfirmation = task.status === "approved_pending_helper_confirmation";
  const needsFaceCheckUpload = task.requires_face_check && task.status === "open" && purchaseAction === "complete";
  const canSubmit =
    !pending &&
    !closed &&
    (!needsFaceCheckUpload || faceCheckPhoto?.status === "uploaded") &&
    (purchaseAction !== "complete" || Number(completedQuantity) > 0);

  function addFaceCheckPhoto(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (faceCheckPhoto) URL.revokeObjectURL(faceCheckPhoto.objectUrl);
    setFaceCheckPhoto({
      byteSize: file.size,
      clientPhotoId: createClientId("face-check"),
      contentType: file.type || "image/jpeg",
      file,
      objectUrl: URL.createObjectURL(file),
      originalFilename: file.name || "face-check.jpg",
      status: "selected",
    });
  }

  async function uploadFaceCheckPhoto() {
    if (!faceCheckPhoto) return;
    setFaceCheckPhoto((current) => current ? { ...current, error: undefined, status: "uploading" } : current);
    try {
      const presign = await fetch("/api/uploads/presign", {
        body: JSON.stringify({
          clientPhotoId: faceCheckPhoto.clientPhotoId,
          contentType: faceCheckPhoto.contentType,
          fileName: faceCheckPhoto.originalFilename,
          purchaseTaskId: task.id,
          uploadPurpose: "purchase_face_check",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const presignBody = await presign.json();
      if (!presign.ok) throw new Error(presignBody.error || "無法建立上傳網址。");
      const upload = await fetch(presignBody.uploadUrl, {
        body: faceCheckPhoto.file,
        headers: { "content-type": faceCheckPhoto.contentType },
        method: "PUT",
      });
      if (!upload.ok) throw new Error(`R2 上傳失敗 (${upload.status})。`);
      setFaceCheckPhoto((current) => current ? { ...current, status: "uploaded", storageKey: presignBody.storageKey } : current);
    } catch (error) {
      setFaceCheckPhoto((current) =>
        current
          ? {
              ...current,
              error: error instanceof Error ? error.message : "上傳失敗。",
              status: "failed",
            }
          : current,
      );
    }
  }

  function removeFaceCheckPhoto() {
    if (faceCheckPhoto) URL.revokeObjectURL(faceCheckPhoto.objectUrl);
    setFaceCheckPhoto(null);
  }

  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div>
          <h5 className="font-semibold">{task.product_name}</h5>
          <p className="text-sm text-muted-foreground">
            {task.line_community_name} · {task.quantity} 件 · {purchaseStatusLabel(task.status)}
            {task.requires_face_check ? " · 挑臉" : ""}
          </p>
          <p className="mt-1 text-sm">
            JPY {task.original_price_jpy ?? "-"} · TWD {task.sale_price_twd}
          </p>
          {task.note ? <p className="mt-1 text-sm text-muted-foreground">{task.note}</p> : null}
        </div>
        {task.photos?.length ? (
          <div className="grid grid-cols-2 gap-2">
            {task.photos.slice(0, 2).map((photo: any) => (
              <a href={photo.signed_url} key={photo.id} target="_blank" rel="noreferrer">
                <img alt={photo.photo_role} className="size-20 rounded-md object-cover" src={photo.signed_url} />
              </a>
            ))}
          </div>
        ) : null}
      </div>

      {!closed || needsFinalConfirmation ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {!needsFinalConfirmation ? (
              <select value={purchaseAction} onChange={(event) => setPurchaseAction(event.target.value)}>
                <option value="complete">完成採買</option>
                <option value="unavailable">缺貨</option>
                <option value="not_found">找不到</option>
                <option value="cancel">取消</option>
              </select>
            ) : (
              <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                管理員已通過挑臉審核，請確認完成採買。
              </p>
            )}
            {purchaseAction === "complete" || needsFinalConfirmation ? (
              <input
                inputMode="numeric"
                min="1"
                name="completedQuantityVisible"
                placeholder="完成數量"
                value={completedQuantity}
                onChange={(event) => setCompletedQuantity(event.target.value)}
              />
            ) : null}
          </div>

          {needsFaceCheckUpload ? (
            <div className="grid gap-2">
              <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-center">
                <Camera className="size-5" aria-hidden="true" />
                <span className="text-sm">選擇挑臉確認照</span>
                <input
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  onChange={(event) => addFaceCheckPhoto(event.target.files)}
                />
              </label>
              {faceCheckPhoto ? (
                <div className="rounded-md border p-2">
                  <img alt={faceCheckPhoto.originalFilename} className="aspect-square w-full max-w-48 rounded-md object-cover" src={faceCheckPhoto.objectUrl} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button disabled={faceCheckPhoto.status === "uploading" || faceCheckPhoto.status === "uploaded"} size="sm" type="button" variant="outline" onClick={uploadFaceCheckPhoto}>
                      <RefreshCw className="mr-2 size-4" />
                      {faceCheckPhoto.status === "uploaded" ? "已上傳" : "上傳照片"}
                    </Button>
                    <Button size="sm" type="button" variant="ghost" onClick={removeFaceCheckPhoto}>
                      <X className="mr-2 size-4" />
                      移除
                    </Button>
                  </div>
                  {faceCheckPhoto.error ? <p className="mt-1 text-xs text-destructive">{faceCheckPhoto.error}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <form action={action} className="grid gap-2">
            <input name="purchaseTaskId" type="hidden" value={task.id} />
            <input name="purchaseAction" type="hidden" value={needsFinalConfirmation ? "complete" : purchaseAction} />
            <input name="completedQuantity" type="hidden" value={completedQuantity} />
            <input name="unavailableQuantity" type="hidden" value={purchaseAction === "complete" ? Math.max(0, Number(task.quantity) - Number(completedQuantity || 0)) : task.quantity} />
            <input name="faceCheckPhotoJson" type="hidden" value={faceCheckPhotoJson} />
            <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
            <textarea name="helperNote" placeholder="備註，可留空" />
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            {state.ok && state.submissionId === idempotencyKey ? (
              <p className="text-sm text-primary">已送出。</p>
            ) : null}
            <Button disabled={!canSubmit} size="sm" type="submit">
              {needsFinalConfirmation ? <Check className="mr-2 size-4" /> : <Send className="mr-2 size-4" />}
              {pending ? "送出中..." : needsFinalConfirmation ? "確認完成" : "送出採買回報"}
            </Button>
          </form>
        </>
      ) : null}
    </div>
  );
}

function groupPurchaseTasks(tasks: any[]) {
  const groups = new Map<string, { key: string; requiresFaceCheck: boolean; tasks: any[]; title: string }>();
  for (const task of tasks) {
    const key = `${task.product_name}|${task.original_price_jpy ?? ""}|${task.requires_face_check ? "face" : "standard"}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        requiresFaceCheck: Boolean(task.requires_face_check),
        tasks: [],
        title: `${task.product_name} · JPY ${task.original_price_jpy ?? "-"}`,
      });
    }
    groups.get(key)?.tasks.push(task);
  }
  return Array.from(groups.values());
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

function createClientId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}-${randomUuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
