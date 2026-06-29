"use client";

import { useActionState } from "react";

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
  return (
    <form action={action} className="grid justify-items-end gap-1">
      <input name="tripId" type="hidden" value={tripId} />
      <input name="expectedVersion" type="hidden" value={expectedVersion} />
      <Button disabled={pending} size="sm" type="submit" variant="outline">
        {pending ? "結束中…" : "結束行程"}
      </Button>
      {state.error ? <p className="max-w-64 text-right text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
