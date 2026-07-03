"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function WaitingForActivationRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = window.setInterval(() => {
      router.refresh();
    }, 8000);
    return () => window.clearInterval(id);
  }, [router]);

  return (
    <p className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
      系統會定期檢查管理員是否已開啟行程；開啟後會自動切換成現場工作區。
    </p>
  );
}
