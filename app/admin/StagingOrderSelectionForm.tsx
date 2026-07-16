"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CheckSquare, Loader2, Square } from "lucide-react";

import { Button } from "../components/ui/button";

type SelectionResult = { error?: string; ok?: boolean };

export function StagingOrderSelectionForm({
  action,
  expectedVersion,
  jobId,
  orders,
  disabled = false,
}: {
  action: (formData: FormData) => Promise<SelectionResult>;
  disabled?: boolean;
  expectedVersion: number;
  jobId: string;
  orders: any[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(orders.filter((order) => !order.is_excluded).map((order) => order.id)),
  );
  const [exclusionReason, setExclusionReason] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, startTransition] = useTransition();
  const excludedCount = orders.length - selected.size;
  const selectedCount = selected.size;
  const allSelected = useMemo(() => orders.length > 0 && selected.size === orders.length, [orders.length, selected]);

  function toggle(orderId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function submit() {
    setError("");
    setSaved("");
    if (excludedCount > 0 && !exclusionReason.trim()) {
      setError("未選取的訂單需要填寫排除原因。");
      return;
    }
    const formData = new FormData();
    formData.set("mergeJobId", jobId);
    formData.set("expectedVersion", String(expectedVersion));
    formData.set("exclusionReason", exclusionReason.trim());
    for (const orderId of selected) formData.append("selectedOrderId", orderId);
    startTransition(async () => {
      try {
        const result = await action(formData);
        if (result?.error) throw new Error(result.error);
        setSaved("已儲存訂單選取");
        // Keep the button responsive while the Server Component refreshes in the background.
        window.setTimeout(() => router.refresh(), 0);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "儲存選取失敗，請重新載入後再試。");
      }
    });
  }

  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold">選取要合併的訂單</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {disabled ? "這個批次已進入合併流程，訂單選取已鎖定。" : "勾選的訂單會進入核准快照；未勾選的訂單會被軟排除，不會刪除 staging 資料。"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button disabled={disabled || pending || allSelected} onClick={() => setSelected(new Set(orders.map((order) => order.id)))} size="sm" type="button" variant="outline">
            <CheckSquare className="mr-1.5 size-4" />全選
          </Button>
          <Button disabled={disabled || pending || selected.size === 0} onClick={() => setSelected(new Set())} size="sm" type="button" variant="ghost">
            <Square className="mr-1.5 size-4" />清除選取
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        {orders.map((order) => {
          const isSelected = selected.has(order.id);
          const needsCustomerConfirmation = !order.is_excluded && !order.customer_exists && !order.customer_confirmed;
          return (
            <div className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${isSelected ? "border-primary/40 bg-primary/5" : "bg-background"}`} key={order.id}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input checked={isSelected} className="size-5 shrink-0" disabled={disabled || pending} onChange={() => toggle(order.id)} type="checkbox" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{order.line_community_name} · {order.product_name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{order.quantity} 件 · TWD {order.sale_price_twd}</span>
                  {needsCustomerConfirmation ? (
                    <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">客戶暱稱未找到，需逐筆確認</span>
                  ) : order.customer_confirmed && !order.customer_exists ? (
                    <span className="mt-1 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900">未知暱稱已確認</span>
                  ) : null}
                </span>
              </label>
              <Link className="shrink-0 text-sm font-medium text-primary hover:underline" href={`/admin?view=merge&mergeJobId=${encodeURIComponent(jobId)}&reviewedOrderId=${encodeURIComponent(order.id)}`}>
                查看明細
              </Link>
            </div>
          );
        })}
      </div>
      {excludedCount > 0 ? (
        <label className="grid gap-1 text-sm">
          <span className="font-medium">排除未選取訂單的共同原因</span>
          <input disabled={disabled || pending} onChange={(event) => setExclusionReason(event.target.value)} placeholder="例如：客戶取消或資料仍需確認" value={exclusionReason} />
        </label>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {saved || `已選 ${selectedCount} 筆，排除 ${excludedCount} 筆`}
        </p>
        <Button disabled={disabled || pending || orders.length === 0} onClick={submit} type="button">
          {pending ? <><Loader2 className="mr-1.5 size-4 animate-spin" />儲存選取中…</> : "儲存合併選取"}
        </Button>
      </div>
      {error ? <p aria-live="assertive" className="text-sm text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}
