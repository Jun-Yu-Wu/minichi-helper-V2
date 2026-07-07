"use client";

import { useActionState, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Camera, Check, PackageCheck, RefreshCw, Send, X } from "lucide-react";

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
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  async function openTask(taskId: string) {
    setActiveTaskId(taskId);
    setActiveTask(null);
    setDetailError("");
    setDetailLoading(true);
    const summaryTask = tasks.find((task) => task.id === taskId);
    try {
      const response = await fetch(
        `/api/helper/trips/${encodeURIComponent(summaryTask?.trip_id || "")}/purchase-tasks/${encodeURIComponent(taskId)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "無法載入採買任務。");
      setActiveTask(body.task || null);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "無法載入採買任務。");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeTask() {
    setActiveTaskId(null);
    setActiveTask(null);
    setDetailError("");
    setDetailLoading(false);
  }

  if (activeTaskId) {
    const summaryTask = tasks.find((task) => task.id === activeTaskId);
    return (
      <PurchaseTaskDetail
        error={detailError}
        loading={detailLoading}
        task={activeTask || summaryTask}
        onBack={closeTask}
        onRefresh={() => openTask(activeTaskId)}
      />
    );
  }

  if (!tasks.length) {
    return (
      <div className="rounded-xl border border-dashed bg-card p-5 text-sm shadow-sm">
        <p className="font-semibold text-foreground">目前沒有採買任務</p>
      </div>
    );
  }
  const lanes = [
    {
      emptyText: "目前沒有待採買任務。",
      tasks: tasks.filter((task) => !isCompletedTask(task) && !isCanceledTask(task)),
      title: "待採買",
      tone: "blue" as const,
    },
    {
      emptyText: "",
      tasks: tasks.filter(isCompletedTask),
      title: "已完成",
      tone: "green" as const,
    },
    {
      emptyText: "",
      tasks: tasks.filter(isCanceledTask),
      title: "取消",
      tone: "red" as const,
    },
  ];
  return (
    <Surface className="grid gap-4">
      {lanes.map((lane) =>
        lane.tasks.length || lane.emptyText ? (
          <PurchaseTaskLane
            emptyText={lane.emptyText}
            key={lane.title}
            tasks={lane.tasks}
            title={lane.title}
            tone={lane.tone}
            onOpenTask={openTask}
          />
        ) : null,
      )}
    </Surface>
  );
}

function PurchaseTaskLane({
  emptyText,
  onOpenTask,
  tasks,
  title,
  tone,
}: {
  emptyText: string;
  onOpenTask: (taskId: string) => void;
  tasks: any[];
  title: string;
  tone: "blue" | "green" | "red";
}) {
  return (
    <section className="grid gap-2">
      <p className={`text-sm font-semibold ${tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : ""}`}>
        {title}
      </p>
      {tasks.length ? tasks.map((task) => (
        <button
          className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-accent/30 ${
            tone === "green"
              ? "border-emerald-200 bg-emerald-50/60"
              : tone === "red"
                ? "border-red-200 bg-red-50/60"
                : "bg-background"
          }`}
          key={task.id}
          type="button"
          onClick={() => onOpenTask(task.id)}
        >
          <span className="min-w-0">
            <strong className="block truncate text-base">{purchaseTaskName(task)}</strong>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {purchaseTypeLabel(task)}
            </span>
          </span>
          <StatusBadge tone={tone}>
            {purchaseProgress(task)}
          </StatusBadge>
        </button>
      )) : (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{emptyText}</p>
      )}
    </section>
  );
}

function PurchaseTaskDetail({
  error,
  loading,
  onBack,
  onRefresh,
  task,
}: {
  error: string;
  loading: boolean;
  onBack: () => void;
  onRefresh: () => void;
  task: any | null;
}) {
  return (
    <Surface className="grid gap-4">
      <Button className="w-fit" size="sm" type="button" variant="ghost" onClick={onBack}>
        <ArrowLeft className="size-4" />
        回任務列表
      </Button>
      {loading && !task ? (
        <div className="grid gap-3" role="status" aria-label="正在載入採買任務">
          <div className="aspect-square animate-pulse rounded-lg bg-muted" />
          <div className="h-28 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : error ? (
        <div className="grid gap-2">
          <p className="text-sm text-destructive">{error}</p>
          <Button className="w-fit" size="sm" type="button" variant="outline" onClick={onRefresh}>
            <RefreshCw className="size-4" />
            重新載入
          </Button>
        </div>
      ) : task ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                {purchaseTypeLabel(task)}
              </p>
              <h5 className="mt-1 truncate text-xl font-semibold tracking-tight">{purchaseTaskName(task)}</h5>
            </div>
            <StatusBadge tone={isCompletedTask(task) ? "green" : isCanceledTask(task) ? "red" : "neutral"}>
              {purchaseProgress(task)}
            </StatusBadge>
          </div>
          <PurchaseTaskPhotos photos={task.photos || []} />
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Meta label="需採買數量" value={`${task.quantity} 件`} />
            <Meta label="商品原價" value={`JPY ${task.original_price_jpy ?? "-"}`} />
          </dl>
          <InsightBanner
            body="請確認現場商品與原價是否正確，再送出採買回覆。"
            title="核對採買資訊"
            tone="amber"
          />
          {task.note ? (
            <InsightBanner body={task.note} title="管理員備註" tone="neutral" />
          ) : null}
          <PurchaseResponseForm task={task} />
        </>
      ) : (
        <EmptyState title="找不到這個採買任務" body="請返回任務列表重新選擇。" />
      )}
    </Surface>
  );
}

function PurchaseTaskPhotos({ photos }: { photos: any[] }) {
  if (!photos.length) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        這個採買任務沒有參考照片。
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {photos.map((photo, index) => (
        <a href={photo.signed_url} key={photo.id} target="_blank" rel="noreferrer">
          <div className="relative">
            <img
              alt={photo.photo_role}
              className="aspect-square w-full rounded-lg border object-cover"
              loading="lazy"
              src={photo.signed_url}
            />
            <span className="absolute left-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/70 text-xs font-semibold text-white">
              {index + 1}
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}

function PurchaseResponseForm({ task }: { task: any }) {
  const [state, action, pending] = useActionState(respondPurchaseTaskAction, initialState);
  const [purchaseAction, setPurchaseAction] = useState("complete");
  const [completedQuantity, setCompletedQuantity] = useState(String(task.completed_quantity || task.quantity || 1));
  const [helperNote, setHelperNote] = useState("");
  const [remainingResolution, setRemainingResolution] = useState("");
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
  const requestedQuantity = Number(task.quantity || 0);
  const completedQuantityNumber = Number(completedQuantity || 0);
  const isPartial =
    purchaseAction === "complete" &&
    completedQuantityNumber > 0 &&
    completedQuantityNumber < requestedQuantity;
  const needsReason = purchaseAction !== "complete" || isPartial;
  const canSubmit =
    !pending &&
    !closed &&
    (!needsFaceCheckUpload || faceCheckPhoto?.status === "uploaded") &&
    (purchaseAction !== "complete" || completedQuantityNumber > 0) &&
    completedQuantityNumber <= requestedQuantity &&
    (!isPartial || Boolean(remainingResolution)) &&
    (!needsReason || Boolean(helperNote.trim()));

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
    <div className="grid gap-4 rounded-lg border bg-background p-3 sm:p-4">
      {closed && task.helper_note ? (
        <InsightBanner body={task.helper_note} title="小幫手回報" tone="neutral" />
      ) : null}
      {task.status === "review_pending" ? (
        <InsightBanner
          body="挑臉確認照已送出。管理員還沒審核前，這筆不會進入暫存訂單，也會擋住結束行程。"
          title="等待管理員挑臉審核"
          tone="amber"
        />
      ) : null}
      {needsFinalConfirmation ? (
        <InsightBanner
          body="管理員已通過照片。請確認實際買到數量；送出後才會建立 completed 採買結果與暫存訂單預覽。"
          title="最後確認後才算完成"
          tone="green"
        />
      ) : null}
      {task.status === "completed" ? (
        <InsightBanner
          body="這筆已可進入暫存訂單預覽，後續仍需管理員審核與明確合併才會寫入主訂單。"
          title="已建立完成採買結果"
          tone="green"
        />
      ) : null}
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
                body="確認後才會建立 completed 採買結果與暫存訂單預覽。"
                title="管理員已通過挑臉審核"
                tone="green"
              />
            )}
            {purchaseAction === "complete" || needsFinalConfirmation ? (
              <label className="grid gap-1 text-sm">
                <span className="font-medium">實際買到數量</span>
                <input
                  inputMode="numeric"
                  max={task.quantity}
                  min="1"
                  name="completedQuantityVisible"
                  placeholder="完成數量"
                  value={completedQuantity}
                  onChange={(event) => setCompletedQuantity(event.target.value)}
                />
              </label>
            ) : null}
          </div>

          {isPartial ? (
            <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-start gap-2 text-amber-950">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold">還有 {requestedQuantity - completedQuantityNumber} 件未購得</p>
                  <p className="mt-1 text-xs leading-5">完成部分數量前，請選擇剩餘商品的處理結果並留下原因。</p>
                </div>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="font-medium">剩餘數量處理</span>
                <select
                  value={remainingResolution}
                  onChange={(event) => setRemainingResolution(event.target.value)}
                >
                  <option value="">請選擇</option>
                  <option value="unavailable">缺貨</option>
                  <option value="not_found">未找到</option>
                  <option value="canceled">取消購買</option>
                </select>
              </label>
            </div>
          ) : null}

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
            <input name="remainingResolution" type="hidden" value={remainingResolution} />
            <label className="grid gap-1 text-sm">
              <span className="font-medium">
                {needsReason ? "原因（必填）" : "採買備註（選填）"}
              </span>
              <textarea
                name="helperNote"
                placeholder={
                  isPartial
                    ? "例如：剩餘尺寸缺貨，現場已確認無庫存"
                    : purchaseAction === "complete"
                      ? "可補充商品狀態或現場資訊"
                      : "請說明無法完成採買的原因"
                }
                required={needsReason}
                value={helperNote}
                onChange={(event) => setHelperNote(event.target.value)}
              />
            </label>
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            {state.ok && state.submissionId === idempotencyKey ? (
              <p className="text-sm text-primary">已送出。</p>
            ) : null}
            <Button disabled={!canSubmit} type="submit">
              {needsFinalConfirmation ? <Check className="mr-2 size-4" /> : purchaseAction === "complete" ? <PackageCheck className="mr-2 size-4" /> : <Send className="mr-2 size-4" />}
              {pending
                ? "送出中..."
                : needsFinalConfirmation
                  ? "確認完成"
                  : purchaseAction === "complete"
                    ? isPartial
                      ? `完成 ${completedQuantityNumber} 件並結案`
                      : "確認完成採買"
                    : "確認回報未購得"}
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

function isCompletedTask(task: any) {
  return task.status === "completed";
}

function isCanceledTask(task: any) {
  return ["canceled", "unavailable", "not_found"].includes(task.status);
}

function purchaseTaskName(task: any) {
  return String(task.product_name || "").trim() || "未命名採買";
}

function purchaseTypeLabel(task: any) {
  if (task.status === "review_pending") return "挑臉採買 · 等待審核";
  if (task.status === "approved_pending_helper_confirmation") return "挑臉採買 · 待確認";
  return task.requires_face_check ? "挑臉採買" : "一般採買";
}

function purchaseProgress(task: any) {
  const quantity = Math.max(Number(task.quantity || 0), 0);
  const completed = isCompletedTask(task)
    ? Math.max(Number(task.completed_quantity || 0), 0)
    : 0;
  return `${completed}/${quantity}`;
}

function createClientId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}-${randomUuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
