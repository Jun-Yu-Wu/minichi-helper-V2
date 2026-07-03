"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function OptimisticTripGroup({
  children,
  href,
  isOpen,
  title,
}: {
  children: React.ReactNode;
  href: string;
  isOpen: boolean;
  title: string;
}) {
  const [optimisticOpen, setOptimisticOpen] = useState(isOpen);

  useEffect(() => {
    setOptimisticOpen(isOpen);
  }, [isOpen]);

  return (
    <section className="grid gap-3">
      <Link
        className={`flex min-h-12 items-center justify-between rounded-xl border px-4 py-3 shadow-sm transition hover:border-primary/30 hover:bg-accent/40 ${
          optimisticOpen ? "bg-card" : "bg-card/70"
        }`}
        href={href}
        onClick={() => setOptimisticOpen((current) => !current)}
      >
        <span className="font-semibold">{title}</span>
        <span className="text-sm text-muted-foreground">{optimisticOpen ? "收合" : "展開載入"}</span>
      </Link>
      {optimisticOpen ? (
        isOpen ? children : (
          <div className="rounded-xl border border-dashed bg-card p-4 text-sm text-muted-foreground">
            載入行程中...
          </div>
        )
      ) : null}
    </section>
  );
}
