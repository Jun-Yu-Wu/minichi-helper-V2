"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import type React from "react";

import { Button } from "./ui/button";

export function RetryableError({
  message,
  onRetry,
  retryLabel = "重新載入",
}: {
  message: string;
  onRetry: () => void | Promise<void>;
  retryLabel?: string;
}) {
  return (
    <div
      aria-live="assertive"
      className="grid gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p className="leading-6">{message}</p>
      </div>
      <Button className="w-fit" size="sm" type="button" variant="outline" onClick={() => void onRetry()}>
        <RefreshCw aria-hidden="true" className="size-4" />
        {retryLabel}
      </Button>
    </div>
  );
}

export function LoadingState({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true" aria-label={label} className="grid gap-2" role="status">
      {children}
    </div>
  );
}
