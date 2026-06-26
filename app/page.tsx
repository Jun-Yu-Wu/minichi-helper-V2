import Link from "next/link";

import { Button } from "./components/ui/button";

export default function HomePage() {
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-3xl content-center gap-6 px-5 py-10">
      <div className="grid gap-3">
        <p className="text-sm font-medium text-muted-foreground">MINICHI</p>
        <h1 className="text-3xl font-semibold tracking-tight">新小幫手系統</h1>
        <p className="max-w-xl text-muted-foreground">
          第一個 slice：小幫手帳號、行程指派，以及 scheduled 到 active 的狀態流。
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
