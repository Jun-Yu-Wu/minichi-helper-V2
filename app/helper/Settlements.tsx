"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Camera, RefreshCw } from "lucide-react";

import {
  submitSettlementPrecheckAction,
  submitWarehouseProofAction,
  type HelperActionResult,
} from "../actions/helper";
import { Button } from "../components/ui/button";

type UploadPhoto = {
  byteSize: number;
  contentType: string;
  file: File;
  originalFilename: string;
  status: "selected" | "uploading" | "uploaded" | "failed";
  storageKey?: string;
};

const initialState: HelperActionResult = {};

export function SettlementPrecheckForm({ settlement }: { settlement: any }) {
  const [state, action, pending] = useActionState(submitSettlementPrecheckAction, initialState);
  const [receipt, setReceipt] = useState<UploadPhoto | null>(null);
  const [transportProof, setTransportProof] = useState<UploadPhoto | null>(null);
  const [idempotencyKey] = useState(() => clientId("settlement"));
  const canEdit = ["pending_helper_precheck", "correction_required"].includes(settlement.status);

  const receiptJson = useMemo(() => photoJson(receipt), [receipt]);
  const transportProofJson = useMemo(() => photoJson(transportProof), [transportProof]);

  return (
    <article className="grid gap-4 rounded-lg border bg-card p-4 shadow-sm">
      <SettlementSummary settlement={settlement} />
      {settlement.correction_note ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          需補正：{settlement.correction_note}
        </p>
      ) : null}
      {canEdit ? (
        <form action={action} className="grid gap-3">
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
            />
          </div>
          <textarea name="helperNote" placeholder="補充說明（選填）" />
          <Button disabled={pending || receipt?.status !== "uploaded"} type="submit">
            {pending ? "送出中…" : "送出結帳預檢"}
          </Button>
          <ActionMessage state={state} />
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">目前狀態：{settlementStatusLabel(settlement.status)}</p>
      )}
    </article>
  );
}

export function WarehouseProofForm({ settlement }: { settlement: any }) {
  const [state, action, pending] = useActionState(submitWarehouseProofAction, initialState);
  const [proof, setProof] = useState<UploadPhoto | null>(null);
  const [idempotencyKey] = useState(() => clientId("warehouse"));
  const proofJson = useMemo(() => photoJson(proof), [proof]);
  return (
    <article className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <SettlementSummary settlement={settlement} />
      <form action={action} className="grid gap-3">
        <input name="settlementId" type="hidden" value={settlement.id} />
        <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
        <input name="proofJson" type="hidden" value={proofJson} />
        <PhotoUpload
          evidenceType="warehouse_proof"
          label="送達集運倉照片（必填）"
          photo={proof}
          settlement={settlement}
          setPhoto={setProof}
        />
        <textarea name="note" placeholder="集運倉補充說明（選填）" />
        <Button disabled={pending || proof?.status !== "uploaded"} type="submit">
          {pending ? "送出中…" : "送出集運倉證明"}
        </Button>
        <ActionMessage state={state} />
      </form>
    </article>
  );
}

function SettlementSummary({ settlement }: { settlement: any }) {
  const rate = Number(settlement.jpy_to_twd_rate || 0);
  return (
    <div className="grid gap-3">
      <h3 className="font-semibold">{settlement.trip_name}</h3>
      <p className="text-sm text-muted-foreground">
        {settlement.line_items?.length || 0} 項 · 商品 JPY {settlement.product_total_jpy}
      </p>
      {settlement.line_items?.length ? (
        <div className="rounded-md border bg-background p-3 text-sm">
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
                {rate > 0 ? `TWD ${Math.round(Number(item.product_total_jpy || 0) * rate)}` : `JPY ${item.product_total_jpy}`}
              </p>
            </div>
          ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t pt-3 font-semibold">
            <span>商品墊款</span>
            <span>
              {settlement.item_advance_twd !== null
                ? `TWD ${settlement.item_advance_twd}`
                : rate > 0
                  ? `TWD ${Math.round(Number(settlement.product_total_jpy || 0) * rate)}`
                  : "待管理員填當日匯率"}
            </span>
          </div>
        </div>
      ) : null}
      {settlement.total_payable_twd !== null ? (
        <div className="grid gap-1 rounded-md bg-muted/50 p-3 text-sm">
          <p>商品墊款 TWD {settlement.item_advance_twd}</p>
          <p>工時費 TWD {settlement.work_pay_twd || 0}</p>
          <p>核准交通費 TWD {settlement.approved_transport_twd || 0}</p>
          <p className="font-semibold">
            應付 TWD {settlement.total_payable_twd}
            {settlement.is_split_payment ? " · 分兩次付款" : " · 一次付款"}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">待管理員確認當日匯率後計算台幣金額</p>
      )}
      {settlement.transport_claim_jpy ? (
        <div className="rounded-md border bg-background p-3 text-sm">
          <p className="font-medium">交通申請</p>
          <p className="mt-1 text-muted-foreground">
            JPY {settlement.transport_claim_jpy} · {settlement.transport_claim_note || "未填區間"}
          </p>
        </div>
      ) : null}
      {settlement.evidence?.length ? (
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

function PhotoUpload({
  evidenceType,
  label,
  photo,
  settlement,
  setPhoto,
}: {
  evidenceType: string;
  label: string;
  photo: UploadPhoto | null;
  settlement: any;
  setPhoto: (photo: UploadPhoto | null) => void;
}) {
  const previewUrl = useMemo(() => (photo ? URL.createObjectURL(photo.file) : ""), [photo]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);
  async function upload() {
    if (!photo) return;
    setPhoto({ ...photo, status: "uploading" });
    try {
      const presign = await fetch("/api/uploads/presign", {
        body: JSON.stringify({
          clientPhotoId: clientId(evidenceType),
          contentType: photo.contentType,
          evidenceType,
          fileName: photo.originalFilename,
          settlementId: settlement.id,
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
      setPhoto({ ...photo, status: "uploaded", storageKey: body.storageKey });
    } catch {
      setPhoto({ ...photo, status: "failed" });
    }
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
            setPhoto({
              byteSize: file.size,
              contentType: file.type || "image/jpeg",
              file,
              originalFilename: file.name || "evidence.jpg",
              status: "selected",
            });
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
            </div>
          </div>
          <Button disabled={photo.status === "uploading" || photo.status === "uploaded"} size="sm" type="button" variant="outline" onClick={upload}>
            <RefreshCw className="size-4" />
            {photo.status === "uploaded" ? "已上傳" : photo.status === "failed" ? "重試上傳" : "上傳照片"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function photoJson(photo: UploadPhoto | null) {
  if (!photo?.storageKey || photo.status !== "uploaded") return "";
  return JSON.stringify({
    byteSize: photo.byteSize,
    contentType: photo.contentType,
    originalFilename: photo.originalFilename,
    storageKey: photo.storageKey,
  });
}

function clientId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function settlementStatusLabel(status: string) {
  const labels: Record<string, string> = {
    completed: "已完成",
    correction_required: "待補正",
    final_payment_pending: "待尾款",
    payment_pending: "待付款",
    pending_admin_review: "管理員審核中",
    pending_helper_confirmation: "待最終確認",
    warehouse_pending: "待送倉回報",
    warehouse_review_pending: "送倉審核中",
  };
  return labels[status] || "待預檢";
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
