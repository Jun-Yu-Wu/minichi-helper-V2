"use client";

import { useEffect, useState } from "react";

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function AdminConnectionTimer({
  pausedAt,
  pausedSeconds,
  startedAt,
}: {
  pausedAt?: string | null;
  pausedSeconds?: number | null;
  startedAt?: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const started = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  const openPause = pausedAt ? Math.max(0, now - new Date(pausedAt).getTime()) : 0;
  const elapsed = Number.isFinite(started)
    ? now - started - Number(pausedSeconds || 0) * 1000 - openPause
    : 0;
  const paused = Boolean(pausedAt);

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted-foreground">連線計時</p>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            paused ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {paused ? "已暫停" : "計時中"}
        </span>
      </div>
      <p className="mt-1 font-mono text-2xl font-semibold tracking-tight">{formatElapsed(elapsed)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {paused ? "暫停期間不計入連線／時薪時間。" : "從小幫手出發後開始計算。"}
      </p>
    </div>
  );
}
