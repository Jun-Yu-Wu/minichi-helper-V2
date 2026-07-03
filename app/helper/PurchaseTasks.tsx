"use client";

import { useActionState, useMemo, useState } from "react";
import { Camera, Check, RefreshCw, Send, X } from "lucide-react";

import {
  respondPurchaseTaskAction,
  type HelperActionResult,
} from "../actions/helper";
import { EmptyState, InsightBanner, StatusBadge, Surface } from "../components/OperationsUi";
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
    return <EmptyState title="目前沒有採買任務" body="管理員發布採買後，會依商品與挑臉需求分組顯示在這裡。" />;
  }
  const grouped = groupPurchaseTasks(tasks);
  return (
    <div className="grid gap-3">
      {grouped.map((group) => (
        <Surface className="grid gap-3" key={group.key}>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={group.requiresFaceCheck ? "amber" : "neutral"}>
                {group.requiresFaceCheck ? "挑臉採買" : "一般採買"}
              </StatusBadge>
              <h4 className="font-semibold">{group.title}</h4>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{group.tasks.length} 筆同類任務</p>
          </div>
          <div className="grid gap-3">
            {group.tasks.map((task) => (
              <PurchaseTaskForm key={task.id} task={task} />
            ))}
          </div>
        </Surface>
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

  const statusTone = purchaseStatusTone(task.status);
  return (
    <div className="grid gap-4 rounded-lg border bg-background p-3 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={statusTone}>{purchaseStatusLabel(task.status)}</StatusBadge>
            {task.requires_face_check ? <StatusBadge tone="amber">需挑臉</StatusBadge> : null}
          </div>
          <h5 className="mt-2 text-lg font-semibold tracking-tight">{task.product_name}</h5>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <Meta label="客人" value={task.line_community_name || "未填"} />
            <Meta label="數量" value={`${task.quantity} 件`} />
            <Meta label="原價" value={`JPY ${task.original_price_jpy ?? "-"}`} />
            <Meta label="售價" value={`TWD ${task.sale_price_twd}`} />
          </dl>
          {task.note ? (
            <InsightBanner body={task.note} title="管理員備註" tone="neutral" />
          ) : null}
        </div>
        {task.photos?.length ? (
          <div className="grid grid-cols-3 gap-2 lg:w-56">
            {task.photos.slice(0, 2).map((photo: any) => (
              <a href={photo.signed_url} key={photo.id} target="_blank" rel="noreferrer">
                <img alt={photo.photo_role} className="aspect-square w-full rounded-md border object-cover" src={photo.signed_url} />
              </a>
            ))}
            {task.photos.length > 2 ? (
              <span className="flex aspect-square items-center justify-center rounded-md border bg-muted text-sm font-semibold text-muted-foreground">
                +{task.photos.length - 2}
              </span>
            ) : null}
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
              <InsightBanner
                body="確認後才會建立 completed 採買結果與 staging preview。"
                title="管理員已通過挑臉審核"
                tone="green"
              />
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
          <div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-950">挑臉任務：先上傳確認照，等待管理員審核後再完成採買。</p>
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
                <div className="rounded-md border bg-background p-2">
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

          <form action={action} className="grid gap-3 border-t pt-3">
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
            <Button disabled={!canSubmit} type="submit">
              {needsFinalConfirmation ? <Check className="mr-2 size-4" /> : <Send className="mr-2 size-4" />}
              {pending ? "送出中..." : needsFinalConfirmation ? "確認完成" : "送出採買回報"}
            </Button>
          </form>
        </>
      ) : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/45 px-3 py-2">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold text-foreground">{value}</dd>
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

function purchaseStatusTone(status: string): "amber" | "blue" | "green" | "neutral" | "red" {
  if (status === "completed") return "green";
  if (status === "review_pending" || status === "approved_pending_helper_confirmation") return "amber";
  if (status === "unavailable" || status === "not_found" || status === "canceled") return "red";
  if (status === "open") return "blue";
  return "neutral";
}

function createClientId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}-${randomUuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
