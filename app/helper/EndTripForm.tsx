"use client";

import { useActionState, useState } from "react";

import { endTripAction, type HelperActionResult } from "../actions/helper";
import { Button } from "../components/ui/button";

const initialState: HelperActionResult = {};

export function EndTripForm({
  expectedVersion,
  tripId,
}: {
  expectedVersion: number;
  tripId: string;
}) {
  const [state, action, pending] = useActionState(endTripAction, initialState);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="grid gap-1">
        <Button
          className="mx-auto w-fit"
          disabled={pending}
          onClick={() => setConfirming(true)}
          size="sm"
          type="button"
          variant="destructive"
        >
          結束行程
        </Button>
        {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <input name="tripId" type="hidden" value={tripId} />
      <input name="expectedVersion" type="hidden" value={expectedVersion} />
      <p className="text-sm font-semibold text-destructive">確認要結束這趟行程？</p>
      <div className="grid gap-3">
        <Button
          className="w-fit justify-self-start"
          disabled={pending}
          onClick={() => setConfirming(false)}
          type="button"
          variant="outline"
        >
          返回上一頁
        </Button>
        <Button
          className="mx-auto w-fit"
          disabled={pending}
          size="sm"
          type="submit"
          variant="destructive"
        >
          {pending ? "結束中…" : "確認結束"}
        </Button>
      </div>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
