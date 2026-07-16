"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useState, useTransition } from "react";

import { Button } from "./ui/button";

type ActionResult = { error?: string; ok?: boolean } | void;

export function ServerActionForm({
  action,
  buttonLabel,
  buttonVariant = "outline",
  children,
  className,
  pendingLabel = "儲存中…",
  successHref,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  buttonLabel: string;
  buttonVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  successHref?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError("");
        startTransition(async () => {
          try {
            const result = await action(formData);
            if (result?.error) throw new Error(result.error);
            if (successHref) router.replace(successHref);
            else router.refresh();
          } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "操作失敗，請重新載入後再試。");
          }
        });
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
        <Button type="submit" variant={buttonVariant}>
          {pending ? pendingLabel : buttonLabel}
        </Button>
      </fieldset>
      {error ? <p aria-live="assertive" className="text-sm text-destructive" role="alert">{error}</p> : null}
    </form>
  );
}
