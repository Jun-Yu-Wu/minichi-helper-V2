import { Suspense } from "react";
import Link from "next/link";

import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="grid gap-6 rounded-lg border bg-card p-6 shadow-sm">
        <div className="grid gap-2">
          <p className="text-sm font-semibold text-muted-foreground">MINICHI</p>
          <h1 className="text-2xl font-semibold">登入工作系統</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            系統會依帳號權限進入小幫手或管理工作台。
          </p>
        </div>
        <Suspense
          fallback={
            <div
              aria-label="登入表單載入中"
              className="h-40 animate-pulse rounded-lg bg-muted"
            />
          }
        >
          <LoginForm />
        </Suspense>
        <Link
          className="inline-flex min-h-11 items-center justify-center text-center text-sm font-medium text-muted-foreground hover:text-foreground"
          href="/"
        >
          返回系統入口
        </Link>
      </div>
    </main>
  );
}
