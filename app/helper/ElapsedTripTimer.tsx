"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ElapsedTripTimer({
  pausedAt,
  pausedSeconds,
  refreshStatus = false,
  startedAt,
  status,
  tripId,
}: {
  pausedAt?: string | null;
  pausedSeconds?: number | null;
  refreshStatus?: boolean;
  startedAt: string;
  status?: string | null;
  tripId?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const router = useRouter();
  const [, startTransition] = useTransition();
  const knownSignature = useRef(timerSignature({ pausedAt, pausedSeconds, startedAt, status }));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    knownSignature.current = timerSignature({ pausedAt, pausedSeconds, startedAt, status });
  }, [pausedAt, pausedSeconds, startedAt, status]);

  useEffect(() => {
    if (!refreshStatus || !tripId) return;
    const activeTripId = tripId;
    let active = true;

    async function checkForUpdates() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(
          `/api/helper/trips/${encodeURIComponent(activeTripId)}/status`,
          { cache: "no-store" },
        );
        if (!response.ok || !active) return;
        const data = await response.json();
        const nextSignature = timerSignature(data.trip || {});
        if (nextSignature !== knownSignature.current) {
          knownSignature.current = nextSignature;
          startTransition(() => router.refresh());
        }
      } catch {
        // A later cycle retries transient mobile/network failures.
      }
    }

    const id = window.setInterval(() => {
      void checkForUpdates();
    }, 8000);
    document.addEventListener("visibilitychange", checkForUpdates);
    return () => {
      active = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", checkForUpdates);
    };
  }, [refreshStatus, router, startTransition, tripId]);

  const started = new Date(startedAt).getTime();
  const openPause = pausedAt ? Math.max(0, now - new Date(pausedAt).getTime()) : 0;
  const elapsed = now - started - Number(pausedSeconds || 0) * 1000 - openPause;
  const paused = Boolean(pausedAt);
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-muted-foreground">連線時間</p>
        {paused ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            已暫停
          </span>
        ) : null}
      </div>
      <p className="mt-1 font-mono text-2xl font-semibold tracking-tight">
        {formatElapsed(elapsed)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {paused ? "管理員暫停中，這段時間不計入時薪。" : "從出發後開始計時。"}
      </p>
    </div>
  );
}

function timerSignature(trip: {
  connectionPausedAt?: string | null;
  connection_paused_at?: string | null;
  connectionPausedSeconds?: number | null;
  connection_paused_seconds?: number | null;
  departedAt?: string | null;
  departed_at?: string | null;
  pausedAt?: string | null;
  pausedSeconds?: number | null;
  status?: string | null;
  startedAt?: string | null;
  started_at?: string | null;
}) {
  return [
    trip.status || "",
    trip.departedAt || trip.departed_at || trip.startedAt || trip.started_at || "",
    trip.connectionPausedAt || trip.connection_paused_at || trip.pausedAt || "",
    trip.connectionPausedSeconds ?? trip.connection_paused_seconds ?? trip.pausedSeconds ?? "",
  ].join(":");
}
