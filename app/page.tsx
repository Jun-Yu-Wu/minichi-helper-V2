import Link from "next/link";
import { ArrowRight, ShieldCheck, UserRound } from "lucide-react";

export default function HomePage() {
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-5xl content-center gap-10 px-5 py-10 sm:px-8">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="grid gap-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">MINICHI / FIELD DESK</p>
          <h1 className="display-type text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">新小幫手系統</h1>
          <p className="max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
          小幫手現場工作、任務回覆與結帳，以及管理員的行程協調、審核與合併工作台。
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span className="size-2 rounded-full bg-accent shadow-[0_0_0_5px_oklch(0.78_0.125_48_/_0.15)]" /> choose your desk
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link className="choice-card helper-main group paper-surface grid gap-6 rounded-2xl border border-primary/15 bg-card/90 p-6 sm:p-8" href="/helper">
          <div className="flex items-start justify-between gap-4">
            <div className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"><UserRound aria-hidden="true" className="size-5" /></div>
            <ArrowRight aria-hidden="true" className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">FIELD / MOBILE</p>
            <h2 className="display-type mt-2 text-2xl font-semibold">小幫手工作台</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">現場照片、細圖報價、採買任務與結帳。</p>
          </div>
          <span className="text-sm font-semibold text-primary">進入小幫手工作台</span>
        </Link>
        <Link className="choice-card admin-main group admin-accent-surface grid gap-6 rounded-2xl border bg-card/90 p-6 sm:p-8" href="/admin">
          <div className="flex items-start justify-between gap-4">
            <div className="grid size-12 place-items-center rounded-2xl bg-admin-accent text-admin-accent-foreground"><ShieldCheck aria-hidden="true" className="size-5" /></div>
            <ArrowRight aria-hidden="true" className="size-5 text-admin-accent transition-transform group-hover:translate-x-1" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">CONTROL / DESKTOP</p>
            <h2 className="display-type mt-2 text-2xl font-semibold">管理工作台</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">行程協調、任務發布、回傳審核與合併。</p>
          </div>
          <span className="text-sm font-semibold text-admin-accent">進入管理工作台</span>
        </Link>
      </div>
      <p className="border-t border-primary/10 pt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">private operations / role-based access</p>
    </main>
  );
}
