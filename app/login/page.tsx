import { Suspense } from "react";
import { ArrowRight, KeyRound, ShoppingBag } from "lucide-react";

import { BackLink } from "../components/BackButton";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-5xl place-items-center px-4 py-6 sm:px-6 sm:py-10">
      <div className="grid w-full overflow-hidden rounded-[1.75rem] border border-primary/15 bg-card/90 shadow-[0_28px_80px_-42px_oklch(0.25_0.05_145_/_0.7)] lg:grid-cols-[0.9fr_1.1fr]">
        <section className="relative hidden overflow-hidden bg-primary p-8 text-primary-foreground sm:p-10 lg:block">
          <div className="relative z-10 flex h-full min-h-[30rem] flex-col justify-between">
            <div>
              <div className="grid size-11 place-items-center rounded-2xl bg-accent text-accent-foreground shadow-sm">
                <ShoppingBag aria-hidden="true" className="size-5" />
              </div>
              <p className="mt-12 font-mono text-[10px] uppercase tracking-[0.22em] text-primary-foreground/55">MINICHI / FIELD DESK</p>
              <h1 className="display-type mt-4 text-4xl font-semibold leading-tight tracking-[-0.04em]">把現場的<br />下一步接起來。</h1>
              <p className="mt-5 max-w-xs text-sm leading-7 text-primary-foreground/70">小幫手回傳現場，管理員安排任務；每個角色只看見當下需要的工作。</p>
            </div>
            <div className="flex items-center gap-2 border-t border-primary-foreground/15 pt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-primary-foreground/45">
              <span className="size-1.5 rounded-full bg-accent" /> live work / private operations
            </div>
          </div>
          <div aria-hidden="true" className="absolute -right-24 -top-24 size-80 rounded-full border border-primary-foreground/10" />
          <div aria-hidden="true" className="absolute -bottom-36 -left-20 size-96 rounded-full border border-primary-foreground/10" />
        </section>
        <section className="grid gap-6 p-6 sm:p-10">
          <div className="grid gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <KeyRound aria-hidden="true" className="size-4 text-accent-foreground" />
              安全登入
            </div>
            <h1 className="display-type text-3xl font-semibold tracking-[-0.04em]">登入工作系統</h1>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">系統會依帳號權限進入小幫手或管理工作台。</p>
          </div>
        <Suspense
          fallback={
            <div
              aria-label="登入表單載入中"
              className="skeleton-block h-40 rounded-lg"
            />
          }
        >
          <LoginForm />
        </Suspense>
        <div className="flex items-center gap-2 border-t border-primary/10 pt-5 text-xs text-muted-foreground">
          <ArrowRight aria-hidden="true" className="size-3 text-accent-foreground" />
          <BackLink className="h-auto w-auto gap-1 p-0 text-xs" href="/" label="返回系統入口" />
        </div>
        </section>
      </div>
    </main>
  );
}
