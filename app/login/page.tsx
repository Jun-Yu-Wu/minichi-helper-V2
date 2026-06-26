import { Suspense } from "react";

import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="grid gap-6 rounded-lg border bg-card p-6 shadow-sm">
        <div className="grid gap-2">
          <p className="text-sm font-medium text-muted-foreground">MINICHI Helper</p>
          <h1 className="text-2xl font-semibold">小幫手系統登入</h1>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
