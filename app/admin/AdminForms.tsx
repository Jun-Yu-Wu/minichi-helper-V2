"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ImageUp, X } from "lucide-react";

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

const initialState: AdminActionResult = {};

export function CreateHelperForm() {
  const [state, action, pending] = useActionState(createHelperAction, initialState);
  return (
    <form action={action} className="grid gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-lg font-semibold">新增小幫手</h2>
      <input name="displayName" placeholder="顯示名稱" required />
      <input name="email" type="email" placeholder="登入 Email" required />
      <input name="authUserId" placeholder="Supabase Auth user id，可稍後補" />
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
    <form action={action} className="grid gap-3 rounded-lg border bg-card p-4">
      <input name="helperId" type="hidden" value={helper.id} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{helper.display_name}</h3>
          <p className="text-sm text-muted-foreground">{helper.email}</p>
        </div>
        <span className="rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
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
    <form action={action} className="grid gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-lg font-semibold">新增行程</h2>
      <input name="tripName" placeholder="行程名稱" required />
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="businessDate" type="date" required />
        <input name="scheduledTime" type="time" />
      </div>
      <input name="location" placeholder="地點" />
      <input name="timezone" defaultValue="Asia/Tokyo" placeholder="時區" required />
      <select name="assignedHelperId" required>
        <option value="">指派小幫手</option>
        {helpers
          .filter((helper) => helper.is_active)
          .map((helper) => (
            <option key={helper.id} value={helper.id}>
              {helper.display_name}
            </option>
          ))}
      </select>
      <ActionMessage state={state} />
      <Button disabled={pending} type="submit">
        {pending ? "建立中..." : "建立 scheduled 行程"}
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
  availablePhotos: Array<{
    id: string;
    original_filename?: string | null;
    saved_by_admin?: boolean;
    signed_url?: string;
    sort_order: number;
  }>;
  taskType: "detail" | "quote" | "quote_and_detail";
  trip: { id: string; status: string; trip_name: string };
};

export function CreateQuoteTaskForm(props: QuoteTaskFormProps) {
  if (props.taskType === "detail") {
    return <CreateUploadedDetailTaskForm trip={props.trip} />;
  }
  return <CreateSitePhotoQuoteTaskForm {...props} />;
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
  const [state, action, pending] = useActionState(createRebuyTaskAction, initialState);
  const sourceCandidates = purchaseTasks.filter((task) => ["canceled", "unavailable", "not_found"].includes(task.status));
  return (
    <form action={action} className="grid gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-lg font-semibold">新增補買任務</h2>
      <select name="visibility" defaultValue="private">
        <option value="private">指定小幫手</option>
        <option value="public">公共補買池</option>
      </select>
      <select name="assignedHelperId">
        <option value="">公共任務或從原採買帶入</option>
        {helpers.filter((helper) => helper.is_active).map((helper) => (
          <option key={helper.id} value={helper.id}>{helper.display_name}</option>
        ))}
      </select>
      <select name="sourcePurchaseTaskId">
        <option value="">手動建立，不綁定原採買</option>
        {sourceCandidates.map((task) => (
          <option key={task.id} value={task.id}>
            {task.product_name} · {task.line_community_name || "未填客人"} · {task.status}
          </option>
        ))}
      </select>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="productName" placeholder="商品名稱（手動建立必填）" />
        <input name="lineCommunityName" placeholder="客人 LINE 名稱（public 對其他小幫手隱藏）" />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <input name="quantity" inputMode="numeric" placeholder="數量" />
        <input name="originalPriceJpy" inputMode="numeric" placeholder="JPY 單價" />
        <input name="salePriceTwd" inputMode="numeric" placeholder="TWD 售價" />
        <input name="priority" inputMode="numeric" placeholder="優先序，越小越前" />
      </div>
      <textarea name="instructions" placeholder="補買指示" />
      <ActionMessage state={state} />
      <Button disabled={pending} type="submit">
        {pending ? "建立中..." : "建立補買任務"}
      </Button>
    </form>
  );
}

export function CreatePurchaseTaskForm({
  customerNicknames,
  requiresFaceCheck,
  trip,
}: {
  customerNicknames: string[];
  requiresFaceCheck: boolean;
  trip: { id: string; status: string; trip_name: string };
}) {
  const [photos, setPhotos] = useState<AdminTaskUploadPhoto[]>([]);
  const photosRef = useRef<AdminTaskUploadPhoto[]>([]);
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
          updatePhoto(photo.clientPhotoId, { error: undefined, status: "uploading" });
          try {
            const uploaded = await uploadAdminTaskPhoto(photo, trip.id);
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
      const result = await createPurchaseTaskAction({}, formData);
      setState(result);
      if (result.ok) {
        for (const photo of uploadedPhotos) URL.revokeObjectURL(photo.objectUrl);
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
        <CustomerNicknameInput
          customerNicknames={customerNicknames}
          disabled={!canCreate || pending}
          key={formResetKey}
        />
        <input name="productName" placeholder="商品名稱" required disabled={!canCreate || pending} />
        <input name="quantity" inputMode="numeric" min="1" placeholder="數量" required disabled={!canCreate || pending} />
        <input name="originalPriceJpy" inputMode="numeric" min="0" placeholder="原價 JPY" required disabled={!canCreate || pending} />
        <input name="salePriceTwd" inputMode="numeric" min="0" placeholder="售價 TWD" required disabled={!canCreate || pending} />
      </div>
      <textarea name="note" placeholder="採買備註，可留空" disabled={!canCreate || pending} />
      <div className="grid gap-2">
        <p className="text-sm font-medium">採買參考照（必填）</p>
        <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-center">
          <ImageUp className="size-5" aria-hidden="true" />
          <span className="text-sm">選擇商品照片或參考截圖</span>
          <input
            accept="image/*"
            className="sr-only"
            disabled={!canCreate || pending}
            multiple
            required={!photos.length}
            type="file"
            onChange={(event) => {
              addFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {photos.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {photos.map((photo) => (
              <div className="rounded-md border bg-background p-2" key={photo.clientPhotoId}>
                <img
                  alt={photo.originalFilename}
                  className="aspect-square w-full rounded-md object-cover"
                  src={photo.objectUrl}
                />
                <div className="mt-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{photo.originalFilename}</p>
                    <p className="text-xs text-muted-foreground">{adminUploadStatusLabel(photo.status)}</p>
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
      <Button disabled={!canCreate || pending || !photos.length || photos.some((photo) => Boolean(photo.error))} size="sm" type="submit">
        {pending ? "發布中..." : requiresFaceCheck ? "發布挑臉採買" : "發布一般採買"}
      </Button>
    </form>
  );
}

export function QuickPublishPurchaseForm({
  customerNicknames,
  photo,
  task,
}: {
  customerNicknames: string[];
  photo: any;
  task: any;
}) {
  const [state, action, pending] = useActionState(quickPublishPurchaseTaskAction, initialState);
  const latestReply = photo.latest_reply || {};
  const defaultProductName = photo.product_name || task.product_name || "";
  const canPublish = photo.reply_status === "replied";
  return (
    <form action={action} className="mt-3 grid gap-2 rounded-md border bg-card p-3">
      <input name="tripId" type="hidden" value={task.trip_id} />
      <input name="quoteTaskPhotoId" type="hidden" value={photo.id} />
      <div className="grid gap-2 sm:grid-cols-2">
        <CustomerNicknameInput
          customerNicknames={customerNicknames}
          disabled={!canPublish || pending}
        />
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
        {pending ? "發布中..." : photo.reply_status === "converted_to_purchase" ? "已轉採買" : "快速發布採買"}
      </Button>
    </form>
  );
}

function CustomerNicknameInput({
  customerNicknames,
  disabled,
}: {
  customerNicknames: string[];
  disabled: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [value, setValue] = useState("");
  const normalizedValue = value.trim().toLocaleLowerCase("zh-TW");
  const suggestions = normalizedValue
    ? customerNicknames
        .filter((nickname) =>
          nickname.toLocaleLowerCase("zh-TW").includes(normalizedValue),
        )
        .slice(0, 8)
    : customerNicknames.slice(0, 8);

  return (
    <div className="relative">
      <input
        aria-autocomplete="list"
        aria-expanded={focused && suggestions.length > 0}
        autoComplete="off"
        className="w-full"
        disabled={disabled}
        name="lineCommunityName"
        placeholder="LINE 社群暱稱"
        required
        role="combobox"
        value={value}
        onBlur={() => setFocused(false)}
        onChange={(event) => setValue(event.currentTarget.value)}
        onFocus={() => setFocused(true)}
      />
      {focused && suggestions.length ? (
        <div
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          role="listbox"
        >
          {suggestions.map((nickname) => (
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

function CreateSitePhotoQuoteTaskForm({
  availablePhotos,
  taskType,
  trip,
}: QuoteTaskFormProps) {
  const [state, action, pending] = useActionState(createQuoteTaskAction, initialState);
  const canCreate = availablePhotos.length > 0 && !["ended", "canceled"].includes(trip.status);
  return (
    <form action={action} className="mt-3 grid gap-3 border-t pt-3">
      <input name="tripId" type="hidden" value={trip.id} />
      <input name="taskType" type="hidden" value={taskType} />
      <div className="grid gap-2">
        <input name="productName" placeholder="商品名稱，可留空" disabled={!canCreate} />
      </div>
      <textarea name="instruction" placeholder="任務說明，可留空" disabled={!canCreate} />
      {availablePhotos.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {availablePhotos.map((photo) => (
            <label key={photo.id} className="grid cursor-pointer gap-2 rounded-md border bg-background p-2">
              {photo.signed_url ? (
                <img
                  alt={photo.original_filename || "site photo"}
                  className="aspect-square w-full rounded-md object-cover"
                  src={photo.signed_url}
                />
              ) : null}
              <span className="flex items-center gap-2 text-sm">
                <input name="photoIds" type="checkbox" value={photo.id} />
                <span className="min-w-0 truncate">
                  {photo.sort_order + 1}. {photo.saved_by_admin ? "已保存" : "現場照"}
                </span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          這個行程還沒有可建立任務的現場照片。
        </p>
      )}
      <ActionMessage state={state} />
      <Button disabled={!canCreate || pending} size="sm" type="submit" variant="outline">
        {pending ? "發布中..." : "發布詢價/細節任務"}
      </Button>
    </form>
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

function CreateUploadedDetailTaskForm({
  trip,
}: {
  trip: QuoteTaskFormProps["trip"];
}) {
  const [photos, setPhotos] = useState<AdminTaskUploadPhoto[]>([]);
  const photosRef = useRef<AdminTaskUploadPhoto[]>([]);
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
          file.size > MAX_ADMIN_TASK_PHOTO_BYTES
            ? "照片超過 8MB，請縮小後再上傳。"
            : undefined,
        file,
        objectUrl: URL.createObjectURL(file),
        originalFilename: file.name || "task-photo.jpg",
        sortOrder: photos.length + index,
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

  async function submitDetailTask(event: React.FormEvent<HTMLFormElement>) {
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
          updatePhoto(photo.clientPhotoId, { error: undefined, status: "uploading" });
          try {
            const uploaded = await uploadAdminTaskPhoto(photo, trip.id);
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

  function updatePhoto(clientPhotoId: string, patch: Partial<AdminTaskUploadPhoto>) {
    setPhotos((current) =>
      current.map((photo) =>
        photo.clientPhotoId === clientPhotoId ? { ...photo, ...patch } : photo,
      ),
    );
  }

  return (
    <form className="mt-3 grid gap-3 border-t pt-3" onSubmit={submitDetailTask}>
      <input name="tripId" type="hidden" value={trip.id} />
      <input name="taskType" type="hidden" value="detail" />
      <input name="productName" placeholder="商品名稱，可留空" disabled={pending} />
      <textarea name="instruction" placeholder="任務說明，可留空" disabled={pending} />
      <div className="grid gap-2">
        <p className="text-sm font-medium">上傳照片（必填）</p>
        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/40 p-4 text-center">
          <ImageUp className="size-5" aria-hidden="true" />
          <span className="text-sm">選擇要請小幫手補拍細節的照片</span>
          <input
            accept="image/*"
            className="sr-only"
            disabled={pending}
            multiple
            required={!photos.length}
            type="file"
            onChange={(event) => {
              addFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      {photos.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <div className="rounded-md border bg-background p-2" key={photo.clientPhotoId}>
              <img
                alt={photo.originalFilename}
                className="aspect-square w-full rounded-md object-cover"
                src={photo.objectUrl}
              />
              <div className="mt-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{photo.originalFilename}</p>
                  <p className="text-xs text-muted-foreground">{adminUploadStatusLabel(photo.status)}</p>
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
        disabled={pending || !photos.length || photos.some((photo) => Boolean(photo.error))}
        size="sm"
        type="submit"
      >
        {pending ? "上傳並發布中..." : "上傳照片並發布細節照任務"}
      </Button>
    </form>
  );
}

async function uploadAdminTaskPhoto(photo: AdminTaskUploadPhoto, tripId: string) {
  const presign = await fetch("/api/uploads/presign", {
    body: JSON.stringify({
      clientPhotoId: photo.clientPhotoId,
      contentType: photo.contentType,
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
    body: photo.file,
    headers: { "content-type": photo.contentType },
    method: "PUT",
  });
  if (!upload.ok) throw new Error(`R2 上傳失敗 (${upload.status})。`);
  return { error: undefined, status: "uploaded" as const, storageKey: presignBody.storageKey };
}

function adminUploadStatusLabel(status: AdminTaskUploadPhoto["status"]) {
  if (status === "uploading") return "上傳中";
  if (status === "uploaded") return "已上傳";
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
