import Link from "next/link";

import { Button } from "./components/ui/button";

export default function HomePage() {
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-3xl content-center gap-6 px-5 py-10">
      <div className="grid gap-3">
        <p className="text-sm font-medium text-muted-foreground">MINICHI</p>
        <h1 className="text-3xl font-semibold tracking-tight">新小幫手系統</h1>
        <p className="max-w-xl text-muted-foreground">
          小幫手現場工作、任務回覆與結帳，以及管理員的行程協調、審核與合併工作台。
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/helper">小幫手工作台</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin">管理工作台</Link>
        </Button>
      </div>
    </main>
  );
}
