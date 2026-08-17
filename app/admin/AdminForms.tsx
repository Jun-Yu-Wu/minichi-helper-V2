"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ChevronDown, ImageUp, PackagePlus, X } from "lucide-react";

import {
  createHelperAction,
  createPurchaseTaskAction,
  createQuoteTaskAction,
  createRebuyTaskAction,
  createTripAction,
  quickPublishPurchaseTaskAction,
  repairTripAction,
  updateHelperAction,
  type AdminActionResult,
} from "../actions/admin";
import { Button } from "../components/ui/button";
import { PhotoFileInput } from "../components/PhotoFileInput";
import { preparePhotoForUpload } from "../../src/lib/client-photo-upload";

const initialState: AdminActionResult = {};
const customerNicknameCache = new Map<string, string[]>();

export function CreateHelperForm() {
  const [state, action, pending] = useActionState(createHelperAction, initialState);
  return (
    <form action={action} className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">新增小幫手</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          先建立營運資料；Auth user id 可等帳號建立後再補上。
        </p>
      </div>
      <label className="grid gap-1">
        <span>顯示名稱</span>
        <input name="displayName" placeholder="例如：東京小幫手 A" required />
      </label>
      <label className="grid gap-1">
        <span>登入 Email</span>
        <input name="email" type="email" placeholder="helper@example.com" required />
      </label>
      <label className="grid gap-1">
        <span>Supabase Auth user id</span>
        <input name="authUserId" placeholder="可稍後補" />
      </label>
      <select name="compensationMode" defaultValue="hourly">
        <option value="hourly">時薪</option>
        <option value="fx_rate">匯率差</option>
      </select>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="hourlyRateTwd" inputMode="numeric" placeholder="時薪 TWD" />
        <input name="helperFxRate" inputMode="decimal" placeholder="小幫手匯率" />
      </div>
      <input name="region" placeholder="地區，例如 Tokyo" />
      <div className="grid gap-3 sm:grid-cols-3">
        <input name="bankAccountName" placeholder="戶名" />
        <input name="bankCode" placeholder="銀行代碼" />
        <input name="bankAccountNumber" placeholder="帳號" />
      </div>
      <ActionMessage state={state} />
      <Button disabled={pending} type="submit">
        {pending ? "新增中..." : "新增小幫手"}
      </Button>
    </form>
  );
}

export function EditHelperForm({ helper }: { helper: any }) {
  const [state, action, pending] = useActionState(updateHelperAction, initialState);
  return (
    <form action={action} className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <input name="helperId" type="hidden" value={helper.id} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{helper.display_name}</h3>
          <p className="text-sm text-muted-foreground">{helper.email}</p>
        </div>
        <span className="rounded-full border bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
          {helper.region || "未填地區"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="displayName" defaultValue={helper.display_name || ""} placeholder="顯示名稱" required />
        <input name="email" defaultValue={helper.email || ""} type="email" placeholder="登入 Email" required />
      </div>
      <input name="authUserId" defaultValue={helper.auth_user_id || ""} placeholder="Supabase Auth user id" />
      <div className="grid gap-3 sm:grid-cols-3">
        <select name="compensationMode" defaultValue={helper.compensation_mode || "hourly"}>
          <option value="hourly">時薪</option>
          <option value="fx_rate">匯率差</option>
        </select>
        <input name="hourlyRateTwd" defaultValue={helper.hourly_rate_twd ?? ""} inputMode="numeric" placeholder="時薪 TWD" />
        <input name="helperFxRate" defaultValue={helper.helper_fx_rate ?? ""} inputMode="decimal" placeholder="小幫手匯率" />
      </div>
      <input name="region" defaultValue={helper.region || ""} placeholder="地區，例如 Tokyo" />
      <div className="grid gap-3 sm:grid-cols-3">
        <input name="bankAccountName" defaultValue={helper.bank_account_name || ""} placeholder="戶名" />
        <input name="bankCode" defaultValue={helper.bank_code || ""} placeholder="銀行代碼" />
        <input name="bankAccountNumber" defaultValue={helper.bank_account_number || ""} placeholder="帳號" />
      </div>
      <ActionMessage state={state} />
      <Button disabled={pending} type="submit" variant="outline">
        {pending ? "儲存中..." : "儲存小幫手資料"}
      </Button>
    </form>
  );
}

export function CreateTripForm({
  helpers,
}: {
  helpers: Array<{ display_name: string; id: string; is_active: boolean }>;
}) {
  const [state, action, pending] = useActionState(createTripAction, initialState);
  return (
    <form action={action} className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">新增行程</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          建立後會先停在排定狀態；小幫手出發、抵達後再由管理員開通連線。
        </p>
      </div>
      <label className="grid gap-1">
        <span>行程名稱</span>
        <input name="tripName" placeholder="例如：東京 7/3 下午場" required />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span>營業日期</span>
          <input name="businessDate" type="date" required />
        </label>
        <label className="grid gap-1">
          <span>預計時間</span>
          <input name="scheduledTime" type="time" />
        </label>
      </div>
      <label className="grid gap-1">
        <span>地點</span>
        <input name="location" placeholder="例如：新宿 / 代官山" />
      </label>
      <label className="grid gap-1">
        <span>行程時區</span>
        <input name="timezone" defaultValue="Asia/Tokyo" placeholder="Asia/Tokyo" required />
      </label>
      <label className="grid gap-1">
        <span>指派小幫手</span>
        <select name="assignedHelperId" required>
          <option value="">選擇啟用中的小幫手</option>
          {helpers
            .filter((helper) => helper.is_active)
            .map((helper) => (
              <option key={helper.id} value={helper.id}>
                {helper.display_name}
              </option>
            ))}
        </select>
      </label>
      <ActionMessage state={state} />
      <Button disabled={pending} type="submit">
        {pending ? "建立中..." : "建立排定行程"}
      </Button>
    </form>
  );
}

export function RepairTripForm({
  trip,
}: {
  trip: {
    admin_activated_at?: string | null;
    arrived_at?: string | null;
    canceled_at?: string | null;
    departed_at?: string | null;
    ended_at?: string | null;
    id: string;
    status: string;
    version: number;
  };
}) {
  const [state, action, pending] = useActionState(repairTripAction, initialState);
  return (
    <form action={action} className="mt-3 grid gap-2 border-t pt-3">
      <input name="tripId" type="hidden" value={trip.id} />
      <input name="expectedVersion" type="hidden" value={trip.version} />
      <select name="status" defaultValue={trip.status}>
        {["draft", "scheduled", "departed", "arrived", "active", "ended", "canceled"].map(
          (status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ),
        )}
      </select>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="departedAt" placeholder="departed_at ISO" defaultValue={isoValue(trip.departed_at)} />
        <input name="arrivedAt" placeholder="arrived_at ISO" defaultValue={isoValue(trip.arrived_at)} />
        <input
          name="adminActivatedAt"
          placeholder="admin_activated_at ISO"
          defaultValue={isoValue(trip.admin_activated_at)}
        />
        <input name="canceledAt" placeholder="canceled_at ISO" defaultValue={isoValue(trip.canceled_at)} />
        <input name="endedAt" placeholder="ended_at ISO" defaultValue={isoValue(trip.ended_at)} />
      </div>
      <input name="reason" placeholder="修復原因" required />
      <ActionMessage state={state} />
      <Button disabled={pending} size="sm" type="submit" variant="outline">
        {pending ? "修復中..." : "寫入修復"}
      </Button>
    </form>
  );
}

type QuoteTaskFormProps = {
  taskType: "detail" | "quote" | "quote_and_detail";
  trip: {
    helper_display_name?: string | null;
    id: string;
    status: string;
    trip_name: string;
  };
};

export function CreateQuoteTaskForm(props: QuoteTaskFormProps) {
  return <CreateUploadedQuoteTaskForm taskType={props.taskType} trip={props.trip} />;
}

type TaskCategory = "purchase" | "quote";
type TaskSubType = "detail" | "face_check" | "gacha" | "quote" | "quote_and_detail" | "standard";

const quoteTaskTypes = [
  { id: "quote", label: "報價", body: "請小幫手回傳商品價格。" },
  { id: "detail", label: "細圖", body: "請小幫手補拍商品細節。" },
  { id: "quote_and_detail", label: "報價＋細圖", body: "同時回傳價格與商品細節照。" },
] as const;

const purchaseTaskTypes = [
  { id: "standard", label: "一般採買", body: "發布一般數量的採買指示。" },
  { id: "face_check", label: "挑臉採買", body: "採買後需由管理員審核商品狀態。" },
  { id: "gacha", label: "扭蛋／盲抽", body: "依同商品、類型與日幣原價聚合，逐顆回報結果。" },
] as const;

export function TaskSubtypePublisher({
  category,
  initialSubType,
  onSubTypeChange,
  trip,
}: {
  category: TaskCategory;
  initialSubType?: string;
  onSubTypeChange?: (subType: TaskSubType) => void;
  trip: QuoteTaskFormProps["trip"];
}) {
  const options = category === "quote" ? quoteTaskTypes : purchaseTaskTypes;
  const [subType, setSubType] = useState<TaskSubType | undefined>(() =>
    options.some((option) => option.id === initialSubType)
      ? initialSubType as TaskSubType
      : undefined,
  );

  useEffect(() => {
    setSubType(
      options.some((option) => option.id === initialSubType)
        ? initialSubType as TaskSubType
        : undefined,
    );
  }, [category, initialSubType, trip.id]);

  const selectedOption = options.find((option) => option.id === subType);

  return (
    <>
      <ClientTaskStep number="3" title="選擇細任務">
        <div className="grid gap-3 sm:grid-cols-3">
          {options.map((option) => (
            <button
              aria-pressed={subType === option.id}
              className={`rounded-xl border p-4 text-left shadow-sm transition ${
                subType === option.id
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "bg-card hover:border-primary/30 hover:bg-accent/40"
              }`}
              key={option.id}
              type="button"
              onClick={() => {
                setSubType(option.id);
                onSubTypeChange?.(option.id);
              }}
            >
              <p className="font-semibold">{option.label}</p>
              <p className="mt-2 text-sm text-muted-foreground">{option.body}</p>
            </button>
          ))}
        </div>
      </ClientTaskStep>

      {selectedOption ? (
        <ClientTaskStep
          number="4"
          title={category === "quote" ? `發布${selectedOption.label}任務` : "建立採買內容"}
        >
          <article className="rounded-xl border bg-card p-4 shadow-sm">
            <div>
              <h3 className="font-semibold">{trip.trip_name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {trip.helper_display_name || "未指派"} · {selectedOption.label}
              </p>
            </div>
            {category === "quote" && isQuoteTaskSubType(subType) ? (
              <CreateQuoteTaskForm taskType={subType} trip={trip} />
            ) : category === "purchase" ? (
              <CreatePurchaseTaskForm
                mode={subType === "gacha" ? "gacha" : "standard"}
                requiresFaceCheck={subType === "face_check"}
                trip={trip}
              />
            ) : null}
          </article>
        </ClientTaskStep>
      ) : null}
    </>
  );
}

function ClientTaskStep({
  children,
  number,
  title,
}: {
  children: React.ReactNode;
  number: string;
  title: string;
}) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {number}
        </span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function isQuoteTaskSubType(
  value?: TaskSubType,
): value is QuoteTaskFormProps["taskType"] {
  return value === "quote" || value === "detail" || value === "quote_and_detail";
}

type RebuyProductSuggestion = {
  createdAt?: string;
  instructions?: string | null;
  originalPriceJpy?: number | null;
  photos: Array<{
    byte_size?: number | null;
    content_type?: string | null;
    original_filename?: string | null;
    signed_url: string;
    storage_key: string;
  }>;
  productName: string;
  quantity?: number | null;
  salePriceTwd?: number | null;
  sourceKind?: string;
  sourceTaskId: string;
};

function isUnsupportedRebuySource(task: {
  product_type?: string | null;
  workflow_version?: string | null;
}) {
  return task.product_type === "gacha"
    || task.product_type === "blind_box"
    || task.workflow_version === "gacha_v2";
}

export function CreateRebuyTaskForm({
  helpers,
  purchaseTasks,
}: {
  helpers: Array<{ display_name: string; id: string; is_active: boolean }>;
  purchaseTasks: Array<{
    id: string;
    line_community_name?: string | null;
    product_type?: string | null;
    product_name: string;
    status: string;
    workflow_version?: string | null;
  }>;
}) {
  const [photos, setPhotos] = useState<AdminTaskUploadPhoto[]>([]);
  const photosRef = useRef<AdminTaskUploadPhoto[]>([]);
  const [state, setState] = useState<AdminActionResult>({});
  const [pending, setPending] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [originalPriceJpy, setOriginalPriceJpy] = useState("");
  const [salePriceTwd, setSalePriceTwd] = useState("");
  const [instructions, setInstructions] = useState("");
  const [productFocused, setProductFocused] = useState(false);
  const [productSuggestions, setProductSuggestions] = useState<RebuyProductSuggestion[]>([]);
  const [productSuggestionsLoading, setProductSuggestionsLoading] = useState(false);
  const sourceCandidates = purchaseTasks.filter((task) =>
    ["canceled", "unavailable", "not_found"].includes(task.status)
    && !isUnsupportedRebuySource(task),
  );
  const unsupportedSourceCount = purchaseTasks.filter((task) =>
    ["canceled", "unavailable", "not_found"].includes(task.status)
    && isUnsupportedRebuySource(task),
  ).length;

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    if (!isOpen || !productFocused) {
      setProductSuggestions([]);
      setProductSuggestionsLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setProductSuggestionsLoading(true);
      try {
        const response = await fetch(
          `/api/admin/rebuy-products?q=${encodeURIComponent(productName.trim())}`,
          { cache: "no-store", signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "無法載入補買商品記憶。");
        setProductSuggestions(Array.isArray(body.suggestions) ? body.suggestions : []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setProductSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) setProductSuggestionsLoading(false);
      }
    }, productName.trim() ? 90 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, productFocused, productName]);

  useEffect(
    () => () => {
      for (const photo of photosRef.current) {
        if (!photo.reused) URL.revokeObjectURL(photo.objectUrl);
      }
    },
    [],
  );

  function addFiles(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => ({
        byteSize: file.size,
        clientPhotoId: createClientId("rebuy-reference"),
        contentType: file.type || "image/jpeg",
        error:
          file.size > MAX_ADMIN_TASK_PHOTO_BYTES
            ? "照片超過 8MB，請縮小後再上傳。"
            : undefined,
        file,
        objectUrl: URL.createObjectURL(file),
        originalFilename: file.name || "rebuy-reference.jpg",
        sortOrder: 0,
        status: file.size > MAX_ADMIN_TASK_PHOTO_BYTES ? "failed" as const : "selected" as const,
      }));
    setPhotos((current) => [
      ...current,
      ...selected.map((photo, index) => ({ ...photo, sortOrder: current.length + index })),
    ]);
  }

  function applyProductSuggestion(suggestion: RebuyProductSuggestion) {
    for (const photo of photosRef.current) {
      if (!photo.reused) URL.revokeObjectURL(photo.objectUrl);
    }
    const reusedPhotos = (suggestion.photos || []).map((photo, index) => ({
      byteSize: Number(photo.byte_size || 0),
      clientPhotoId: createClientId("reused-rebuy-reference"),
      contentType: photo.content_type || "image/jpeg",
      file: undefined,
      objectUrl: photo.signed_url,
      originalFilename: photo.original_filename || `rebuy-reference-${index + 1}.jpg`,
      reused: true,
      sortOrder: index,
      status: "uploaded" as const,
      storageKey: photo.storage_key,
    }));
    setProductName(suggestion.productName || "");
    setQuantity(suggestion.quantity == null ? "1" : String(suggestion.quantity));
    setOriginalPriceJpy(suggestion.originalPriceJpy == null ? "" : String(suggestion.originalPriceJpy));
    setSalePriceTwd(suggestion.salePriceTwd == null ? "" : String(suggestion.salePriceTwd));
    setInstructions(suggestion.instructions || "");
    setPhotos(reusedPhotos);
    setProductFocused(false);
    setState({});
  }

  function removePhoto(clientPhotoId: string) {
    setPhotos((current) => {
      const removed = current.find((photo) => photo.clientPhotoId === clientPhotoId);
      if (removed && !removed.reused) URL.revokeObjectURL(removed.objectUrl);
      return current
        .filter((photo) => photo.clientPhotoId !== clientPhotoId)
        .map((photo, index) => ({ ...photo, sortOrder: index }));
    });
  }

  function updatePhoto(clientPhotoId: string, patch: Partial<AdminTaskUploadPhoto>) {
    setPhotos((current) =>
      current.map((photo) =>
        photo.clientPhotoId === clientPhotoId ? { ...photo, ...patch } : photo,
      ),
    );
  }

  async function submitRebuyTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setPending(true);
    setState({});
    try {
      const uploadedPhotos = await Promise.all(
        photos.map(async (photo) => {
          if (photo.storageKey) return photo;
          updatePhoto(photo.clientPhotoId, { error: undefined, status: "uploading" });
          try {
            const uploaded = await uploadAdminRebuyReferencePhoto(photo);
            updatePhoto(photo.clientPhotoId, uploaded);
            return { ...photo, ...uploaded };
          } catch (error) {
            const message = error instanceof Error ? error.message : "照片上傳失敗。";
            updatePhoto(photo.clientPhotoId, { error: message, status: "failed" });
            throw error;
          }
        }),
      );
      setPhotos(uploadedPhotos);
      formData.set(
        "referencePhotosJson",
        JSON.stringify(
          uploadedPhotos.map((photo) => ({
            byteSize: photo.byteSize,
            contentType: photo.contentType,
            originalFilename: photo.originalFilename,
            sortOrder: photo.sortOrder,
            storageKey: photo.storageKey,
          })),
        ),
      );
      const result = await createRebuyTaskAction({}, formData);
      setState(result);
      if (result.ok) {
        for (const photo of uploadedPhotos) {
          if (!photo.reused) URL.revokeObjectURL(photo.objectUrl);
        }
        setPhotos([]);
        form.reset();
        setProductName("");
        setQuantity("1");
        setOriginalPriceJpy("");
        setSalePriceTwd("");
        setInstructions("");
      }
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "照片上傳失敗。" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-5 rounded-lg border bg-card p-4 shadow-sm sm:p-5" onSubmit={submitRebuyTask}>
      <Button
        aria-expanded={isOpen}
        className="h-auto w-full justify-start gap-3 p-0 text-left hover:bg-transparent"
        type="button"
        variant="ghost"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <PackagePlus className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold">建立補買任務</span>
          <span className="mt-1 block text-sm text-muted-foreground">指定小幫手處理，或發布到公開補買池讓現場夥伴認領。</span>
        </span>
        <ChevronDown className={`mt-1 size-5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </Button>
      {isOpen ? <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span>任務類型</span>
          <select name="visibility" defaultValue="private" disabled={pending}>
            <option value="private">指定小幫手</option>
            <option value="public">公開補買池</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span>指定小幫手</span>
          <select name="assignedHelperId" disabled={pending}>
            <option value="">公開任務或沿用原採買</option>
            {helpers.filter((helper) => helper.is_active).map((helper) => (
              <option key={helper.id} value={helper.id}>{helper.display_name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1">
        <span>從未完成採買建立</span>
        <select name="sourcePurchaseTaskId" disabled={pending}>
          <option value="">不綁定原採買，手動建立</option>
          {sourceCandidates.map((task) => (
            <option key={task.id} value={task.id}>
              {task.product_name} · {task.line_community_name || "未填客人"} · {task.status}
            </option>
          ))}
        </select>
        {unsupportedSourceCount ? (
          <span className="text-xs text-muted-foreground">
            {unsupportedSourceCount} 筆扭蛋／盲抽未列入補買來源；請改從新版採買流程處理。
          </span>
        ) : null}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="relative grid gap-1">
          <span>商品名稱（補買記憶）</span>
          <input
            aria-autocomplete="list"
            aria-expanded={productFocused && productSuggestions.length > 0}
            autoComplete="off"
            name="productName"
            placeholder="手動建立時必填；可選歷史商品"
            role="combobox"
            value={productName}
            disabled={pending}
            onBlur={() => window.setTimeout(() => setProductFocused(false), 120)}
            onChange={(event) => setProductName(event.currentTarget.value)}
            onFocus={() => setProductFocused(true)}
          />
          {productFocused && (productSuggestionsLoading || productSuggestions.length > 0) ? (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg" role="listbox">
              {productSuggestionsLoading ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">載入最近補買商品...</p>
              ) : productSuggestions.map((suggestion) => (
                <button
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                  key={`${suggestion.sourceTaskId}:${suggestion.productName}`}
                  role="option"
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    applyProductSuggestion(suggestion);
                  }}
                >
                  {suggestion.photos[0]?.signed_url ? (
                    <img alt="" className="size-12 rounded-md object-cover" src={suggestion.photos[0].signed_url} />
                  ) : (
                    <span className="size-12 rounded-md bg-muted" />
                  )}
                  <span className="min-w-0">
                    <strong className="block truncate text-sm">{suggestion.productName}</strong>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      JPY {suggestion.originalPriceJpy ?? "-"} · TWD {suggestion.salePriceTwd ?? "-"} · {suggestion.quantity ?? 1} 件 · {suggestion.photos.length} 張照片
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </label>
        <label className="grid gap-1">
          <span>客人 LINE 名稱</span>
          <CustomerNicknameInput disabled={pending} placeholder="從客戶主檔建議" required={false} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1">
          <span>數量</span>
          <input name="quantity" inputMode="numeric" min="1" placeholder="1" value={quantity} disabled={pending} onChange={(event) => setQuantity(event.currentTarget.value)} />
        </label>
        <label className="grid gap-1">
          <span>JPY 單價</span>
          <input name="originalPriceJpy" inputMode="numeric" min="0" placeholder="0" value={originalPriceJpy} disabled={pending} onChange={(event) => setOriginalPriceJpy(event.currentTarget.value)} />
        </label>
        <label className="grid gap-1">
          <span>TWD 售價</span>
          <input name="salePriceTwd" inputMode="numeric" min="0" placeholder="0" value={salePriceTwd} disabled={pending} onChange={(event) => setSalePriceTwd(event.currentTarget.value)} />
        </label>
      </div>
      <label className="grid gap-1">
        <span>補買指示</span>
        <textarea name="instructions" placeholder="例如：架位、款式或替代條件" value={instructions} disabled={pending} onChange={(event) => setInstructions(event.currentTarget.value)} />
      </label>
      <input name="productType" type="hidden" value="standard" />
      <div className="grid gap-2">
        <p className="text-sm font-medium">補買參考照（選填）</p>
        <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-center">
          <ImageUp className="size-5" aria-hidden="true" />
          <span className="text-sm">選擇商品照片或補買參考截圖</span>
          <PhotoFileInput
            accept="image/*"
            className="sr-only"
            disabled={pending}
            multiple
            onFiles={addFiles}
          />
        </label>
        {photos.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {photos.map((photo) => (
              <div className={`rounded-md border p-2 ${photo.status === "uploaded" ? "border-emerald-400 bg-emerald-50/40" : "bg-background"}`} key={photo.clientPhotoId}>
                <img
                  alt="補買參考照"
                  className="aspect-square w-full rounded-md object-cover"
                  src={photo.objectUrl}
                />
                <div className="mt-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {adminUploadStatusLabel(photo.status) ? (
                      <p className="text-xs text-muted-foreground">{adminUploadStatusLabel(photo.status)}</p>
                    ) : null}
                  </div>
                  {!pending ? (
                    <button
                      aria-label="移除照片"
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                      type="button"
                      onClick={() => removePhoto(photo.clientPhotoId)}
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </div>
                {photo.error ? <p className="mt-1 text-xs text-destructive">{photo.error}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <ActionMessage state={state} />
      <Button className="sm:w-fit" disabled={pending || photos.some((photo) => Boolean(photo.error))} type="submit">
        送出
      </Button>
      </> : null}
    </form>
  );
}

type PurchaseProductSuggestion = {
  createdAt?: string;
  note?: string | null;
  originalPriceJpy?: number | null;
  photos: Array<{
    byte_size?: number | null;
    byteSize?: number | null;
    content_type?: string | null;
    contentType?: string | null;
    original_filename?: string | null;
    originalFilename?: string | null;
    signed_url: string;
    storage_key: string;
  }>;
  productName: string;
  productType?: "standard" | "gacha" | "blind_box";
  quantity?: number | null;
  requiresFaceCheck?: boolean;
  salePriceTwd?: number | null;
  sourceKind?: string;
  sourceTemplateId?: string | null;
  sourceTaskId?: string | null;
};

type PurchaseProductType = "standard" | "gacha" | "blind_box";

const GACHA_PRICE_MAP: Record<string, string> = {
  "200": "70",
  "300": "100",
  "400": "120",
  "500": "150",
  "600": "170",
};

type QuickPublishHistory = {
  createdAt?: string | null;
  id: string;
  note?: string | null;
  originalPriceJpy?: number | null;
  productName: string;
  productType: PurchaseProductType;
  quantity?: number | null;
  requiresFaceCheck: boolean;
  salePriceTwd?: number | null;
  status: string;
};

function purchaseProductTypeLabel(productType: PurchaseProductType | string | null | undefined) {
  if (productType === "gacha") return "扭蛋";
  if (productType === "blind_box") return "盲抽";
  return "一般商品";
}

function quickPublishHistoryStatusLabel(status: string) {
  if (status === "completed") return "已完成";
  if (status === "canceled") return "已取消";
  if (status === "unavailable") return "缺貨";
  if (status === "not_found") return "找不到";
  if (status === "review_pending") return "挑臉審核中";
  if (status === "approved_pending_helper_confirmation") return "待小幫手確認";
  return "待採買";
}

function quickPublishHistoryDateLabel(value?: string | null) {
  if (!value) return "時間未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "時間未知";
  return new Intl.DateTimeFormat("zh-TW", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
  }).format(date);
}

export function CreatePurchaseTaskForm({
  mode = "standard",
  requiresFaceCheck,
  trip,
}: {
  mode?: "gacha" | "standard";
  requiresFaceCheck: boolean;
  trip: { id: string; status: string; trip_name: string };
}) {
  const [photos, setPhotos] = useState<AdminTaskUploadPhoto[]>([]);
  const photosRef = useRef<AdminTaskUploadPhoto[]>([]);
  const uploadPromisesRef = useRef(new Map<string, Promise<Partial<AdminTaskUploadPhoto>>>());
  const [state, setState] = useState<AdminActionResult>({});
  const [pending, setPending] = useState(false);
  const [formResetKey, setFormResetKey] = useState(0);
  const [lineCommunityName, setLineCommunityName] = useState("");
  const [productName, setProductName] = useState("");
  const [productType, setProductType] = useState<PurchaseProductType>(
    mode === "gacha" ? "gacha" : "standard",
  );
  const [quantity, setQuantity] = useState("1");
  const [originalPriceJpy, setOriginalPriceJpy] = useState("");
  const [salePriceTwd, setSalePriceTwd] = useState("");
  const [note, setNote] = useState("");
  const [productFocused, setProductFocused] = useState(false);
  const [productSuggestions, setProductSuggestions] = useState<PurchaseProductSuggestion[]>([]);
  const [productSuggestionsLoading, setProductSuggestionsLoading] = useState(false);
  const [reuseSourceTaskId, setReuseSourceTaskId] = useState("");
  const [reuseSourceTemplateId, setReuseSourceTemplateId] = useState("");
  const [priceSource, setPriceSource] = useState<"auto" | "manual" | "memory">("auto");
  const canCreate = trip.status === "active";

  const visibleProductSuggestions = productSuggestions.filter((suggestion) =>
    mode === "gacha"
      ? suggestion.productType === "gacha" || suggestion.productType === "blind_box"
      : suggestion.productType === "standard",
  );

  useEffect(() => {
    if (!productFocused || !canCreate) {
      setProductSuggestions([]);
      setProductSuggestionsLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setProductSuggestionsLoading(true);
      try {
        const response = await fetch(
          `/api/admin/purchase-products?tripId=${encodeURIComponent(trip.id)}&q=${encodeURIComponent(productName.trim())}`,
          { cache: "no-store", signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "無法載入商品推薦。");
        setProductSuggestions(Array.isArray(body.suggestions) ? body.suggestions : []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setProductSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) setProductSuggestionsLoading(false);
      }
    }, productName.trim() ? 90 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canCreate, productFocused, productName, trip.id]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.objectUrl);
    },
    [],
  );

  function addFiles(files: FileList | null) {
    if (!files) return;
    setReuseSourceTaskId("");
    setReuseSourceTemplateId("");
    const selected = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .map((file) => ({
        byteSize: file.size,
        clientPhotoId: createClientId("purchase-reference"),
        contentType: file.type || "image/jpeg",
        error:
          file.size > MAX_ADMIN_TASK_PHOTO_BYTES
            ? "照片超過 8MB，請縮小後再上傳。"
            : undefined,
        file,
        objectUrl: URL.createObjectURL(file),
        originalFilename: file.name || "purchase-reference.jpg",
        sortOrder: 0,
        status: file.size > MAX_ADMIN_TASK_PHOTO_BYTES ? "failed" as const : "selected" as const,
      }));
    setPhotos((current) => [
      ...current,
      ...selected.map((photo, index) => ({ ...photo, sortOrder: current.length + index })),
    ]);
    for (const photo of selected.filter((item) => !item.error)) {
      void startPhotoUpload(photo).catch(() => undefined);
    }
  }

  function applyProductSuggestion(suggestion: PurchaseProductSuggestion) {
    for (const photo of photosRef.current) {
      if (!photo.reused) URL.revokeObjectURL(photo.objectUrl);
    }
    const reusedPhotos = (suggestion.photos || []).map((photo, index) => ({
      byteSize: Number(photo.byte_size || photo.byteSize || 0),
      clientPhotoId: createClientId("reused-purchase-reference"),
      contentType: photo.content_type || photo.contentType || "image/jpeg",
      file: undefined,
      objectUrl: photo.signed_url,
      originalFilename: photo.original_filename || photo.originalFilename || `purchase-reference-${index + 1}.jpg`,
      reused: true,
      sortOrder: index,
      status: "uploaded" as const,
      storageKey: photo.storage_key,
    }));
    setProductName(suggestion.productName || "");
    setProductType(suggestion.productType || "standard");
    setQuantity(String(suggestion.quantity || 1));
    setOriginalPriceJpy(suggestion.originalPriceJpy == null ? "" : String(suggestion.originalPriceJpy));
    setSalePriceTwd(suggestion.salePriceTwd == null ? "" : String(suggestion.salePriceTwd));
    setNote(suggestion.note || "");
    setReuseSourceTaskId(suggestion.sourceTemplateId ? "" : suggestion.sourceTaskId || "");
    setReuseSourceTemplateId(suggestion.sourceTemplateId || "");
    setPriceSource("memory");
    setPhotos(reusedPhotos);
    setProductFocused(false);
    setState({});
  }

  function removePhoto(clientPhotoId: string) {
    setPhotos((current) => {
      const removed = current.find((photo) => photo.clientPhotoId === clientPhotoId);
      if (removed) URL.revokeObjectURL(removed.objectUrl);
      uploadPromisesRef.current.delete(clientPhotoId);
      return current
        .filter((photo) => photo.clientPhotoId !== clientPhotoId)
        .map((photo, index) => ({ ...photo, sortOrder: index }));
    });
  }

  async function submitPurchaseTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    if (!photos.length || photos.some((photo) => photo.error)) {
      setState({ error: "請至少上傳一張符合規格的採買參考照。" });
      return;
    }
    setPending(true);
    setState({});
    try {
      const uploadedPhotos = await Promise.all(
        photos.map(async (photo) => {
          if (photo.storageKey) return photo;
          const pendingUpload = uploadPromisesRef.current.get(photo.clientPhotoId);
          try {
            const uploaded = pendingUpload
              ? await pendingUpload
              : await startPhotoUpload(photo);
            return { ...photo, ...uploaded };
          } catch (error) {
            const message = error instanceof Error ? error.message : "照片上傳失敗。";
            updatePhoto(photo.clientPhotoId, { error: message, status: "failed" });
            throw error;
          }
        }),
      );
      setPhotos(uploadedPhotos);
      formData.set(
        "referencePhotosJson",
        JSON.stringify(
          uploadedPhotos.map((photo) => ({
            byteSize: photo.byteSize,
            contentType: photo.contentType,
            originalFilename: photo.originalFilename,
            sortOrder: photo.sortOrder,
            storageKey: photo.storageKey,
            reused: Boolean(photo.reused),
          })),
        ),
      );
      formData.set("reuseSourceTaskId", reuseSourceTaskId);
      formData.set("reuseSourceTemplateId", reuseSourceTemplateId);
      const result = await createPurchaseTaskAction({}, formData);
      setState(result);
      if (result.ok) {
        for (const photo of uploadedPhotos) URL.revokeObjectURL(photo.objectUrl);
        uploadPromisesRef.current.clear();
        setPhotos([]);
        form.reset();
        setLineCommunityName("");
        setProductName("");
        setProductType(mode === "gacha" ? "gacha" : "standard");
        setQuantity("1");
        setOriginalPriceJpy("");
        setSalePriceTwd("");
        setNote("");
        setReuseSourceTaskId("");
        setReuseSourceTemplateId("");
        setPriceSource("auto");
        setFormResetKey((current) => current + 1);
      }
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "照片上傳失敗。" });
    } finally {
      setPending(false);
    }
  }

  function startPhotoUpload(photo: AdminTaskUploadPhoto) {
    const existing = uploadPromisesRef.current.get(photo.clientPhotoId);
    if (existing) return existing;
    updatePhoto(photo.clientPhotoId, { error: undefined, status: "uploading" });
    const uploadPromise = uploadAdminTaskPhoto(photo, trip.id, "admin_purchase_task_photo")
      .then((uploaded) => {
        updatePhoto(photo.clientPhotoId, uploaded);
        uploadPromisesRef.current.delete(photo.clientPhotoId);
        return uploaded;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "照片上傳失敗。";
        updatePhoto(photo.clientPhotoId, { error: message, status: "failed" });
        uploadPromisesRef.current.delete(photo.clientPhotoId);
        throw error;
      });
    uploadPromisesRef.current.set(photo.clientPhotoId, uploadPromise);
    return uploadPromise;
  }

  function updatePhoto(clientPhotoId: string, patch: Partial<AdminTaskUploadPhoto>) {
    setPhotos((current) =>
      current.map((photo) =>
        photo.clientPhotoId === clientPhotoId ? { ...photo, ...patch } : photo,
      ),
    );
  }

  const photosSelected = photos.length > 0 && photos.every((photo) => !photo.error);
  const requiredFieldsReady = Boolean(
    canCreate &&
    lineCommunityName.trim() &&
    productName.trim() &&
    quantity.trim() &&
    originalPriceJpy.trim() &&
    salePriceTwd.trim() &&
    photosSelected,
  );

  return (
    <form className="mt-3 grid gap-3 border-t pt-3" onSubmit={submitPurchaseTask}>
      <input name="tripId" type="hidden" value={trip.id} />
      {requiresFaceCheck && mode !== "gacha" ? <input name="requiresFaceCheck" type="hidden" value="on" /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">LINE 社群暱稱</span>
          <CustomerNicknameInput
            disabled={!canCreate || pending}
            key={formResetKey}
            onValueChange={setLineCommunityName}
            value={lineCommunityName}
          />
        </label>
        <label className="relative grid gap-1 text-sm">
          <span className="font-medium">商品名稱</span>
          <input
            aria-autocomplete="list"
            aria-expanded={productFocused && visibleProductSuggestions.length > 0}
            autoComplete="off"
            name="productName"
            placeholder="例如：限定色側背包"
            required
            role="combobox"
            value={productName}
            disabled={!canCreate || pending}
            onBlur={() => window.setTimeout(() => setProductFocused(false), 120)}
            onChange={(event) => {
              setProductName(event.currentTarget.value);
              setReuseSourceTaskId("");
              setReuseSourceTemplateId("");
            }}
            onFocus={() => setProductFocused(true)}
          />
          {productFocused && (productSuggestionsLoading || visibleProductSuggestions.length > 0) ? (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg" role="listbox">
              {productSuggestionsLoading ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">載入最近發布商品...</p>
              ) : visibleProductSuggestions.map((suggestion) => (
                <button
                  className="flex w-full touch-pan-y items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent"
                  key={`${suggestion.sourceKind || "purchase"}:${suggestion.sourceTemplateId || suggestion.sourceTaskId || suggestion.productName}`}
                  role="option"
                  type="button"
                  onPointerDown={(event) => {
                    // Keep the input focused for mouse selection without
                    // intercepting touch gestures used to scroll the list.
                    if (event.pointerType === "mouse") event.preventDefault();
                  }}
                  onClick={() => applyProductSuggestion(suggestion)}
                >
                  {suggestion.photos[0]?.signed_url ? (
                    <img alt="" className="size-12 rounded-md object-cover" src={suggestion.photos[0].signed_url} />
                  ) : (
                    <span className="size-12 rounded-md bg-muted" />
                  )}
                  <span className="min-w-0">
                    <strong className="block truncate text-sm">{suggestion.productName}</strong>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {purchaseProductTypeLabel(suggestion.productType)} · JPY {suggestion.originalPriceJpy ?? "-"} · {suggestion.photos.length} 張照片
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">商品類型</span>
          {mode === "gacha" ? (
            <select
              name="productType"
              value={productType === "blind_box" ? "blind_box" : "gacha"}
              disabled={!canCreate || pending}
              onChange={(event) => {
                const nextType = event.currentTarget.value as PurchaseProductType;
                setProductType(nextType);
                setReuseSourceTaskId("");
                setReuseSourceTemplateId("");
                if (nextType === "blind_box") {
                  setPriceSource("manual");
                } else if (priceSource === "auto") {
                  const mapped = GACHA_PRICE_MAP[originalPriceJpy];
                  if (mapped) setSalePriceTwd(mapped);
                }
              }}
            >
              <option value="gacha">扭蛋</option>
              <option value="blind_box">盲抽</option>
            </select>
          ) : (
            <>
              <input name="productType" type="hidden" value="standard" />
              <span className="rounded-md border bg-muted/30 px-3 py-2 text-sm">一般商品</span>
            </>
          )}
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">採買數量</span>
          <input name="quantity" inputMode="numeric" min="1" placeholder="1" required value={quantity} disabled={!canCreate || pending} onChange={(event) => setQuantity(event.currentTarget.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">商品原價（JPY）</span>
          <input
            name="originalPriceJpy"
            inputMode="numeric"
            min="0"
            placeholder="1200"
            required
            value={originalPriceJpy}
            disabled={!canCreate || pending}
            onChange={(event) => {
              const nextPrice = event.currentTarget.value;
              setOriginalPriceJpy(nextPrice);
              if (mode === "gacha" && productType === "gacha" && priceSource === "auto") {
                const mapped = GACHA_PRICE_MAP[nextPrice];
                if (mapped) setSalePriceTwd(mapped);
              }
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">客人售價（TWD）</span>
          <input
            name="salePriceTwd"
            inputMode="numeric"
            min="0"
            placeholder={mode === "gacha" && productType === "gacha" ? "依日幣原價自動帶入，可修改" : "380"}
            required
            value={salePriceTwd}
            disabled={!canCreate || pending}
            onChange={(event) => {
              setSalePriceTwd(event.currentTarget.value);
              setPriceSource("manual");
            }}
          />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">給小幫手的備註（選填）</span>
        <textarea name="note" placeholder="尺寸、顏色、版本或現場確認重點" value={note} disabled={!canCreate || pending} onChange={(event) => setNote(event.currentTarget.value)} />
      </label>
      {reuseSourceTaskId || reuseSourceTemplateId ? (
        <p className="rounded-md bg-primary/5 px-3 py-2 text-xs text-primary">
          已套用記憶商品資料；系列參考圖會沿用，數量與客人暱稱仍可修改，台幣價格仍可調整。
        </p>
      ) : null}
      <div className="grid gap-2">
        <p className="text-sm font-medium">採買參考照（必填）</p>
        <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-center">
          <ImageUp className="size-5" aria-hidden="true" />
          <span className="text-sm">選擇商品照片或參考截圖</span>
          <PhotoFileInput
            accept="image/*"
            className="sr-only"
            disabled={!canCreate || pending}
            multiple
            required={!photos.length}
            onFiles={addFiles}
          />
        </label>
        {photos.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {photos.map((photo) => (
              <div className={`rounded-md border p-2 ${photo.status === "uploaded" ? "border-emerald-400 bg-emerald-50/40" : "bg-background"}`} key={photo.clientPhotoId}>
                <img
                  alt="採買參考照"
                  className="aspect-square w-full rounded-md object-cover"
                  src={photo.objectUrl}
                />
                <div className="mt-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {adminUploadStatusLabel(photo.status) ? (
                      <p className="text-xs text-muted-foreground">{adminUploadStatusLabel(photo.status)}</p>
                    ) : null}
                  </div>
                  {!pending ? (
                    <div className="flex items-center gap-1">
                      {photo.status === "failed" && !photo.reused ? (
                        <button
                          className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
                          type="button"
                          onClick={() => void startPhotoUpload(photo).catch(() => undefined)}
                        >
                          重試
                        </button>
                      ) : null}
                      <button
                        aria-label="移除照片"
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                        type="button"
                        onClick={() => removePhoto(photo.clientPhotoId)}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : null}
                </div>
                {photo.error ? <p className="mt-1 text-xs text-destructive">{photo.error}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <ActionMessage state={state} />
      <Button
        disabled={
          pending ||
          !requiredFieldsReady
        }
        size="sm"
        type="submit"
      >
        送出
      </Button>
    </form>
  );
}

export function QuickPublishPurchaseForm({
  onPublished,
  photo,
  task,
}: {
  onPublished?: () => void;
  photo: any;
  task: any;
}) {
  const [state, action, pending] = useActionState(quickPublishPurchaseTaskAction, initialState);
  const [expanded, setExpanded] = useState(false);
  const latestReply = photo.latest_reply || {};
  const defaultProductName = photo.product_name || task.product_name || "";
  const [productName, setProductName] = useState(defaultProductName);
  const [productType, setProductType] = useState<PurchaseProductType>("standard");
  const [quantity, setQuantity] = useState("1");
  const [originalPriceJpy, setOriginalPriceJpy] = useState(
    latestReply.price_jpy == null ? "" : String(latestReply.price_jpy),
  );
  const [salePriceTwd, setSalePriceTwd] = useState("");
  const [requiresFaceCheck, setRequiresFaceCheck] = useState(false);
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<QuickPublishHistory[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [appliedHistoryId, setAppliedHistoryId] = useState("");
  const canPublish = ["replied", "converted_to_purchase"].includes(photo.reply_status);
  const purchaseTaskCount = Math.max(Number(photo.purchase_task_count || 0), photo.reply_status === "converted_to_purchase" ? 1 : 0);
  const hasPublished = purchaseTaskCount > 0;

  useEffect(() => {
    if (!expanded || !hasPublished || historyLoaded) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError("");
    void fetch(
      `/api/admin/live/quote-tasks/${encodeURIComponent(task.id)}/purchase-history?tripId=${encodeURIComponent(task.trip_id)}&quoteTaskPhotoId=${encodeURIComponent(photo.id)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "無法載入快速發布紀錄。");
        if (!controller.signal.aborted) {
          setHistory(Array.isArray(body.history) ? body.history : []);
          setHistoryLoaded(true);
        }
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError") && !controller.signal.aborted) {
          setHistoryError(error instanceof Error ? error.message : "無法載入快速發布紀錄。");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [expanded, hasPublished, historyLoaded, photo.id, task.id, task.trip_id]);

  useEffect(() => {
    if (state.ok) {
      setHistory([]);
      setHistoryLoaded(false);
      setHistoryExpanded(false);
      setAppliedHistoryId("");
      onPublished?.();
    }
  }, [onPublished, state.ok]);

  function applyHistoryItem(item: QuickPublishHistory) {
    setProductName(item.productName || defaultProductName);
    setProductType(item.productType || "standard");
    setQuantity(item.quantity == null ? "1" : String(item.quantity));
    setOriginalPriceJpy(item.originalPriceJpy == null ? "" : String(item.originalPriceJpy));
    setSalePriceTwd(item.salePriceTwd == null ? "" : String(item.salePriceTwd));
    setRequiresFaceCheck(Boolean(item.requiresFaceCheck));
    setNote(item.note || "");
    setAppliedHistoryId(item.id);
    setHistoryExpanded(false);
  }

  function retryHistory() {
    setHistoryLoaded(false);
    setHistoryError("");
  }

  const visibleHistory = historyExpanded ? history : history.slice(0, 1);

  if (!canPublish) return null;
  if (!expanded) {
    return (
      <Button
        className="mt-2 w-full sm:w-fit"
        size="sm"
        type="button"
        variant="outline"
        onClick={() => setExpanded(true)}
      >
        {hasPublished ? "再次發布採買" : "轉為採買"}
      </Button>
    );
  }
  return (
    <form action={action} className="mt-3 grid gap-3 rounded-lg border bg-card p-3">
      <input name="tripId" type="hidden" value={task.trip_id} />
      <input name="quoteTaskPhotoId" type="hidden" value={photo.id} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">建立採買任務</p>
          <p className="text-xs text-muted-foreground">
            同一份報價可對不同客人重複發布；每次都會建立獨立採買任務，來源照片與報價會一併保留。
          </p>
          {hasPublished ? (
            <p className="mt-1 text-xs font-medium text-primary">目前已發布 {purchaseTaskCount} 次，可繼續發布。</p>
          ) : null}
        </div>
        <Button size="sm" type="button" variant="ghost" onClick={() => setExpanded(false)}>
          收合
        </Button>
      </div>
      {hasPublished ? (
        <div className="grid gap-2 rounded-lg border border-dashed bg-muted/20 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">本任務之前發布</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                點擊歷史資料可帶入商品欄位；客人暱稱需要重新填寫，照片會沿用目前區塊二回覆。
              </p>
            </div>
            {history.length > 1 ? (
              <Button
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => setHistoryExpanded((current) => !current)}
              >
                {historyExpanded ? "收合歷次" : `查看歷次 (${history.length})`}
              </Button>
            ) : null}
          </div>
          {historyLoading ? (
            <p className="rounded-md bg-background px-3 py-2 text-xs text-muted-foreground">載入歷史發布資料...</p>
          ) : historyError ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-background px-3 py-2 text-xs text-destructive">
              <span>{historyError}</span>
              <Button size="sm" type="button" variant="outline" onClick={retryHistory}>重試</Button>
            </div>
          ) : visibleHistory.length ? (
            <div className="grid gap-2">
              {visibleHistory.map((item) => (
                <button
                  className={`grid gap-1 rounded-md border bg-background px-3 py-2 text-left transition hover:border-primary hover:bg-primary/5 ${appliedHistoryId === item.id ? "border-primary ring-1 ring-primary/20" : ""}`}
                  key={item.id}
                  type="button"
                  onClick={() => applyHistoryItem(item)}
                >
                  <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="truncate">{item.productName}</span>
                    <span className="text-xs font-normal text-muted-foreground">{purchaseProductTypeLabel(item.productType)}</span>
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>JPY {item.originalPriceJpy ?? "-"}</span>
                    <span>TWD {item.salePriceTwd ?? "-"}</span>
                    <span>數量 {item.quantity ?? "-"}</span>
                    <span>{item.requiresFaceCheck ? "需挑臉" : "免挑臉"}</span>
                    <span>{quickPublishHistoryStatusLabel(item.status)}</span>
                    <span>{quickPublishHistoryDateLabel(item.createdAt)}</span>
                  </span>
                  <span className="text-xs font-medium text-primary">點擊帶入這筆資料</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-md bg-background px-3 py-2 text-xs text-muted-foreground">目前沒有可帶入的歷史資料。</p>
          )}
          {appliedHistoryId ? (
            <p className="text-xs font-medium text-primary">已帶入歷史商品資料；客人暱稱與目前來源照片未被帶入。</p>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <CustomerNicknameInput disabled={!canPublish || pending} />
        <input name="productName" placeholder="商品名稱" value={productName} required disabled={!canPublish || pending} onChange={(event) => setProductName(event.currentTarget.value)} />
        <label className="grid gap-1 text-sm">
          <span className="font-medium">商品類型</span>
          <select
            name="productType"
            value={productType}
            disabled={!canPublish || pending}
            onChange={(event) => setProductType(event.currentTarget.value as PurchaseProductType)}
          >
            <option value="standard">一般商品</option>
            <option value="gacha">扭蛋</option>
            <option value="blind_box">盲抽</option>
          </select>
        </label>
        <input name="quantity" inputMode="numeric" min="1" placeholder="數量" value={quantity} required disabled={!canPublish || pending} onChange={(event) => setQuantity(event.currentTarget.value)} />
        <input
          name="originalPriceJpy"
          inputMode="numeric"
          min="0"
          placeholder="原價 JPY"
          value={originalPriceJpy}
          disabled={!canPublish || pending}
          onChange={(event) => setOriginalPriceJpy(event.currentTarget.value)}
        />
        <input name="salePriceTwd" inputMode="numeric" min="0" placeholder="售價 TWD" required value={salePriceTwd} disabled={!canPublish || pending} onChange={(event) => setSalePriceTwd(event.currentTarget.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input name="requiresFaceCheck" type="checkbox" checked={requiresFaceCheck} disabled={!canPublish || pending} onChange={(event) => setRequiresFaceCheck(event.currentTarget.checked)} />
        需要挑臉審核
      </label>
      <textarea name="note" placeholder="採買備註，可留空" value={note} disabled={!canPublish || pending} onChange={(event) => setNote(event.currentTarget.value)} />
      <ActionMessage state={state} />
      <Button disabled={!canPublish || pending} size="sm" type="submit" variant="outline">
        {pending ? "發布中..." : "確認發布採買"}
      </Button>
    </form>
  );
}

function CustomerNicknameInput({
  disabled,
  onValueChange,
  placeholder = "LINE 社群暱稱",
  required = true,
  value: controlledValue,
}: {
  disabled: boolean;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  value?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [internalValue, setInternalValue] = useState("");
  const value = controlledValue ?? internalValue;
  const normalizedValue = value.trim();

  function updateValue(nextValue: string) {
    if (controlledValue === undefined) setInternalValue(nextValue);
    onValueChange?.(nextValue);
  }

  useEffect(() => {
    if (!focused || !normalizedValue) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const cached = customerNicknameCache.get(normalizedValue);
    if (cached) {
      setSuggestions(cached);
      setLoading(false);
      return;
    }
    const cachedPrefix = Array.from(customerNicknameCache.entries())
      .filter(([query]) => normalizedValue.startsWith(query))
      .sort((a, b) => b[0].length - a[0].length)[0];
    if (cachedPrefix) {
      setSuggestions(
        cachedPrefix[1].filter((nickname) =>
          nickname.toLowerCase().includes(normalizedValue.toLowerCase()),
        ),
      );
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/admin/customers/search?q=${encodeURIComponent(normalizedValue)}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "搜尋失敗。");
        const nextSuggestions = Array.isArray(body.nicknames) ? body.nicknames : [];
        customerNicknameCache.set(normalizedValue, nextSuggestions);
        setSuggestions(nextSuggestions);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, cachedPrefix ? 60 : 80);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [focused, normalizedValue]);

  return (
    <div className="relative">
      <input
        aria-autocomplete="list"
        aria-expanded={focused && suggestions.length > 0}
        autoComplete="off"
        className="w-full"
        disabled={disabled}
        name="lineCommunityName"
        placeholder={placeholder}
        required={required}
        role="combobox"
        value={value}
        onBlur={() => setFocused(false)}
        onChange={(event) => updateValue(event.currentTarget.value)}
        onFocus={() => setFocused(true)}
      />
      {focused && normalizedValue && (loading || suggestions.length > 0) ? (
        <div
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          role="listbox"
        >
          {loading ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">搜尋中...</p>
          ) : suggestions.map((nickname) => (
            <button
              className="block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              key={nickname}
              role="option"
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                updateValue(nickname);
                setFocused(false);
              }}
            >
              {nickname}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type AdminTaskUploadPhoto = {
  byteSize: number;
  clientPhotoId: string;
  contentType: string;
  error?: string;
  file?: File;
  objectUrl: string;
  originalFilename: string;
  reused?: boolean;
  sortOrder: number;
  status: "selected" | "uploading" | "uploaded" | "failed";
  storageKey?: string;
};

const MAX_ADMIN_TASK_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_ADMIN_TASK_SOURCE_PHOTO_BYTES = 24 * 1024 * 1024;

function CreateUploadedQuoteTaskForm({
  taskType,
  trip,
}: {
  taskType: QuoteTaskFormProps["taskType"];
  trip: QuoteTaskFormProps["trip"];
}) {
  const [photos, setPhotos] = useState<AdminTaskUploadPhoto[]>([]);
  const photosRef = useRef<AdminTaskUploadPhoto[]>([]);
  const uploadPromisesRef = useRef(new Map<string, Promise<Partial<AdminTaskUploadPhoto>>>());
  const [state, setState] = useState<AdminActionResult>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.objectUrl);
    },
    [],
  );

  function addFiles(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .map((file, index) => ({
        byteSize: file.size,
        clientPhotoId: createClientId("admin-task-photo"),
        contentType: file.type || "image/jpeg",
        error:
          file.size > MAX_ADMIN_TASK_SOURCE_PHOTO_BYTES
            ? "照片超過 24MB，請先縮小後再上傳。"
            : undefined,
        file,
        objectUrl: URL.createObjectURL(file),
        originalFilename: file.name || "task-photo.jpg",
        sortOrder: photos.length + index,
        status: file.size > MAX_ADMIN_TASK_SOURCE_PHOTO_BYTES ? "failed" as const : "selected" as const,
      }));
    setPhotos((current) => [
      ...current,
      ...selected.map((photo, index) => ({ ...photo, sortOrder: current.length + index })),
    ]);
    for (const photo of selected.filter((item) => !item.error)) {
      void startPhotoUpload(photo).catch(() => undefined);
    }
  }

  function removePhoto(clientPhotoId: string) {
    setPhotos((current) => {
      const removed = current.find((photo) => photo.clientPhotoId === clientPhotoId);
      if (removed) URL.revokeObjectURL(removed.objectUrl);
      uploadPromisesRef.current.delete(clientPhotoId);
      return current
        .filter((photo) => photo.clientPhotoId !== clientPhotoId)
        .map((photo, index) => ({ ...photo, sortOrder: index }));
    });
  }

  async function submitQuoteTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!photos.length || photos.some((photo) => photo.error)) {
      setState({ error: "請至少上傳一張符合規格的照片。" });
      return;
    }
    setPending(true);
    setState({});
    try {
      const uploadedPhotos = await Promise.all(
        photos.map(async (photo) => {
          if (photo.storageKey) return photo;
          try {
            const pendingUpload = uploadPromisesRef.current.get(photo.clientPhotoId);
            const uploaded = pendingUpload
              ? await pendingUpload
              : await startPhotoUpload(photo);
            return { ...photo, ...uploaded };
          } catch (error) {
            const message = error instanceof Error ? error.message : "照片上傳失敗。";
            updatePhoto(photo.clientPhotoId, { error: message, status: "failed" });
            throw error;
          }
        }),
      );
      setPhotos(uploadedPhotos);

      const formData = new FormData(form);
      formData.set(
        "uploadedPhotosJson",
        JSON.stringify(
          uploadedPhotos.map((photo) => ({
            byteSize: photo.byteSize,
            contentType: photo.contentType,
            originalFilename: photo.originalFilename,
            sortOrder: photo.sortOrder,
            storageKey: photo.storageKey,
          })),
        ),
      );
      const result = await createQuoteTaskAction({}, formData);
      setState(result);
      if (result.ok) {
        for (const photo of uploadedPhotos) URL.revokeObjectURL(photo.objectUrl);
        setPhotos([]);
        form.reset();
      }
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "照片上傳失敗。" });
    } finally {
      setPending(false);
    }
  }

  function startPhotoUpload(photo: AdminTaskUploadPhoto) {
    const existing = uploadPromisesRef.current.get(photo.clientPhotoId);
    if (existing) return existing;
    updatePhoto(photo.clientPhotoId, { error: undefined, status: "uploading" });
    const uploadPromise = uploadAdminTaskPhoto(photo, trip.id)
      .then((uploaded) => {
        updatePhoto(photo.clientPhotoId, uploaded);
        uploadPromisesRef.current.delete(photo.clientPhotoId);
        return uploaded;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "照片上傳失敗。";
        updatePhoto(photo.clientPhotoId, { error: message, status: "failed" });
        uploadPromisesRef.current.delete(photo.clientPhotoId);
        throw error;
      });
    uploadPromisesRef.current.set(photo.clientPhotoId, uploadPromise);
    return uploadPromise;
  }

  function updatePhoto(clientPhotoId: string, patch: Partial<AdminTaskUploadPhoto>) {
    setPhotos((current) =>
      current.map((photo) =>
        photo.clientPhotoId === clientPhotoId ? { ...photo, ...patch } : photo,
      ),
    );
  }

  return (
    <form className="mt-3 grid gap-3 border-t pt-3" onSubmit={submitQuoteTask}>
      <input name="tripId" type="hidden" value={trip.id} />
      <input name="taskType" type="hidden" value={taskType} />
      <input name="productName" placeholder="商品名稱，可留空" disabled={pending} />
      <textarea name="instruction" placeholder="任務說明，可留空" disabled={pending} />
      <div className="grid gap-2">
        <p className="text-sm font-medium">上傳照片（必填）</p>
        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 p-4 text-center">
          <ImageUp className="size-5" aria-hidden="true" />
          <span className="text-sm">選擇要發布{adminQuoteTaskTypeLabel(taskType)}任務的照片</span>
          <PhotoFileInput
            accept="image/*"
            className="sr-only"
            disabled={pending}
            multiple
            required={!photos.length}
            onFiles={addFiles}
          />
        </label>
      </div>
      {photos.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <div className={`rounded-lg border p-2 ${photo.status === "uploaded" ? "border-emerald-400 bg-emerald-50/40" : "bg-background"}`} key={photo.clientPhotoId}>
              <div className="relative">
                <img
                  alt="任務照片"
                  className="aspect-square w-full rounded-md object-cover"
                  src={photo.objectUrl}
                />
                <span className="absolute left-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/70 text-xs font-semibold text-white">
                  {index + 1}
                </span>
              </div>
              <div className="mt-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {adminUploadStatusLabel(photo.status) ? (
                    <p className="text-xs text-muted-foreground">{adminUploadStatusLabel(photo.status)}</p>
                  ) : null}
                </div>
                {!pending ? (
                  <button
                    aria-label="移除照片"
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                    type="button"
                    onClick={() => removePhoto(photo.clientPhotoId)}
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
              {photo.error ? <p className="mt-1 text-xs text-destructive">{photo.error}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      <ActionMessage state={state} />
      <Button
        disabled={
          pending ||
          !photos.length ||
          photos.some((photo) => Boolean(photo.error))
        }
        size="sm"
        type="submit"
      >
        送出
      </Button>
    </form>
  );
}

function adminQuoteTaskTypeLabel(taskType: QuoteTaskFormProps["taskType"]) {
  if (taskType === "quote") return "報價";
  if (taskType === "detail") return "細圖";
  return "報價＋細圖";
}

async function uploadAdminTaskPhoto(
  photo: AdminTaskUploadPhoto,
  tripId: string,
  uploadPurpose = "admin_quote_task_photo",
) {
  if (!photo.file) throw new Error("找不到待上傳照片。");
  const preparedFile = await preparePhotoForUpload(photo.file);
  let presign: Response;
  try {
    presign = await fetch("/api/uploads/presign", {
      body: JSON.stringify({
        clientPhotoId: photo.clientPhotoId,
        contentType: preparedFile.type || photo.contentType,
        byteSize: preparedFile.size,
        fileName: photo.originalFilename,
        tripId,
        uploadPurpose,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  } catch {
    throw new Error("無法連線到照片上傳服務，請確認網路後重試。");
  }
  const presignBody = await presign.json();
  if (!presign.ok) throw new Error(presignBody.error || "無法建立上傳網址。");
  await uploadToPresignedPhotoUrl(
    presignBody.uploadUrl,
    preparedFile,
    preparedFile.type || photo.contentType,
  );
  return {
    byteSize: preparedFile.size,
    contentType: preparedFile.type || photo.contentType,
    error: undefined,
    status: "uploaded" as const,
    storageKey: presignBody.storageKey,
  };
}

async function uploadAdminRebuyReferencePhoto(photo: AdminTaskUploadPhoto) {
  if (!photo.file) throw new Error("找不到待上傳照片。");
  const presign = await fetch("/api/uploads/presign", {
    body: JSON.stringify({
      clientPhotoId: photo.clientPhotoId,
      contentType: photo.contentType,
      byteSize: photo.byteSize,
      fileName: photo.originalFilename,
      uploadPurpose: "admin_rebuy_reference",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const presignBody = await presign.json();
  if (!presign.ok) throw new Error(presignBody.error || "無法建立上傳網址。");
  await uploadToPresignedPhotoUrl(
    presignBody.uploadUrl,
    photo.file,
    photo.contentType,
  );
  return { error: undefined, status: "uploaded" as const, storageKey: presignBody.storageKey };
}

async function uploadToPresignedPhotoUrl(
  uploadUrl: string,
  file: Blob,
  contentType: string,
) {
  try {
    const response = await fetch(uploadUrl, {
      body: file,
      headers: { "content-type": contentType },
      method: "PUT",
    });
    if (!response.ok) throw new Error(`R2 上傳失敗 (${response.status})。`);
  } catch (error) {
    if (error instanceof Error && error.message !== "Failed to fetch") throw error;
    throw new Error("照片上傳連線失敗，請重試；若持續失敗請確認 R2 上傳權限與網路。");
  }
}

function adminUploadStatusLabel(status: AdminTaskUploadPhoto["status"]) {
  if (status === "uploading") return "上傳中";
  if (status === "uploaded") return "";
  if (status === "failed") return "上傳失敗";
  return "等待發布";
}

function createClientId(prefix: string) {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}-${randomUuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isoValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function ActionMessage({ state }: { state: AdminActionResult }) {
  if (state.ok) return <p className="text-sm text-primary">已完成。</p>;
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  return null;
}
