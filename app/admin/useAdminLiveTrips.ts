"use client";

import { useCallback, useEffect, useState } from "react";

export type AdminLiveTrip = {
  helper_display_name?: string | null;
  id: string;
  status: string;
  trip_name: string;
};

export function useAdminLiveTrips(initialTrips?: AdminLiveTrip[]) {
  const [trips, setTrips] = useState<AdminLiveTrip[]>(initialTrips || []);
  const [loadingTrips, setLoadingTrips] = useState(initialTrips === undefined);
  const [tripsError, setTripsError] = useState("");

  const loadTrips = useCallback(async () => {
    setLoadingTrips(true);
    try {
      const response = await fetch("/api/admin/live/trips", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "載入失敗");
      setTrips(data.trips || []);
      setTripsError("");
    } catch (error) {
      setTripsError(error instanceof Error ? error.message : "即時行程載入失敗。");
    } finally {
      setLoadingTrips(false);
    }
  }, []);

  useEffect(() => {
    const hasInitialTrips = initialTrips !== undefined;
    if (hasInitialTrips) {
      setTrips(initialTrips || []);
      setLoadingTrips(false);
    }

    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function loadVisibleTrips() {
      if (document.visibilityState !== "visible") return;
      await loadTrips();
      if (!active) return;
    }

    if (!hasInitialTrips) void loadVisibleTrips();
    timer = setInterval(() => void loadVisibleTrips(), 8000);
    document.addEventListener("visibilitychange", loadVisibleTrips);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", loadVisibleTrips);
    };
  }, [initialTrips, loadTrips]);

  return {
    loadTrips,
    loadingTrips,
    trips,
    tripsError,
  };
}
