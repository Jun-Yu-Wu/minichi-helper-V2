"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "../components/ui/button";
import { cn } from "@/src/lib/utils";

export function SettlementActionForm({
  buttonLabel,
  buttonClassName,
  buttonVariant = "default",
  children,
  className,
  endpoint,
  pendingLabel = "處理中...",
}: {
  buttonLabel: string;
  buttonClassName?: string;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  children: React.ReactNode;
  className?: string;
  endpoint: string;
  pendingLabel?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <form
      className={className}
      onSubmit={async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setPending(true);
        setError("");
        setMessage("");
        try {
          const response = await fetch(endpoint, {
            body: formData,
            method: "POST",
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || body.error) {
            throw new Error(body.error || "操作失敗，請稍後再試。");
          }
          setMessage(body.message || "已完成。");
          router.refresh();
        } catch (submitError) {
          setError(submitError instanceof Error ? submitError.message : "操作失敗，請稍後再試。");
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
      <Button className={cn(buttonClassName)} disabled={pending} type="submit" variant={buttonVariant}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {pendingLabel}
          </>
        ) : (
          buttonLabel
        )}
      </Button>
      {message ? <p className="text-sm text-primary">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
