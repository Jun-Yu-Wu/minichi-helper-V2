"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "./ui/button";

type Field = {
  name: string;
  value: string | number | null | undefined;
};

type ActionResult = { error?: string; ok?: boolean } | void;

export function ActionButtonForm({
  action,
  fields,
  label,
  pendingLabel = "處理中...",
  successHref,
  variant = "default",
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  fields: Field[];
  label: string;
  pendingLabel?: string;
  successHref?: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError("");
        startTransition(async () => {
          try {
            const result = await action(formData);
            if (result && typeof result === "object" && "error" in result && result.error) {
              throw new Error(result.error);
            }
            if (successHref) router.replace(successHref);
            else router.refresh();
          } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : "操作失敗，請重新載入後再試。");
          }
        });
      }}
    >
      {fields.map((field) => (
        <input
          key={field.name}
          name={field.name}
          type="hidden"
          value={field.value == null ? "" : String(field.value)}
        />
      ))}
      <Button disabled={pending} size="sm" type="submit" variant={variant}>
        {pending ? pendingLabel : error ? "重試" : label}
      </Button>
      {error ? (
        <p aria-live="assertive" className="mt-2 max-w-xl text-left text-sm leading-6 text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
