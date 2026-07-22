"use client";

import { useEffect, useState } from "react";

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ElapsedTripTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const started = new Date(startedAt).getTime();
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs font-semibold text-muted-foreground">行程時間</p>
      <p className="mt-1 font-mono text-2xl font-semibold tracking-tight">
        {formatElapsed(now - started)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">從出發後開始計時。</p>
    </div>
  );
}
