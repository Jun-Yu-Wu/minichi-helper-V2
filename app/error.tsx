"use client";

import { AlertCircle } from "lucide-react";

import { Button } from "./components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto grid min-h-[70svh] w-full max-w-xl place-content-center px-5 py-10">
      <section
        className="grid gap-4 rounded-xl border border-red-200 bg-card p-5 shadow-sm"
        role="alert"
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-red-50 text-red-700">
          <AlertCircle className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold">工作資料暫時載入失敗</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            你的操作尚未在這個畫面被標記完成。請先重新載入；如果持續發生，再聯絡管理員確認。
          </p>
        </div>
        <Button onClick={reset} type="button">
          重新載入
        </Button>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">錯誤識別碼：{error.digest}</p>
        ) : null}
      </section>
    </main>
  );
}
