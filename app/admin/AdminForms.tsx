"use client";

import { useActionState } from "react";

import {
  createHelperAction,
  createQuoteTaskAction,
  createTripAction,
  repairTripAction,
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

export function CreateQuoteTaskForm({
  availablePhotos,
  trip,
}: {
  availablePhotos: Array<{
    id: string;
    original_filename?: string | null;
    saved_by_admin?: boolean;
    signed_url?: string;
    sort_order: number;
  }>;
  trip: { id: string; status: string; trip_name: string };
}) {
  const [state, action, pending] = useActionState(createQuoteTaskAction, initialState);
  const canCreate = availablePhotos.length > 0 && !["ended", "canceled"].includes(trip.status);
  return (
    <form action={action} className="mt-3 grid gap-3 border-t pt-3">
      <input name="tripId" type="hidden" value={trip.id} />
      <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
        <select name="taskType" defaultValue="quote_and_detail" disabled={!canCreate}>
          <option value="quote">報價</option>
          <option value="detail">細節照</option>
          <option value="quote_and_detail">報價 + 細節照</option>
        </select>
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
