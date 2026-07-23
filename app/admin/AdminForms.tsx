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
type TaskSubType = "detail" | "face_check" | "quote" | "quote_and_detail" | "standard";

const quoteTaskTypes = [
  { id: "quote", label: "報價", body: "請小幫手回傳商品價格。" },
  { id: "detail", label: "細圖", body: "請小幫手補拍商品細節。" },
  { id: "quote_and_detail", label: "報價＋細圖", body: "同時回傳價格與商品細節照。" },
] as const;

const purchaseTaskTypes = [
  { id: "standard", label: "一般採買", body: "發布一般數量的採買指示。" },
  { id: "face_check", label: "挑臉採買", body: "採買後需由管理員審核商品狀態。" },
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

export function CreateRebuyTaskForm({
  helpers,
  purchaseTasks,
}: {
  helpers: Array<{ display_name: string; id: string; is_active: boolean }>;
  purchaseTasks: Array<{
    id: string;
    line_community_name?: string | null;
    product_name: string;
    status: string;
  }>;
}) {
  const [photos, setPhotos] = useState<AdminTaskUploadPhoto[]>([]);
  const photosRef = useRef<AdminTaskUploadPhoto[]>([]);
  const [state, setState] = useState<AdminActionResult>({});
  const [pending, setPending] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const sourceCandidates = purchaseTasks.filter((task) => ["canceled", "unavailable", "not_found"].includes(task.status));

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

  function removePhoto(clientPhotoId: string) {
    setPhotos((current) => {
      const removed = current.find((photo) => photo.clientPhotoId === clientPhotoId);
      if (removed) URL.revokeObjectURL(removed.objectUrl);
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
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span>商品名稱</span>
          <input name="productName" placeholder="手動建立時必填" disabled={pending} />
        </label>
        <label className="grid gap-1">
          <span>客人 LINE 名稱</span>
          <CustomerNicknameInput disabled={pending} placeholder="從客戶主檔建議" required={false} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1">
          <span>數量</span>
          <input name="quantity" inputMode="numeric" min="1" placeholder="1" disabled={pending} />
        </label>
        <label className="grid gap-1">
          <span>JPY 單價</span>
          <input name="originalPriceJpy" inputMode="numeric" min="0" placeholder="0" disabled={pending} />
        </label>
        <label className="grid gap-1">
          <span>TWD 售價</span>
          <input name="salePriceTwd" inputMode="numeric" min="0" placeholder="0" disabled={pending} />
        </label>
      </div>
      <label className="grid gap-1">
        <span>補買指示</span>
        <textarea name="instructions" placeholder="例如：架位、款式或替代條件" disabled={pending} />
      </label>
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

export function CreatePurchaseTaskForm({
  requiresFaceCheck,
  trip,
}: {
  requiresFaceCheck: boolean;
  trip: { id: string; status: string; trip_name: string };
}) {
  const [photos, setPhotos] = useState<AdminTaskUploadPhoto[]>([]);
  const photosRef = useRef<AdminTaskUploadPhoto[]>([]);
  const uploadPromisesRef = useRef(new Map<string, Promise<Partial<AdminTaskUploadPhoto>>>());
  const [state, setState] = useState<AdminActionResult>({});
  const [pending, setPending] = useState(false);
  const [formResetKey, setFormResetKey] = useState(0);
  const canCreate = trip.status === "active";

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
      startPhotoUpload(photo);
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
          })),
        ),
      );
      const result = await createPurchaseTaskAction({}, formData);
      setState(result);
      if (result.ok) {
        for (const photo of uploadedPhotos) URL.revokeObjectURL(photo.objectUrl);
        uploadPromisesRef.current.clear();
        setPhotos([]);
        form.reset();
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
    <form className="mt-3 grid gap-3 border-t pt-3" onSubmit={submitPurchaseTask}>
      <input name="tripId" type="hidden" value={trip.id} />
      {requiresFaceCheck ? <input name="requiresFaceCheck" type="hidden" value="on" /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">LINE 社群暱稱</span>
          <CustomerNicknameInput disabled={!canCreate || pending} key={formResetKey} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">商品名稱</span>
          <input name="productName" placeholder="例如：限定色側背包" required disabled={!canCreate || pending} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">採買數量</span>
          <input name="quantity" inputMode="numeric" min="1" placeholder="1" required disabled={!canCreate || pending} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">商品原價（JPY）</span>
          <input name="originalPriceJpy" inputMode="numeric" min="0" placeholder="1200" required disabled={!canCreate || pending} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">客人售價（TWD）</span>
          <input name="salePriceTwd" inputMode="numeric" min="0" placeholder="380" required disabled={!canCreate || pending} />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">給小幫手的備註（選填）</span>
        <textarea name="note" placeholder="尺寸、顏色、版本或現場確認重點" disabled={!canCreate || pending} />
      </label>
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
      <Button
        disabled={
          !canCreate ||
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

export function QuickPublishPurchaseForm({
  photo,
  task,
}: {
  photo: any;
  task: any;
}) {
  const [state, action, pending] = useActionState(quickPublishPurchaseTaskAction, initialState);
  const [expanded, setExpanded] = useState(false);
  const latestReply = photo.latest_reply || {};
  const defaultProductName = photo.product_name || task.product_name || "";
  const canPublish = photo.reply_status === "replied";
  if (photo.reply_status === "converted_to_purchase") {
    return <p className="mt-2 text-sm font-medium text-primary">這張回覆已轉為採買任務。</p>;
  }
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
        轉為採買
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
          <p className="text-xs text-muted-foreground">只轉換目前這一張回覆，來源照片與報價會一併保留。</p>
        </div>
        <Button size="sm" type="button" variant="ghost" onClick={() => setExpanded(false)}>
          收合
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <CustomerNicknameInput disabled={!canPublish || pending} />
        <input name="productName" placeholder="商品名稱" defaultValue={defaultProductName} required disabled={!canPublish || pending} />
        <input name="quantity" inputMode="numeric" min="1" placeholder="數量" defaultValue="1" required disabled={!canPublish || pending} />
        <input
          name="originalPriceJpy"
          inputMode="numeric"
          min="0"
          placeholder="原價 JPY"
          defaultValue={latestReply.price_jpy ?? ""}
          disabled={!canPublish || pending}
        />
        <input name="salePriceTwd" inputMode="numeric" min="0" placeholder="售價 TWD" required disabled={!canPublish || pending} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input name="requiresFaceCheck" type="checkbox" disabled={!canPublish || pending} />
        需要挑臉審核
      </label>
      <textarea name="note" placeholder="採買備註，可留空" disabled={!canPublish || pending} />
      <ActionMessage state={state} />
      <Button disabled={!canPublish || pending} size="sm" type="submit" variant="outline">
        {pending ? "發布中..." : "確認發布採買"}
      </Button>
    </form>
  );
}

function CustomerNicknameInput({
  disabled,
  placeholder = "LINE 社群暱稱",
  required = true,
}: {
  disabled: boolean;
  placeholder?: string;
  required?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [value, setValue] = useState("");
  const normalizedValue = value.trim();

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
        onChange={(event) => setValue(event.currentTarget.value)}
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
                setValue(nickname);
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
  file: File;
  objectUrl: string;
  originalFilename: string;
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

async function uploadAdminTaskPhoto(photo: AdminTaskUploadPhoto, tripId: string) {
  const preparedFile = await preparePhotoForUpload(photo.file);
  const presign = await fetch("/api/uploads/presign", {
    body: JSON.stringify({
      clientPhotoId: photo.clientPhotoId,
      contentType: preparedFile.type || photo.contentType,
      byteSize: preparedFile.size,
      fileName: photo.originalFilename,
      tripId,
      uploadPurpose: "admin_quote_task_photo",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const presignBody = await presign.json();
  if (!presign.ok) throw new Error(presignBody.error || "無法建立上傳網址。");
  const upload = await fetch(presignBody.uploadUrl, {
    body: preparedFile,
    headers: { "content-type": preparedFile.type || photo.contentType },
    method: "PUT",
  });
  if (!upload.ok) throw new Error(`R2 上傳失敗 (${upload.status})。`);
  return {
    byteSize: preparedFile.size,
    contentType: preparedFile.type || photo.contentType,
    error: undefined,
    status: "uploaded" as const,
    storageKey: presignBody.storageKey,
  };
}

async function uploadAdminRebuyReferencePhoto(photo: AdminTaskUploadPhoto) {
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
  const upload = await fetch(presignBody.uploadUrl, {
    body: photo.file,
    headers: { "content-type": photo.contentType },
    method: "PUT",
  });
  if (!upload.ok) throw new Error(`R2 上傳失敗 (${upload.status})。`);
  return { error: undefined, status: "uploaded" as const, storageKey: presignBody.storageKey };
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
