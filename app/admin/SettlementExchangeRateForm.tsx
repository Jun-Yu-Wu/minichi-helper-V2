"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2, Pencil } from "lucide-react";

import { Button } from "../components/ui/button";

export function SettlementExchangeRateForm({ settlement }: { settlement: any }) {
  const router = useRouter();
  const initialRate = settlement.jpy_to_twd_rate == null ? "" : String(settlement.jpy_to_twd_rate);
  const [displayRate, setDisplayRate] = useState(initialRate);
  const [editing, setEditing] = useState(!initialRate);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  if (!editing && displayRate) {
    return (
      <div className="mt-3 flex flex-col gap-3 rounded-md border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1 text-sm">
          <span className="font-medium">當日 JPY→TWD 匯率</span>
          <span className="flex items-center gap-2 text-lg font-semibold">
            {displayRate}
            {saved ? <Check className="size-4 text-primary" /> : null}
          </span>
        </div>
        <Button size="sm" type="button" variant="outline" onClick={() => setEditing(true)}>
          <Pencil className="size-4" />
          修改
        </Button>
      </div>
    );
  }

  return (
    <form
      className="mt-3 grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[1fr_auto]"
      onSubmit={async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        formData.set("action", "set_exchange_rate");
        setPending(true);
        setError("");
        try {
          const response = await fetch(`/api/admin/settlements/${encodeURIComponent(settlement.id)}`, {
            body: formData,
            method: "POST",
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || body.error) {
            throw new Error(body.error || "匯率儲存失敗。");
          }
          const nextRate = body.settlement?.jpy_to_twd_rate ?? formData.get("jpyToTwdRate");
          setDisplayRate(String(nextRate || ""));
          setEditing(false);
          setSaved(true);
          router.refresh();
        } catch (submitError) {
          setError(submitError instanceof Error ? submitError.message : "匯率儲存失敗。");
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="grid gap-1 text-sm">
        <span className="font-medium">當日 JPY→TWD 匯率</span>
        <input
          defaultValue={displayRate}
          disabled={pending}
          inputMode="decimal"
          name="jpyToTwdRate"
          placeholder="例如 0.22"
          required
        />
      </label>
      <Button className="self-end" disabled={pending} type="submit">
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            儲存中...
          </>
        ) : displayRate ? (
          "儲存修改"
        ) : (
          "儲存匯率"
        )}
      </Button>
      {error ? <p className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
    </form>
  );
}
