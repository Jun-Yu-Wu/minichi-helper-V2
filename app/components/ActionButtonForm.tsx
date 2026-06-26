"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "./ui/button";

type Field = {
  name: string;
  value: string | number | null | undefined;
};

export function ActionButtonForm({
  action,
  fields,
  label,
  pendingLabel = "處理中...",
  variant = "default",
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Field[];
  label: string;
  pendingLabel?: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          await action(formData);
          router.refresh();
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
        {pending ? pendingLabel : label}
      </Button>
    </form>
  );
}
