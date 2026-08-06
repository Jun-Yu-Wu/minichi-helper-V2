"use client";

import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "./ui/button";

export function WorkspaceError({
  reset,
  roleLabel,
}: {
  reset: () => void;
  roleLabel: string;
}) {
  return (
    <main className="mx-auto grid min-h-[60svh] w-full max-w-2xl place-items-center px-5 py-10">
      <section
        aria-live="assertive"
        className="workspace-error paper-surface grid w-full gap-5 rounded-2xl border p-6 sm:p-8"
        role="alert"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
            <AlertTriangle aria-hidden="true" className="size-5" />
          </div>
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              MINICHI / RECOVERY
            </p>
            <h1 className="display-type mt-2 text-2xl font-semibold tracking-[-0.03em]">
              {roleLabel}暫時無法載入
            </h1>
            <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">
              這次工作區沒有完成載入。可以重新整理目前畫面，或先回到系統入口。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={reset}>
            <RotateCcw aria-hidden="true" className="size-4" />
            重新載入
          </Button>
          <Button asChild variant="outline">
            <Link href="/">回到系統入口</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
