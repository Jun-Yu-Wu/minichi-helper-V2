"use client";

import { type FormEvent, type MutableRefObject, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, RefreshCw } from "lucide-react";

import {
  submitSettlementPrecheckAction,
  submitWarehouseProofAction,
  type HelperActionResult,
} from "../actions/helper";
import { InsightBanner, Surface } from "../components/OperationsUi";
import { SettlementAmountHero } from "../components/SettlementUi";
import { Button } from "../components/ui/button";

type UploadPhoto = {
  byteSize: number;
  clientPhotoId: string;
  contentType: string;
  error?: string;
  file: File;
  originalFilename: string;
  status: "selected" | "uploading" | "uploaded" | "failed";
  storageKey?: string;
};

const initialState: HelperActionResult = {};

export function SettlementPrecheckForm({ settlement }: { settlement: any }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(submitSettlementPrecheckAction, initialState);
  const [receipt, setReceipt] = useState<UploadPhoto | null>(null);
  const [transportProof, setTransportProof] = useState<UploadPhoto | null>(null);
  const [idempotencyKey] = useState(() => clientId("settlement"));
  const uploadPromises = useRef(new Map<string, Promise<UploadPhoto>>());
  const submitAfterUploadRef = useRef(false);
  const [waitingForUploads, setWaitingForUploads] = useState(false);
  const canEdit = ["pending_helper_precheck", "correction_required"].includes(settlement.status);

  const receiptJson = useMemo(() => photoJson(receipt), [receipt]);
  const transportProofJson = useMemo(() => photoJson(transportProof), [transportProof]);

  useEffect(() => {
    if (!state.ok) return;
    router.refresh();
    router.push("/helper?view=settlement");
  }, [router, state.ok]);

  async function submitAfterUploads(event: FormEvent<HTMLFormElement>) {
    if (submitAfterUploadRef.current) {
      submitAfterUploadRef.current = false;
      return;
    }
    if (pending || waitingForUploads) {
      event.preventDefault();
      return;
    }
    if (receipt?.status === "uploaded" && (!transportProof || transportProof.status === "uploaded")) return;
    event.preventDefault();
    if (!receipt || receipt.status === "failed" || transportProof?.status === "failed") return;
    try {
      setWaitingForUploads(true);
      const [nextReceipt, nextTransportProof] = await Promise.all([
        receipt.status === "uploaded"
          ? receipt
          : uploadSettlementEvidencePhoto({
            evidenceType: "daily_receipt",
            photo: receipt,
            settlementId: settlement.id,
            setPhoto: setReceipt,
            uploadPromises,
          }),
        transportProof
          ? transportProof.status === "uploaded"
            ? transportProof
            : uploadSettlementEvidencePhoto({
                evidenceType: "transport_proof",
                photo: transportProof,
                settlementId: settlement.id,
                setPhoto: setTransportProof,
                uploadPromises,
              })
          : null,
      ]);
      const form = event.currentTarget;
      setHiddenValue(form, "receiptJson", JSON.stringify(photoPayload(nextReceipt)));
      setHiddenValue(form, "transportProofJson", nextTransportProof ? JSON.stringify(photoPayload(nextTransportProof)) : "");
      submitAfterUploadRef.current = true;
      form.requestSubmit();
    } finally {
      setWaitingForUploads(false);
    }
  }

  return (
    <Surface className="grid gap-5">
      <SettlementSummary settlement={settlement} />
      {settlement.correction_note ? (
        <InsightBanner body={settlement.correction_note} title="管理員要求補正" tone="red" />
      ) : null}
      {canEdit ? (
        <form action={action} className="grid gap-3" onSubmit={submitAfterUploads}>
          <input name="settlementId" type="hidden" value={settlement.id} />
          <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
          <input name="receiptJson" type="hidden" value={receiptJson} />
          <input name="transportProofJson" type="hidden" value={transportProofJson} />
          <PhotoUpload
            evidenceType="daily_receipt"
            label="每日收據（必填）"
            photo={receipt}
            settlement={settlement}
            setPhoto={setReceipt}
            uploadPromises={uploadPromises}
          />
          <div className="grid gap-3 rounded-md border bg-background p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input inputMode="numeric" min="0" name="transportJpy" placeholder="交通費日圓金額（無申請可留白）" />
              <input name="transportClaimNote" placeholder="交通區間，例如 新宿到池袋（申請時必填）" />
            </div>
            <PhotoUpload
              evidenceType="transport_proof"
              label="交通照片（選填）"
              photo={transportProof}
              settlement={settlement}
              setPhoto={setTransportProof}
              uploadPromises={uploadPromises}
            />
          </div>
          <textarea name="helperNote" placeholder="補充說明（選填）" />
          <Button disabled={pending || waitingForUploads || !receipt || receipt.status === "failed"} type="submit">
            {pending || waitingForUploads ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {waitingForUploads ? "等待照片上傳..." : "送出中..."}
              </>
            ) : (
              "送出結帳預檢"
            )}
          </Button>
          <ActionMessage state={state} />
        </form>
      ) : null}
    </Surface>
  );
}

export function WarehouseProofForm({ settlement }: { settlement: any }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(submitWarehouseProofAction, initialState);
  const [proof, setProof] = useState<UploadPhoto | null>(null);
  const [idempotencyKey] = useState(() => clientId("warehouse"));
  const uploadPromises = useRef(new Map<string, Promise<UploadPhoto>>());
  const submitAfterUploadRef = useRef(false);
  const [waitingForUpload, setWaitingForUpload] = useState(false);
  const proofJson = useMemo(() => photoJson(proof), [proof]);

  useEffect(() => {
    if (!state.ok) return;
    router.refresh();
    router.push("/helper?view=settlement");
  }, [router, state.ok]);

  async function submitAfterUpload(event: FormEvent<HTMLFormElement>) {
    if (submitAfterUploadRef.current) {
      submitAfterUploadRef.current = false;
      return;
    }
    if (pending || waitingForUpload) {
      event.preventDefault();
      return;
    }
    if (proof?.status === "uploaded") return;
    event.preventDefault();
    if (!proof || proof.status === "failed") return;
    try {
      setWaitingForUpload(true);
      const uploadedProof = await uploadSettlementEvidencePhoto({
        evidenceType: "warehouse_proof",
        photo: proof,
        settlementId: settlement.id,
        setPhoto: setProof,
        uploadPromises,
      });
      const form = event.currentTarget;
      setHiddenValue(form, "proofJson", JSON.stringify(photoPayload(uploadedProof)));
      submitAfterUploadRef.current = true;
      form.requestSubmit();
    } finally {
      setWaitingForUpload(false);
    }
  }

  return (
    <Surface className="grid gap-3">
      <SettlementSummary settlement={settlement} />
      <form action={action} className="grid gap-3" onSubmit={submitAfterUpload}>
        <input name="settlementId" type="hidden" value={settlement.id} />
        <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
        <input name="proofJson" type="hidden" value={proofJson} />
        <PhotoUpload
          evidenceType="warehouse_proof"
          label="送達集運倉照片（必填）"
          photo={proof}
          settlement={settlement}
          setPhoto={setProof}
          uploadPromises={uploadPromises}
        />
        <textarea name="note" placeholder="集運倉補充說明（選填）" />
        <Button disabled={pending || waitingForUpload || !proof || proof.status === "failed"} type="submit">
          {pending || waitingForUpload ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {waitingForUpload ? "等待照片上傳..." : "送出中..."}
            </>
          ) : (
            "送出集運倉證明"
          )}
        </Button>
        <ActionMessage state={state} />
      </form>
    </Surface>
  );
}

export function SettlementSummary({ settlement }: { settlement: any }) {
  const rate = Number(settlement.jpy_to_twd_rate || 0);
  const hasRate = rate > 0;
  const canEdit = ["pending_helper_precheck", "correction_required"].includes(settlement.status);
  const showFinalBreakdown = [
    "pending_helper_confirmation",
    "payment_pending",
    "warehouse_pending",
    "warehouse_review_pending",
    "final_payment_pending",
    "completed",
  ].includes(settlement.status);
  return (
    <div className="grid gap-3">
      <SettlementAmountHero settlement={settlement} />
      {!hasRate ? (
        <InsightBanner
          body="匯率設定完成後即可開始核對。"
          title="等待當日 JPY→TWD 匯率"
          tone="amber"
        />
      ) : null}
      {hasRate && canEdit && settlement.line_items?.length ? (
        <div className="rounded-md border bg-background p-3 text-sm">
          <p className="mb-3 font-semibold">核對商品</p>
          <div className="grid gap-2">
          {settlement.line_items.map((item: any) => (
            <div className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0" key={item.id}>
              <div>
                <p className="font-medium">{item.product_name}</p>
                <p className="text-muted-foreground">
                  {item.quantity} 件 × JPY {item.original_price_jpy}
                </p>
              </div>
              <p className="shrink-0 text-right font-medium">
                TWD {Math.round(Number(item.product_total_jpy || 0) * rate)}
              </p>
            </div>
          ))}
          </div>
        </div>
      ) : null}
      {hasRate && canEdit ? (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">商品墊款</p>
            <p className="mt-1 font-semibold">
              TWD {settlement.item_advance_twd ?? Math.round(Number(settlement.product_total_jpy || 0) * rate)}
            </p>
          </div>
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">預估薪資</p>
            <p className="mt-1 font-semibold">TWD {compensationAmount(settlement)}</p>
          </div>
        </div>
      ) : null}
      {showFinalBreakdown && settlement.total_payable_twd !== null && hasRate ? (
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">商品</p>
            <p className="mt-1 font-semibold">{settlement.item_advance_twd || 0}</p>
          </div>
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">薪資</p>
            <p className="mt-1 font-semibold">{compensationAmount(settlement)}</p>
          </div>
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">交通</p>
            <p className="mt-1 font-semibold">{settlement.approved_transport_twd || 0}</p>
          </div>
        </div>
      ) : null}
      {canEdit && settlement.transport_claim_jpy ? (
        <div className="rounded-md border bg-background p-3 text-sm">
          <p className="font-medium">交通申請</p>
          <p className="mt-1 text-muted-foreground">
            JPY {settlement.transport_claim_jpy} · {settlement.transport_claim_note || "未填區間"}
          </p>
        </div>
      ) : null}
      {canEdit && settlement.evidence?.length ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">已上傳照片</p>
          <div className="flex flex-wrap gap-2">
            {settlement.evidence.map((item: any) => (
              <a href={item.signed_url} key={item.id} rel="noreferrer" target="_blank">
                <img alt={evidenceLabel(item.evidence_type)} className="size-20 rounded-md border object-cover" src={item.signed_url} />
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function compensationAmount(settlement: any) {
  const minutes = Number(settlement.work_minutes || 0);
  const hours = minutes / 60;
  if (settlement.compensation_mode === "hourly") {
    return settlement.work_pay_twd ?? Math.round(hours * Number(settlement.hourly_rate_twd || 0));
  }
  const estimated = Math.round(
    Number(settlement.product_total_jpy || 0) * Number(settlement.helper_fx_rate || 0),
  );
  return settlement.total_payable_twd == null
    ? estimated
    : Math.max(
        Number(settlement.total_payable_twd || 0) -
          Number(settlement.item_advance_twd || 0) -
          Number(settlement.approved_transport_twd || 0),
        0,
      );
}

function PhotoUpload({
  evidenceType,
  label,
  photo,
  settlement,
  setPhoto,
  uploadPromises,
}: {
  evidenceType: string;
  label: string;
  photo: UploadPhoto | null;
  settlement: any;
  setPhoto: (photo: UploadPhoto | null) => void;
  uploadPromises: MutableRefObject<Map<string, Promise<UploadPhoto>>>;
}) {
  const previewUrl = useMemo(() => (photo ? URL.createObjectURL(photo.file) : ""), [photo]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function upload(selectedPhoto = photo) {
    if (!selectedPhoto) return;
    await uploadSettlementEvidencePhoto({
      evidenceType,
      photo: selectedPhoto,
      settlementId: settlement.id,
      setPhoto,
      uploadPromises,
    }).catch(() => undefined);
  }

  return (
    <div className="grid gap-2 rounded-md border border-dashed p-3">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Camera className="size-4" />
        {label}
        <input
          accept="image/*"
          className="sr-only"
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const nextPhoto: UploadPhoto = {
              byteSize: file.size,
              clientPhotoId: clientId(evidenceType),
              contentType: file.type || "image/jpeg",
              file,
              originalFilename: file.name || "evidence.jpg",
              status: "selected",
            };
            setPhoto(nextPhoto);
            void upload(nextPhoto);
          }}
        />
      </label>
      {photo ? (
        <div className="grid gap-2">
          <div className="flex items-center gap-3 rounded-md bg-background p-2">
            <img alt={label} className="size-16 rounded-md border object-cover" src={previewUrl} />
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">{photo.originalFilename}</p>
              <p className={photo.status === "uploaded" ? "text-primary" : "text-muted-foreground"}>
                {photo.status === "uploaded" ? "已上傳" : photo.status === "uploading" ? "上傳中" : photo.status === "failed" ? "上傳失敗" : "尚未上傳"}
              </p>
              {photo.error ? <p className="text-xs text-destructive">{photo.error}</p> : null}
            </div>
          </div>
          <Button disabled={photo.status === "uploading" || photo.status === "uploaded"} size="sm" type="button" variant="outline" onClick={() => void upload()}>
            {photo.status === "uploading" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {photo.status === "uploaded" ? "已上傳" : photo.status === "failed" ? "重試上傳" : photo.status === "uploading" ? "上傳中" : "自動上傳中"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function photoJson(photo: UploadPhoto | null) {
  if (!photo?.storageKey || photo.status !== "uploaded") return "";
  return JSON.stringify(photoPayload(photo));
}

function photoPayload(photo: UploadPhoto) {
  return {
    byteSize: photo.byteSize,
    contentType: photo.contentType,
    originalFilename: photo.originalFilename,
    storageKey: photo.storageKey,
  };
}

async function uploadSettlementEvidencePhoto({
  evidenceType,
  photo,
  settlementId,
  setPhoto,
  uploadPromises,
}: {
  evidenceType: string;
  photo: UploadPhoto;
  settlementId: string;
  setPhoto: (photo: UploadPhoto | null) => void;
  uploadPromises: MutableRefObject<Map<string, Promise<UploadPhoto>>>;
}) {
  if (photo.status === "uploaded" && photo.storageKey) return photo;
  const existingUpload = uploadPromises.current.get(photo.clientPhotoId);
  if (existingUpload) return existingUpload;
  setPhoto({ ...photo, error: undefined, status: "uploading" });
  const uploadPromise = (async () => {
    const presign = await fetch("/api/uploads/presign", {
      body: JSON.stringify({
        clientPhotoId: photo.clientPhotoId,
        contentType: photo.contentType,
        evidenceType,
        fileName: photo.originalFilename,
        settlementId,
        uploadPurpose: "settlement_evidence",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await presign.json();
    if (!presign.ok) throw new Error(body.error || "無法建立上傳網址。");
    const result = await fetch(body.uploadUrl, {
      body: photo.file,
      headers: { "content-type": photo.contentType },
      method: "PUT",
    });
    if (!result.ok) throw new Error(`R2 上傳失敗 (${result.status})。`);
    const uploadedPhoto = { ...photo, error: undefined, status: "uploaded" as const, storageKey: body.storageKey };
    setPhoto(uploadedPhoto);
    return uploadedPhoto;
  })();
  uploadPromises.current.set(photo.clientPhotoId, uploadPromise);
  try {
    return await uploadPromise;
  } catch (error) {
    setPhoto({
      ...photo,
      error: error instanceof Error ? error.message : "上傳失敗。",
      status: "failed",
    });
    throw error;
  } finally {
    uploadPromises.current.delete(photo.clientPhotoId);
  }
}

function setHiddenValue(form: HTMLFormElement, name: string, value: string) {
  const input = form.elements.namedItem(name);
  if (input instanceof HTMLInputElement) {
    input.value = value;
  }
}

function clientId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function evidenceLabel(type: string) {
  if (type === "daily_receipt") return "每日收據";
  if (type === "transport_proof") return "交通照片";
  if (type === "warehouse_proof") return "集運倉照片";
  return "照片";
}

function ActionMessage({ state }: { state: HelperActionResult }) {
  if (state.ok) return <p className="text-sm text-primary">已送出。</p>;
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  return null;
}
