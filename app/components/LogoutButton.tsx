"use client";

import { useFormStatus } from "react-dom";

import { Button } from "./ui/button";
import { clearClientResourceCache } from "../../src/lib/client-resource-cache";

export function LogoutButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      className="h-11 sm:h-9"
      disabled={pending}
      onClick={clearClientResourceCache}
      size="sm"
      type="submit"
      variant="outline"
    >
      {pending ? "登出中…" : "登出"}
    </Button>
  );
}
