"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Pencil, X } from "lucide-react";

import { ServerActionForm } from "../components/ServerActionForm";
import { Button } from "../components/ui/button";
import { PhotoViewerTrigger } from "../components/PhotoAnnotationEditor";

type ActionResult = { error?: string; ok?: boolean } | void;
type ServerAction = (formData: FormData) => Promise<ActionResult>;

function valueOrDash(value: unknown) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function productTypeLabel(value: unknown) {
  if (value === "gacha") return "扭蛋";
  if (value === "blind_box") return "盲抽";
  return "一般商品";
}

function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "green" | "amber" | "neutral" }) {
  const className = tone === "green"
    ? "bg-emerald-100 text-emerald-800"
    : tone === "amber"
      ? "bg-amber-100 text-amber-900"
      : "bg-muted text-muted-foreground";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{children}</span>;
}

export function StagingReviewedOrderEditor({
  action,
  order,
  successHref,
}: {
  action: ServerAction;
  order: any;
  successHref: string;
}) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(Number(order.quantity || 1));
  const [productType, setProductType] = useState(order.product_type || "standard");

  if (!editing) {
    return (
      <section className="grid gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">訂單資料</h3>
            <p className="mt-1 text-sm text-muted-foreground">目前為檢視模式；要修改內容請先點擊編輯。</p>
          </div>
          <Button onClick={() => setEditing(true)} size="sm" type="button" variant="outline">
            <Pencil className="mr-1.5 size-4" />編輯訂單
          </Button>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">LINE 暱稱</dt><dd className="mt-1 font-medium">{valueOrDash(order.line_community_name)}</dd></div>
          <div><dt className="text-muted-foreground">商品</dt><dd className="mt-1 font-medium">{valueOrDash(order.product_name)}</dd></div>
          <div><dt className="text-muted-foreground">商品類型</dt><dd className="mt-1 font-medium">{productTypeLabel(order.product_type)}</dd></div>
          <div><dt className="text-muted-foreground">外觀備註</dt><dd className="mt-1 whitespace-pre-wrap">{valueOrDash(order.appearance_notes)}</dd></div>
          <div><dt className="text-muted-foreground">數量</dt><dd className="mt-1 font-medium">{valueOrDash(order.quantity)} 件</dd></div>
          <div><dt className="text-muted-foreground">原價</dt><dd className="mt-1 font-medium">JPY {valueOrDash(order.original_price_jpy)}</dd></div>
          <div><dt className="text-muted-foreground">售價</dt><dd className="mt-1 font-medium">TWD {valueOrDash(order.sale_price_twd)}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {order.is_excluded ? <StatusPill>這筆訂單已排除</StatusPill> : <StatusPill tone="green">這筆訂單會合併</StatusPill>}
          {order.customer_exists ? <StatusPill tone="green">客戶名單已找到此暱稱</StatusPill> : order.customer_confirmed ? <StatusPill tone="green"><CheckCircle2 className="mr-1 size-3.5" />未知暱稱已確認</StatusPill> : <StatusPill tone="amber">客戶暱稱尚未確認</StatusPill>}
        </div>
      </section>
    );
  }

  return (
    <ServerActionForm
      action={action}
      buttonLabel={!order.customer_exists ? "儲存並確認暱稱" : "儲存訂單"}
      className="grid gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
      successHref={successHref}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">編輯訂單資料</h3>
          <p className="mt-1 text-sm text-muted-foreground">儲存完成後會回到審核批次並顯示完成提示。</p>
        </div>
        <Button onClick={() => setEditing(false)} size="sm" type="button" variant="ghost">
          <X className="mr-1.5 size-4" />取消
        </Button>
      </div>
      <input name="reviewedOrderId" type="hidden" value={order.id} />
      {!order.customer_exists ? (
        <div className={`grid gap-2 rounded-xl border p-3 ${order.customer_confirmed ? "border-blue-200 bg-blue-50 text-blue-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
          <p className="font-semibold">客戶暱稱「{order.line_community_name}」不在客戶名單</p>
          <p className="text-sm leading-6">若要讓這筆訂單通過核准，請確認它仍允許合併；如果不應合併，請勾選排除。</p>
          <label className="inline-flex items-start gap-2 text-sm font-semibold">
            <input name="customerConfirmed" type="checkbox" defaultChecked={order.customer_confirmed} />
            <span>我確認這個未知暱稱仍允許合併</span>
          </label>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-sm"><span className="font-medium">LINE 暱稱</span><input name="lineCommunityName" defaultValue={order.line_community_name} required /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">商品</span><input name="productName" defaultValue={order.product_name} required /></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">商品類型</span><select name="productType" value={productType} onChange={(event) => setProductType(event.target.value)}><option value="standard">一般商品</option><option value="gacha">扭蛋</option><option value="blind_box">盲抽</option></select></label>
        <label className="grid gap-1 text-sm"><span className="font-medium">外觀備註</span><input name="appearanceNotes" defaultValue={order.appearance_notes || ""} /></label>
        <div className="grid grid-cols-3 gap-2">
          <label className="grid gap-1 text-sm"><span className="font-medium">數量</span><input inputMode="numeric" name="quantity" defaultValue={order.quantity} onChange={(event) => setQuantity(Number(event.target.value) || 0)} required /></label>
          <label className="grid gap-1 text-sm"><span className="font-medium">JPY</span><input inputMode="numeric" name="originalPriceJpy" defaultValue={order.original_price_jpy ?? ""} /></label>
          <label className="grid gap-1 text-sm"><span className="font-medium">TWD</span><input inputMode="numeric" name="salePriceTwd" defaultValue={order.sale_price_twd} required /></label>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2"><input name="isExcluded" type="checkbox" defaultChecked={order.is_excluded} /><span>排除不合併</span></label>
        <input className="min-w-56 flex-1" name="exclusionReason" placeholder="排除原因（排除時必填）" defaultValue={order.exclusion_reason || ""} />
      </div>
      {["gacha", "blind_box"].includes(productType) ? <GachaStagingItemEditor order={order} quantity={quantity} /> : null}
    </ServerActionForm>
  );
}

function GachaStagingItemEditor({ order, quantity }: { order: any; quantity: number }) {
  const photoOptions = (order.photos || []).filter((photo: any) => photo.photo_role === "purchase_report");
  const initialItems = normalizeGachaItems(order.items || [], quantity);
  const [items, setItems] = useState(initialItems);

  useEffect(() => {
    setItems((current) => normalizeGachaItems(current, quantity));
  }, [quantity]);

  function updateItem(index: number, patch: Partial<GachaStagingItem>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  return (
    <section className="grid gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 md:col-span-2">
      <div>
        <p className="font-semibold">扭蛋／盲抽逐顆 staging 結果</p>
        <p className="mt-1 text-sm text-muted-foreground">可逐顆修正文字、開箱狀態與結果照片；儲存時必須剛好保留目前數量的結果。</p>
      </div>
      <input name="gachaItemsJson" type="hidden" value={JSON.stringify(items.map((item) => ({
        resultName: item.resultName,
        resultPhotoStorageKey: item.resultPhotoStorageKey || null,
        sequenceNo: item.sequenceNo,
        unboxingStatus: item.unboxingStatus,
      })))} />
      {items.length ? items.map((item, index) => (
        <div className="grid gap-2 rounded-lg border bg-background p-3 md:grid-cols-[auto_1fr_1fr]" key={item.sequenceNo}>
          <div className="flex items-center gap-2 text-sm font-semibold"><span className="grid size-7 place-items-center rounded-full bg-primary text-primary-foreground">{item.sequenceNo}</span>第 {item.sequenceNo} 顆</div>
          <label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">結果文字</span><input required value={item.resultName} onChange={(event) => updateItem(index, { resultName: event.target.value })} /></label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">開箱狀態</span><select value={item.unboxingStatus} onChange={(event) => updateItem(index, { unboxingStatus: event.target.value as GachaStagingItem["unboxingStatus"] })}><option value="recorded">已開箱</option><option value="pending">待開箱</option></select></label>
            <label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">結果照片</span><select value={item.resultPhotoStorageKey || ""} onChange={(event) => updateItem(index, { resultPhotoStorageKey: event.target.value || null })}><option value="">不指定照片</option>{photoOptions.map((photo: any) => <option key={photo.storage_key} value={photo.storage_key}>{photo.label || photo.original_filename || `照片 ${photo.sort_order + 1}`}</option>)}</select></label>
          </div>
        </div>
      )) : <p className="text-sm text-red-700">請先填寫至少一個數量，再編輯逐顆結果。</p>}
    </section>
  );
}

type GachaStagingItem = {
  resultName: string;
  resultPhotoStorageKey: string | null;
  sequenceNo: number;
  unboxingStatus: "pending" | "recorded";
};

function normalizeGachaItems(items: any[], quantity: number): GachaStagingItem[] {
  const count = Math.max(0, Number(quantity) || 0);
  return Array.from({ length: count }, (_, index) => {
    const item = items[index] || {};
    return {
      resultName: String(item.resultName || item.result_name || (item.unboxingStatus === "pending" || item.unboxing_status === "pending" ? "待開箱" : "看圖")),
      resultPhotoStorageKey: item.resultPhotoStorageKey || item.result_photo_storage_key || null,
      sequenceNo: index + 1,
      unboxingStatus: (item.unboxingStatus || item.unboxing_status || "recorded") === "pending" ? "pending" : "recorded",
    };
  });
}

function PhotoPreview({ photo, editing }: { photo: any; editing: boolean }) {
  return (
    <div className="grid gap-2 rounded-xl border bg-background p-3">
      {photo.signed_url ? (
        <PhotoViewerTrigger
          alt={photo.label || photo.photo_role || "訂單照片"}
          className="aspect-square rounded-lg border"
          photo={photo}
        />
      ) : <div className="grid aspect-square place-items-center rounded-lg border bg-muted text-xs text-muted-foreground">照片網址暫不可用</div>}
      {editing ? <>
        <input name="photoId" type="hidden" value={photo.id} />
        <label className="inline-flex items-center gap-2 text-sm font-medium"><input name="includePhoto" type="checkbox" value={photo.id} defaultChecked={photo.include_in_merge} /><span>合併這張照片</span></label>
        <label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">{photo.photo_role} · #{photo.sort_order}</span><input name={`photoLabel:${photo.id}`} placeholder="照片標籤" defaultValue={photo.label || ""} /></label>
      </> : <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">{photo.photo_role} · #{photo.sort_order}</span><StatusPill tone={photo.include_in_merge ? "green" : "neutral"}>{photo.include_in_merge ? "會合併" : "不合併"}</StatusPill></div>}
    </div>
  );
}

export function StagingReviewedOrderPhotosEditor({
  action,
  order,
  successHref,
}: {
  action: ServerAction;
  order: any;
  successHref: string;
}) {
  const [editing, setEditing] = useState(false);
  if (!order.photos?.length) return <div className="rounded-2xl border border-dashed bg-background p-4 text-sm text-muted-foreground">這筆 staging 訂單目前沒有可供正式訂單使用的來源照片。</div>;

  if (!editing) {
    return <section className="grid gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">最終訂單照片</h3><p className="mt-1 text-sm text-muted-foreground">目前為檢視模式；照片選取要修改時請點擊編輯。</p></div><Button onClick={() => setEditing(true)} size="sm" type="button" variant="outline"><Pencil className="mr-1.5 size-4" />編輯照片選取</Button></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{order.photos.map((photo: any) => <PhotoPreview key={photo.id} photo={photo} editing={false} />)}</div></section>;
  }

  return <ServerActionForm action={action} buttonLabel="儲存照片選取" className="grid gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5" successHref={successHref}><input name="reviewedOrderId" type="hidden" value={order.id} /><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">編輯照片選取</h3><p className="mt-1 text-sm text-muted-foreground">儲存完成後會回到審核批次並顯示完成提示。</p></div><Button onClick={() => setEditing(false)} size="sm" type="button" variant="ghost"><X className="mr-1.5 size-4" />取消</Button></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{order.photos.map((photo: any) => <PhotoPreview key={photo.id} photo={photo} editing />)}</div></ServerActionForm>;
}
