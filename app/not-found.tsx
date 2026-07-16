import Link from "next/link";

import { Button } from "./components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-md content-center gap-4 px-5 py-10">
      <section className="grid gap-3 rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-sm font-semibold text-muted-foreground">MINICHI</p>
        <h1 className="text-2xl font-semibold">找不到這個工作頁面</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          這個連結可能已失效，或工作內容已經被更新。請回到入口重新選擇工作台。
        </p>
        <Button asChild className="mt-1">
          <Link href="/">返回系統入口</Link>
        </Button>
      </section>
    </main>
  );
}
