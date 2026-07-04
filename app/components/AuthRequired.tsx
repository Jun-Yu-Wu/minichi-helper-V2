import Link from "next/link";

import { Button } from "./ui/button";

export function AuthRequired({
  next,
  roleLabel,
}: {
  next: string;
  roleLabel: string;
}) {
  return (
    <main className="mx-auto grid min-h-svh w-full max-w-md content-center gap-4 px-5 py-10">
      <div className="grid gap-4 rounded-lg border bg-card p-6 shadow-sm">
        <div className="grid gap-2">
          <p className="text-sm font-semibold text-muted-foreground">MINICHI</p>
          <h1 className="text-2xl font-semibold">請先登入</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            登入後會回到{roleLabel}，並依帳號權限顯示可操作的工作內容。
          </p>
        </div>
        <Button asChild size="lg">
          <Link href={`/login?next=${encodeURIComponent(next)}`}>前往登入</Link>
        </Button>
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
