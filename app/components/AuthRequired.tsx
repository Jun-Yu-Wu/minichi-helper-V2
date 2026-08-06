import Link from "next/link";

import { BackLink } from "./BackButton";
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
      <div className="paper-surface grid gap-5 rounded-2xl border border-primary/15 bg-card/90 p-6 sm:p-7">
        <div className="grid gap-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">MINICHI / FIELD DESK</p>
          <h1 className="display-type text-3xl font-semibold tracking-[-0.04em]">請先登入</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            登入後會回到{roleLabel}，並依帳號權限顯示可操作的工作內容。
          </p>
        </div>
        <Button asChild size="lg">
          <Link href={`/login?next=${encodeURIComponent(next)}`}>前往登入</Link>
        </Button>
        <BackLink href="/" label="返回系統入口" />
      </div>
    </main>
  );
}
