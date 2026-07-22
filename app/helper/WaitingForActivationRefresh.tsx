"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function WaitingForActivationRefresh({
  tripId,
  initialStatus,
  initialUpdatedAt,
  initialVersion,
}: {
  tripId: string;
  initialStatus: string;
  initialUpdatedAt?: string | null;
  initialVersion?: number | null;
}) {
  const router = useRouter();
  const knownSignature = useRef(
    tripSignature({
      status: initialStatus,
      updatedAt: initialUpdatedAt,
      version: initialVersion,
    }),
  );

  useEffect(() => {
    let active = true;
    async function checkForUpdates() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(
          `/api/helper/trips/${encodeURIComponent(tripId)}/status`,
          { cache: "no-store" },
        );
        if (!response.ok || !active) return;
        const data = await response.json();
        const nextSignature = tripSignature(data.trip);
        if (nextSignature !== knownSignature.current) {
          knownSignature.current = nextSignature;
          router.refresh();
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
  }, [router, tripId]);

  return (
    <p className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
      系統會定期檢查管理員是否已開啟行程；開啟後會自動切換成現場工作區。
    </p>
  );
}

function tripSignature(trip: {
  status?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
  version?: number | null;
}) {
  return [trip.status || "", trip.version ?? "", trip.updatedAt || trip.updated_at || ""].join(":");
}
